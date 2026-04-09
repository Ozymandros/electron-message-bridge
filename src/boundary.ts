/**
 * @module boundary
 *
 * Boundary-first API contracts for the IPC and WASM bridges.
 *
 * This module provides:
 *
 * 1. **Type-level contracts** — {@link JsonValue} / {@link BridgePayload} describe
 *    exactly what can safely cross the IPC boundary. Electron's `contextBridge`
 *    serialises data with the structured-clone algorithm; restricting to
 *    JSON-serialisable values guarantees predictable round-trip fidelity.
 *
 * 2. **Runtime guards** — {@link isBridgePayload} / {@link assertBridgePayload}
 *    validate that a value is JSON-serialisable before it crosses the bridge.
 *
 * 3. **Schema-agnostic validation HOF** — {@link withValidation} and
 *    {@link withOutputValidation} wrap IPC handlers with input/output
 *    validation using any schema library that exposes a `parse` method
 *    (Zod, Valibot, ArkType, @sinclair/typebox, …).
 *
 * ## Quick start
 *
 * ```ts
 * // main.ts
 * import { z }            from 'zod';
 * import { defineIpcApi } from 'electron-ipc-helper';
 * import { withValidation } from 'electron-ipc-helper/boundary';
 *
 * const GetUserInput = z.object({ id: z.string().uuid() });
 *
 * const api = defineIpcApi({
 *   getUser: withValidation(GetUserInput, async ({ id }) => db.users.find(id)),
 * });
 * ```
 *
 * ## Zod compatibility
 *
 * Every Zod schema satisfies the {@link BridgeSchema} interface — no adapter
 * shim needed. The same is true for Valibot (`parse(v)` throws on invalid
 * input), ArkType (`assert`), and `@sinclair/typebox` (with the `Value` helper).
 *
 * ## Why JSON, not structured-clone?
 *
 * Electron's structured-clone algorithm supports `Date`, `Map`, `Set`,
 * `ArrayBuffer`, etc. But:
 *
 * - Those types lose fidelity when serialised to disk, logged, or forwarded to
 *   a REST API.
 * - Restricting to JSON guarantees full round-trip equality for every type.
 * - If you need `Uint8Array` or `Date`, use explicit encoding (`toISOString()`,
 *   `Array.from(bytes)`) — the intent becomes explicit and testable.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
 */

import { InvalidBridgePayloadError } from './errors.js';

// ─── JSON / Bridge type hierarchy ─────────────────────────────────────────────

/** A JSON leaf value (null, boolean, number, or string). */
export type JsonPrimitive = null | boolean | number | string;

/**
 * A JSON array whose elements are recursively JSON-serialisable.
 *
 * Note: this is typed as `JsonValue[]` rather than `readonly JsonValue[]` so
 * it is assignable from both mutable and readonly arrays at the call site.
 */
export type JsonArray = JsonValue[];

/**
 * A plain JSON object whose values are recursively JSON-serialisable.
 *
 * The `readonly` index signature prevents accidental mutation after a value
 * has been type-asserted as `JsonObject`.
 */
export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * Any value that can be losslessly round-tripped through `JSON.stringify` /
 * `JSON.parse`.
 *
 * Excludes: `undefined`, `bigint`, `symbol`, `Function`, `Date`, `Map`,
 * `Set`, `RegExp`, and class instances. Also excludes non-finite numbers
 * (`NaN`, `Infinity`) which `JSON.stringify` silently converts to `null`.
 */
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/**
 * Alias for {@link JsonValue} — represents data that can safely cross the
 * Electron IPC bridge without loss of fidelity.
 *
 * Use this type in handler signatures to document intent:
 *
 * ```ts
 * async function saveSettings(settings: BridgePayload): Promise<BridgePayload> { … }
 * ```
 */
export type BridgePayload = JsonValue;

// ─── Runtime guards ───────────────────────────────────────────────────────────

/**
 * Returns `true` if `value` is a JSON-serialisable {@link BridgePayload}.
 *
 * This is a deep check — every nested array element and object value is
 * validated recursively. Non-finite numbers (`NaN`, `Infinity`) return `false`
 * because `JSON.stringify` silently converts them to `null`, breaking the
 * round-trip contract.
 *
 * @example
 * ```ts
 * isBridgePayload({ id: '1', scores: [10, 20] }) // true
 * isBridgePayload({ date: new Date() })           // false — Date instance
 * isBridgePayload(NaN)                            // false — non-finite number
 * isBridgePayload(undefined)                      // false
 * ```
 */
export function isBridgePayload(value: unknown): value is BridgePayload {
  return isBridgePayloadInner(value, new WeakSet<object>());
}

function isBridgePayloadInner(value: unknown, seen: WeakSet<object>): boolean {
  if (value === null) return true;

  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;

    case 'number':
      // NaN and ±Infinity are silently converted to `null` by JSON.stringify
      return Number.isFinite(value);

    case 'object': {
      // Detect cyclic references — return false rather than infinite-recurse
      if (seen.has(value as object)) return false;
      seen.add(value as object);

      if (Array.isArray(value)) {
        return value.every(el => isBridgePayloadInner(el, seen));
      }

      // Only accept plain objects — reject Date, RegExp, Map, Set, etc.
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null) return false;

      return Object.values(value as Record<string, unknown>).every(v => isBridgePayloadInner(v, seen));
    }

    default:
      // undefined, bigint, symbol, function
      return false;
  }
}

/**
 * Asserts that `value` is a JSON-serialisable {@link BridgePayload}.
 *
 * Throws {@link InvalidBridgePayloadError} if not. The optional `context` string
 * is included in the error message and its `context` record for structured logging.
 *
 * @example
 * ```ts
 * assertBridgePayload(req.body, 'saveSettings:input');
 * // body is now typed as BridgePayload
 * ```
 *
 * @throws {InvalidBridgePayloadError}
 */
export function assertBridgePayload(
  value: unknown,
  context?: string,
): asserts value is BridgePayload {
  if (!isBridgePayload(value)) {
    throw new InvalidBridgePayloadError(context);
  }
}

// ─── Schema interface ─────────────────────────────────────────────────────────

/**
 * Minimum interface for a validation schema that can wrap an IPC handler.
 *
 * Every Zod schema (`.parse`), Valibot schema (`parse`), and ArkType type
 * satisfies this interface — no adapter needed. You can also implement it
 * directly:
 *
 * ```ts
 * const UuidSchema: BridgeSchema<string> = {
 *   parse(value: unknown): string {
 *     if (typeof value !== 'string' || !/^[\w-]{36}$/.test(value)) {
 *       throw new Error('Expected UUID string');
 *     }
 *     return value;
 *   },
 * };
 * ```
 *
 * @typeParam TOut - The validated output type. `parse` must return this type or throw.
 */
export interface BridgeSchema<TOut> {
  /**
   * Validates `value` and returns the parsed output.
   * Must throw a descriptive error on validation failure.
   */
  parse(value: unknown): TOut;
}

// ─── Validation HOF ───────────────────────────────────────────────────────────

/**
 * Wraps an IPC handler with **input validation** using any
 * {@link BridgeSchema}-compatible schema library.
 *
 * The returned handler accepts `unknown` input (as it arrives from the IPC
 * layer), validates and parses it through `schema.parse`, then calls the
 * original handler with the fully-typed result.
 *
 * If `schema.parse` throws, the error propagates to the renderer as a
 * rejected promise — Electron forwards handler errors automatically.
 *
 * ### Zod example
 *
 * ```ts
 * import { z }            from 'zod';
 * import { defineIpcApi } from 'electron-ipc-helper';
 * import { withValidation } from 'electron-ipc-helper/boundary';
 *
 * const GetUserInput = z.object({ id: z.string().uuid() });
 * type GetUserInput  = z.infer<typeof GetUserInput>;
 *
 * export const api = defineIpcApi({
 *   getUser: withValidation(GetUserInput, async ({ id }: GetUserInput) =>
 *     db.users.find(id),
 *   ),
 * });
 * ```
 *
 * ### Hand-rolled schema example
 *
 * ```ts
 * const NonEmptyString: BridgeSchema<string> = {
 *   parse(v: unknown) {
 *     if (typeof v !== 'string' || v.trim() === '') throw new Error('Expected non-empty string');
 *     return v.trim();
 *   },
 * };
 *
 * const api = defineIpcApi({
 *   ping: withValidation(NonEmptyString, async (msg) => `pong: ${msg}`),
 * });
 * ```
 *
 * @param schema  - A {@link BridgeSchema} whose `parse` method validates and
 *                  transforms the raw input.
 * @param handler - The underlying async handler that receives the parsed input.
 * @returns       A new async function that accepts `unknown` input and returns
 *                the handler's output.
 */
export function withValidation<TIn, TOut>(
  schema: BridgeSchema<TIn>,
  handler: (input: TIn) => Promise<TOut>,
): (raw: unknown) => Promise<TOut> {
  return async (raw: unknown): Promise<TOut> => {
    const parsed = schema.parse(raw);
    return handler(parsed);
  };
}

/**
 * Wraps an IPC handler with **output validation** — ensures that the value
 * returned by the handler is itself a valid, schema-conforming payload before
 * it crosses the bridge back to the renderer.
 *
 * Useful when you want to guarantee a stable response shape — for example, to
 * strip internal fields (passwords, secrets) from a database entity before
 * sending it to the renderer.
 *
 * ### Example
 *
 * ```ts
 * import { z }                  from 'zod';
 * import { withOutputValidation } from 'electron-ipc-helper/boundary';
 *
 * // Only the id, name, and email fields are sent to the renderer.
 * const PublicUser = z.object({
 *   id:    z.string(),
 *   name:  z.string(),
 *   email: z.string().email(),
 * });
 *
 * export const api = defineIpcApi({
 *   getUser: withOutputValidation(PublicUser, async (id: string) =>
 *     db.users.findOrThrow(id), // returns the full entity, including secrets
 *   ),
 * });
 * ```
 *
 * @param schema  - A {@link BridgeSchema} that validates (and optionally strips)
 *                  the handler's return value.
 * @param handler - The underlying async handler.
 * @returns       A new async function whose return value is always validated by
 *                `schema.parse` before being returned.
 */
export function withOutputValidation<TIn extends unknown[], TOut>(
  schema: BridgeSchema<TOut>,
  handler: (...args: TIn) => Promise<TOut>,
): (...args: TIn) => Promise<TOut> {
  return async (...args: TIn): Promise<TOut> => {
    const result = await handler(...args);
    return schema.parse(result);
  };
}

/**
 * Composes input **and** output validation into a single handler wrapper.
 *
 * Equivalent to `withOutputValidation(outputSchema, withValidation(inputSchema, handler))`.
 *
 * ### Example
 *
 * ```ts
 * import { z }               from 'zod';
 * import { withBoundary }    from 'electron-ipc-helper/boundary';
 *
 * const UpdateInput  = z.object({ id: z.string(), name: z.string().min(1) });
 * const PublicUser   = z.object({ id: z.string(), name: z.string() });
 *
 * export const api = defineIpcApi({
 *   updateUser: withBoundary(UpdateInput, PublicUser, async (input) =>
 *     db.users.update(input),
 *   ),
 * });
 * ```
 *
 * @param inputSchema  - Validates (and transforms) the raw input argument.
 * @param outputSchema - Validates (and strips) the handler's return value.
 * @param handler      - The underlying async handler.
 */
export function withBoundary<TIn, TOut>(
  inputSchema: BridgeSchema<TIn>,
  outputSchema: BridgeSchema<TOut>,
  handler: (input: TIn) => Promise<TOut>,
): (raw: unknown) => Promise<TOut> {
  return async (raw: unknown): Promise<TOut> => {
    const parsed = inputSchema.parse(raw);
    const result = await handler(parsed);
    return outputSchema.parse(result);
  };
}
