/**
 * @module negotiation
 *
 * Capability negotiation ("handshake") system for electron-ipc-helper adapters.
 *
 * When an adapter plugin is initialised, the host calls `plugin.getManifest()`
 * to retrieve its self-declared capability manifest, then runs `negotiate()` to
 * compare that manifest against the host's requirements. The result is stored
 * on the `PluginHost` so consumers can query it at any time.
 *
 * ## Why negotiation?
 *
 * Without negotiation, a consumer discovers capability mismatches at runtime
 * (wrong payload size, missing binary support, protocol drift between the core
 * and an old adapter package). The handshake makes mismatches loud and typed at
 * startup, before any real IPC work happens.
 *
 * ## Layers
 *
 * 1. **`AdapterManifest`** — static self-description returned by the adapter.
 * 2. **`CapabilityRequirements`** — what the host/app needs (consumer-configured).
 * 3. **`NegotiationResult`** — outcome: accepted/rejected + warnings + effective caps.
 * 4. **`NegotiablePlugin`** — interface adapter plugins implement to participate.
 * 5. **`negotiate()`** — pure comparison function; no side-effects.
 *
 * ## Protocol versioning
 *
 * `PROTOCOL_VERSION` is incremented when a breaking change is made to the
 * negotiation contract itself. Adapters that return a `protocolVersion` lower
 * than the host's `minProtocolVersion` requirement will be rejected. This gives
 * consumers a clear path to enforce a minimum adapter version in production.
 *
 * ## Example
 *
 * ```ts
 * // Host config
 * const host = new PluginHost({
 *   requirements: {
 *     minProtocolVersion: 1,
 *     requiresBinary: true,
 *     minPayloadBytes: 4 * 1024 * 1024, // 4 MB
 *   },
 * });
 *
 * host.register(new AssemblyScriptPlugin({ ... }));
 * await host.init();
 * // → logs warnings if caps mismatch, rejects if hard requirements unmet
 *
 * const result = host.getNegotiationResult('assemblyscript:math');
 * console.log(result?.effectiveCapabilities.supportsBinary); // true
 * ```
 */

// ─── Protocol version ─────────────────────────────────────────────────────────

/**
 * The current capability negotiation protocol version.
 *
 * Increment this constant (and the adapter's `protocolVersion`) whenever a
 * **breaking** change is made to the negotiation contract (e.g. a required
 * field is added to `AdapterManifest` or the semantics of an existing field
 * change).
 *
 * Non-breaking additions (new optional fields) do NOT require a bump.
 */
export const PROTOCOL_VERSION = 1 as const;

// ─── AdapterManifest ──────────────────────────────────────────────────────────

/**
 * Static self-description returned by a {@link NegotiablePlugin}.
 *
 * This manifest must be returnable **before** the plugin's `init()` hook runs
 * so that the host can decide whether to proceed with initialisation.
 *
 * All fields except `name`, `version`, and `protocolVersion` are optional so
 * that simple adapters don't need to fill in every field.
 */
export interface AdapterManifest {
  /**
   * Fully-qualified adapter package name.
   * @example `'@electron-ipc-helper/adapter-assemblyscript'`
   */
  readonly name: string;

  /**
   * Semver version string of the adapter package.
   * @example `'0.1.0'`
   */
  readonly version: string;

  /**
   * Negotiation protocol version this adapter speaks.
   * Compare against {@link PROTOCOL_VERSION} and the host's
   * `minProtocolVersion` requirement.
   */
  readonly protocolVersion: number;

  /**
   * Set to `true` if the adapter can efficiently handle binary payloads
   * (`Uint8Array`, `ArrayBuffer`) without intermediate base64 encoding.
   */
  readonly supportsBinary?: boolean;

  /**
   * Set to `true` if the adapter supports streaming data across the bridge
   * (e.g. `ReadableStream`, chunked transfers).
   */
  readonly supportsStreaming?: boolean;

  /**
   * Maximum payload size the adapter can handle in a single call, in bytes.
   * `undefined` means there is no adapter-imposed limit (the OS/Electron limit
   * still applies).
   */
  readonly maxPayloadBytes?: number;

  /**
   * Adapter-specific capability metadata for downstream consumers.
   *
   * Use this for capabilities that don't fit the structured fields above —
   * for example, the WASM runtime type, compression support, concurrency model,
   * or negotiated cipher suite.
   */
  readonly capabilities?: Readonly<Record<string, unknown>>;
}

// ─── CapabilityRequirements ───────────────────────────────────────────────────

/**
 * The minimum capability requirements the host will accept from an adapter.
 *
 * Set these in `PluginHostOptions.requirements`. Requirements that are
 * `undefined` are treated as "no constraint" — the adapter passes by default.
 *
 * Hard requirements (`minProtocolVersion`, `requiresBinary`, `requiresStreaming`)
 * cause the negotiation to be *rejected* if unmet. Soft requirements
 * (`minPayloadBytes`) produce a *warning* but still accept the adapter.
 */
export interface CapabilityRequirements {
  /**
   * The minimum `protocolVersion` the host will accept.
   *
   * Adapters with a `protocolVersion` below this threshold are **rejected**.
   * Defaults to `1` if unset.
   */
  minProtocolVersion?: number;

  /**
   * If `true`, adapters that do not declare `supportsBinary: true` are **rejected**.
   */
  requiresBinary?: boolean;

  /**
   * If `true`, adapters that do not declare `supportsStreaming: true` are **rejected**.
   */
  requiresStreaming?: boolean;

  /**
   * Minimum payload capacity (bytes) the adapter must support.
   *
   * If the adapter's `maxPayloadBytes` is defined and smaller than this value,
   * a **warning** is emitted (not a rejection) — the caller can decide whether
   * to degrade gracefully or refuse to use the adapter.
   */
  minPayloadBytes?: number;
}

// ─── NegotiationResult ───────────────────────────────────────────────────────

/**
 * The outcome of a capability negotiation between a plugin's
 * {@link AdapterManifest} and the host's {@link CapabilityRequirements}.
 */
export interface NegotiationResult {
  /**
   * `true` if all **hard** requirements were satisfied.
   * `false` means the adapter should not be used for production calls.
   */
  readonly accepted: boolean;

  /** The full manifest as returned by the adapter. */
  readonly manifest: AdapterManifest;

  /**
   * Human-readable descriptions of capability gaps that did **not** cause
   * rejection but may affect behaviour (soft requirement mismatches,
   * non-fatal informational notes).
   */
  readonly warnings: readonly string[];

  /**
   * Reasons why the negotiation was rejected.
   * Empty when `accepted === true`.
   */
  readonly rejections: readonly string[];

  /**
   * The effective capabilities agreed upon — the intersection of what the
   * adapter declared and what the host can use.
   */
  readonly effectiveCapabilities: {
    readonly protocolVersion: number;
    readonly supportsBinary: boolean;
    readonly supportsStreaming: boolean;
    readonly maxPayloadBytes: number | undefined;
  };
}

// ─── NegotiablePlugin ─────────────────────────────────────────────────────────

/**
 * Interface for plugins that participate in capability negotiation.
 *
 * Implement `getManifest()` on your plugin class to return an
 * {@link AdapterManifest}. The `PluginHost` will call it automatically before
 * the `init()` hook runs.
 *
 * ```ts
 * export class MyPlugin implements Plugin, NegotiablePlugin {
 *   readonly name = 'my-plugin';
 *
 *   getManifest(): AdapterManifest {
 *     return {
 *       name: 'my-plugin',
 *       version: '1.0.0',
 *       protocolVersion: 1,
 *       supportsBinary: false,
 *       supportsStreaming: false,
 *     };
 *   }
 *
 *   async init(ctx: PluginContext): Promise<void> { ... }
 * }
 * ```
 */
export interface NegotiablePlugin {
  /**
   * Returns the adapter's capability manifest.
   *
   * This method MUST be callable before `init()` runs. Do not rely on any
   * state that is set up during `init()`. The manifest should be a static
   * or near-static description of what the adapter can do.
   *
   * May be sync or async.
   */
  getManifest(): AdapterManifest | Promise<AdapterManifest>;
}

// ─── Type guard ───────────────────────────────────────────────────────────────

/**
 * Returns `true` if `plugin` implements {@link NegotiablePlugin}
 * (i.e. has a `getManifest` method).
 *
 * @example
 * ```ts
 * if (isNegotiablePlugin(plugin)) {
 *   const manifest = await plugin.getManifest();
 * }
 * ```
 */
export function isNegotiablePlugin(plugin: unknown): plugin is NegotiablePlugin {
  return (
    plugin !== null &&
    typeof plugin === 'object' &&
    'getManifest' in plugin &&
    typeof (plugin as Record<string, unknown>)['getManifest'] === 'function'
  );
}

// ─── negotiate() ──────────────────────────────────────────────────────────────

/**
 * Pure capability negotiation function.
 *
 * Compares an {@link AdapterManifest} against optional
 * {@link CapabilityRequirements} and returns a {@link NegotiationResult}
 * describing the outcome.
 *
 * This function has **no side-effects** — it never throws, never logs, and
 * never mutates its arguments. All decisions (logging, rejection behaviour) are
 * left to the caller (`PluginHost`).
 *
 * @param manifest      - The manifest returned by the adapter.
 * @param requirements  - The host's minimum requirements. Defaults to no constraints.
 * @returns A {@link NegotiationResult} with `accepted`, `warnings`, `rejections`,
 *          and `effectiveCapabilities`.
 *
 * @example
 * ```ts
 * const result = negotiate(manifest, { requiresBinary: true, minProtocolVersion: 1 });
 *
 * if (!result.accepted) {
 *   console.error('Adapter rejected:', result.rejections);
 * }
 * for (const w of result.warnings) {
 *   console.warn('Capability gap:', w);
 * }
 * ```
 */
export function negotiate(
  manifest: AdapterManifest,
  requirements: CapabilityRequirements = {},
): NegotiationResult {
  const warnings: string[] = [];
  const rejections: string[] = [];

  // ── Protocol version check (hard requirement) ──────────────────────────────
  const minProto = requirements.minProtocolVersion ?? 1;
  if (manifest.protocolVersion < minProto) {
    rejections.push(
      `Protocol version mismatch: adapter speaks v${manifest.protocolVersion}, ` +
      `host requires ≥ v${minProto}. Update "${manifest.name}" to a newer version.`,
    );
  }

  // ── Binary support check (hard requirement) ────────────────────────────────
  if (requirements.requiresBinary === true && manifest.supportsBinary !== true) {
    rejections.push(
      `Binary payload support required but "${manifest.name}" does not declare ` +
      `supportsBinary: true. Binary transfers will not work correctly.`,
    );
  }

  // ── Streaming support check (hard requirement) ─────────────────────────────
  if (requirements.requiresStreaming === true && manifest.supportsStreaming !== true) {
    rejections.push(
      `Streaming support required but "${manifest.name}" does not declare ` +
      `supportsStreaming: true. Streaming calls will not work correctly.`,
    );
  }

  // ── Payload size check (soft requirement — warning only) ───────────────────
  if (
    requirements.minPayloadBytes !== undefined &&
    manifest.maxPayloadBytes !== undefined &&
    manifest.maxPayloadBytes < requirements.minPayloadBytes
  ) {
    const adapterMb = (manifest.maxPayloadBytes / 1024 / 1024).toFixed(1);
    const requiredMb = (requirements.minPayloadBytes / 1024 / 1024).toFixed(1);
    warnings.push(
      `Payload size gap: adapter "${manifest.name}" supports up to ${adapterMb} MB ` +
      `but the host expects up to ${requiredMb} MB. Large payloads may be rejected.`,
    );
  }

  // ── Informational notes ────────────────────────────────────────────────────
  if (manifest.supportsStreaming !== true && requirements.requiresStreaming !== true) {
    // Streaming is not required but also not supported — note it for visibility
    // Only emit when the adapter explicitly declares false (not just undefined)
    if (manifest.supportsStreaming === false) {
      warnings.push(
        `"${manifest.name}" does not support streaming. ` +
        `This is fine if your app does not use streaming transfers.`,
      );
    }
  }

  const accepted = rejections.length === 0;

  return Object.freeze({
    accepted,
    manifest,
    warnings: Object.freeze(warnings),
    rejections: Object.freeze(rejections),
    effectiveCapabilities: Object.freeze({
      protocolVersion: manifest.protocolVersion,
      supportsBinary: manifest.supportsBinary === true,
      supportsStreaming: manifest.supportsStreaming === true,
      maxPayloadBytes: manifest.maxPayloadBytes,
    }),
  });
}
