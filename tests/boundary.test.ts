/**
 * Tests for src/boundary.ts — bridge payload contracts.
 *
 * Coverage areas:
 * - isBridgePayload: all JsonValue leaves, arrays, objects, edge cases
 * - assertBridgePayload: throws InvalidPayloadError on non-JSON values
 * - BridgeSchema interface compatibility (Zod-shaped and hand-rolled schemas)
 * - withValidation: input parsing HOF
 * - withOutputValidation: output parsing HOF
 * - withBoundary: bidirectional validation HOF
 * - Error propagation (schema parse errors bubble up correctly)
 */

import { describe, expect, it, vi } from 'vitest';
import {
  isBridgePayload,
  assertBridgePayload,
  withValidation,
  withOutputValidation,
  withBoundary,
} from '../src/boundary.js';
import type { BridgeSchema, JsonValue } from '../src/boundary.js';
import { InvalidBridgePayloadError } from '../src/errors.js';

// ─── isBridgePayload ──────────────────────────────────────────────────────────

describe('isBridgePayload', () => {
  describe('JSON primitives (valid)', () => {
    it('accepts null', () => {
      expect(isBridgePayload(null)).toBe(true);
    });

    it('accepts boolean true', () => {
      expect(isBridgePayload(true)).toBe(true);
    });

    it('accepts boolean false', () => {
      expect(isBridgePayload(false)).toBe(true);
    });

    it('accepts finite positive number', () => {
      expect(isBridgePayload(42)).toBe(true);
    });

    it('accepts zero', () => {
      expect(isBridgePayload(0)).toBe(true);
    });

    it('accepts negative number', () => {
      expect(isBridgePayload(-3.14)).toBe(true);
    });

    it('accepts empty string', () => {
      expect(isBridgePayload('')).toBe(true);
    });

    it('accepts non-empty string', () => {
      expect(isBridgePayload('hello')).toBe(true);
    });
  });

  describe('JSON arrays (valid)', () => {
    it('accepts empty array', () => {
      expect(isBridgePayload([])).toBe(true);
    });

    it('accepts array of primitives', () => {
      expect(isBridgePayload([1, 'two', null, true])).toBe(true);
    });

    it('accepts nested array', () => {
      expect(isBridgePayload([[1, 2], [3, 4]])).toBe(true);
    });

    it('accepts array of objects', () => {
      expect(isBridgePayload([{ id: 1 }, { id: 2 }])).toBe(true);
    });
  });

  describe('JSON objects (valid)', () => {
    it('accepts empty object', () => {
      expect(isBridgePayload({})).toBe(true);
    });

    it('accepts flat object', () => {
      expect(isBridgePayload({ name: 'Alice', age: 30, active: true })).toBe(true);
    });

    it('accepts deeply nested object', () => {
      expect(isBridgePayload({
        level1: { level2: { level3: { value: 'deep' } } },
      })).toBe(true);
    });

    it('accepts null-prototype plain object', () => {
      const obj = Object.create(null) as Record<string, JsonValue>;
      obj['key'] = 'value';
      expect(isBridgePayload(obj)).toBe(true);
    });
  });

  describe('Non-serialisable values (invalid)', () => {
    it('rejects undefined', () => {
      expect(isBridgePayload(undefined)).toBe(false);
    });

    it('rejects NaN', () => {
      expect(isBridgePayload(NaN)).toBe(false);
    });

    it('rejects Infinity', () => {
      expect(isBridgePayload(Infinity)).toBe(false);
    });

    it('rejects -Infinity', () => {
      expect(isBridgePayload(-Infinity)).toBe(false);
    });

    it('rejects BigInt', () => {
      expect(isBridgePayload(BigInt(42))).toBe(false);
    });

    it('rejects Symbol', () => {
      expect(isBridgePayload(Symbol('id'))).toBe(false);
    });

    it('rejects Function', () => {
      expect(isBridgePayload(() => {})).toBe(false);
    });

    it('rejects Date instance', () => {
      expect(isBridgePayload(new Date())).toBe(false);
    });

    it('rejects RegExp', () => {
      expect(isBridgePayload(/pattern/)).toBe(false);
    });

    it('rejects Map', () => {
      expect(isBridgePayload(new Map())).toBe(false);
    });

    it('rejects Set', () => {
      expect(isBridgePayload(new Set())).toBe(false);
    });

    it('rejects class instance', () => {
      class Foo { x = 1; }
      expect(isBridgePayload(new Foo())).toBe(false);
    });

    it('rejects Uint8Array', () => {
      expect(isBridgePayload(new Uint8Array([1, 2, 3]))).toBe(false);
    });
  });

  describe('Nested invalid values (deep checks)', () => {
    it('rejects array containing NaN', () => {
      expect(isBridgePayload([1, NaN, 3])).toBe(false);
    });

    it('rejects array containing undefined', () => {
      expect(isBridgePayload([1, undefined, 3])).toBe(false);
    });

    it('rejects object with Date value', () => {
      expect(isBridgePayload({ created: new Date() })).toBe(false);
    });

    it('rejects object with function value', () => {
      expect(isBridgePayload({ fn: () => {} })).toBe(false);
    });

    it('rejects deeply nested invalid value', () => {
      expect(isBridgePayload({
        level1: { level2: { level3: { bad: undefined } } },
      })).toBe(false);
    });
  });

  describe('Cyclic references (safe, returns false)', () => {
    it('rejects a self-referencing object', () => {
      const obj: Record<string, unknown> = {};
      obj['self'] = obj;
      expect(isBridgePayload(obj)).toBe(false);
    });

    it('rejects a self-referencing array', () => {
      const arr: unknown[] = [];
      arr.push(arr);
      expect(isBridgePayload(arr)).toBe(false);
    });

    it('rejects a mutually-referencing pair of objects', () => {
      const a: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      a['b'] = b;
      b['a'] = a;
      expect(isBridgePayload(a)).toBe(false);
    });
  });
});

// ─── assertBridgePayload ──────────────────────────────────────────────────────

describe('assertBridgePayload', () => {
  it('does not throw for valid JSON value', () => {
    expect(() => assertBridgePayload({ id: '123', count: 5 })).not.toThrow();
  });

  it('throws InvalidBridgePayloadError for undefined', () => {
    expect(() => assertBridgePayload(undefined)).toThrow(InvalidBridgePayloadError);
  });

  it('throws InvalidBridgePayloadError for NaN', () => {
    expect(() => assertBridgePayload(NaN)).toThrow(InvalidBridgePayloadError);
  });

  it('throws InvalidBridgePayloadError for Date instance', () => {
    expect(() => assertBridgePayload(new Date())).toThrow(InvalidBridgePayloadError);
  });

  it('includes context in the thrown error', () => {
    try {
      assertBridgePayload(undefined, 'getUser:input');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidBridgePayloadError);
      if (err instanceof InvalidBridgePayloadError) {
        expect(err.context['context']).toBe('getUser:input');
      }
    }
  });

  it('uses "(unknown)" as default context', () => {
    try {
      assertBridgePayload(undefined);
    } catch (err) {
      if (err instanceof InvalidBridgePayloadError) {
        expect(err.context['context']).toBe('(unknown)');
      }
    }
  });

  it('narrows the type after passing (TypeScript assertion)', () => {
    const raw: unknown = { id: '1', name: 'Bob' };
    assertBridgePayload(raw);
    // After the assertion, TypeScript knows raw is BridgePayload
    // This is a compile-time test — if it compiles, it passes
    const _typed: typeof raw = raw;
    expect(_typed).toBeDefined();
  });
});

// ─── withValidation ───────────────────────────────────────────────────────────

describe('withValidation', () => {
  // Minimal schema (Zod-shaped but hand-rolled — no Zod dep in core tests)
  function makeStringSchema(): BridgeSchema<string> {
    return {
      parse(value: unknown): string {
        if (typeof value !== 'string') {
          throw new TypeError(`Expected string, got ${typeof value}`);
        }
        return value;
      },
    };
  }

  function makeObjectSchema<T extends Record<string, unknown>>(
    validator: (v: unknown) => T,
  ): BridgeSchema<T> {
    return { parse: validator };
  }

  it('calls schema.parse with the raw input', async () => {
    const schema = { parse: vi.fn((v: unknown) => String(v)) };
    const handler = vi.fn(async (s: string) => s.toUpperCase());

    const wrapped = withValidation(schema, handler);
    await wrapped('hello');

    expect(schema.parse).toHaveBeenCalledWith('hello');
    expect(handler).toHaveBeenCalledWith('hello');
  });

  it('passes parsed value to handler', async () => {
    const schema = makeStringSchema();
    const handler = vi.fn(async (s: string) => `got: ${s}`);

    const wrapped = withValidation(schema, handler);
    const result = await wrapped('world');

    expect(result).toBe('got: world');
  });

  it('propagates schema parse error without calling handler', async () => {
    const schema = makeStringSchema();
    const handler = vi.fn(async (s: string) => s);

    const wrapped = withValidation(schema, handler);

    await expect(wrapped(42)).rejects.toThrow('Expected string');
    expect(handler).not.toHaveBeenCalled();
  });

  it('propagates handler errors', async () => {
    const schema = makeStringSchema();
    const handler = vi.fn(async (_s: string): Promise<string> => {
      throw new Error('db offline');
    });

    const wrapped = withValidation(schema, handler);

    await expect(wrapped('ok')).rejects.toThrow('db offline');
  });

  it('works with object schema (Zod-style)', async () => {
    type Input = { id: string };
    const schema = makeObjectSchema<Input>((v) => {
      const obj = v as Record<string, unknown>;
      if (typeof obj['id'] !== 'string') throw new TypeError('id must be string');
      return { id: obj['id'] };
    });

    const handler = vi.fn(async ({ id }: Input) => `user:${id}`);
    const wrapped = withValidation(schema, handler);

    await expect(wrapped({ id: 'abc123' })).resolves.toBe('user:abc123');
    await expect(wrapped({ id: 123 })).rejects.toThrow('id must be string');
  });

  it('transforms input (parse can modify values)', async () => {
    // Schema trims and lowercases
    const schema: BridgeSchema<string> = {
      parse(v: unknown) {
        if (typeof v !== 'string') throw new TypeError('not a string');
        return v.trim().toLowerCase();
      },
    };

    const captured: string[] = [];
    const handler = async (s: string) => { captured.push(s); return s; };
    const wrapped = withValidation(schema, handler);

    await wrapped('  HELLO  ');
    expect(captured[0]).toBe('hello');
  });
});

// ─── withOutputValidation ─────────────────────────────────────────────────────

describe('withOutputValidation', () => {
  it('calls schema.parse on the handler return value', async () => {
    const schema = { parse: vi.fn((v: unknown) => v) };
    const handler = async (x: number) => ({ result: x * 2 });

    const wrapped = withOutputValidation(schema, handler);
    await wrapped(5);

    expect(schema.parse).toHaveBeenCalledWith({ result: 10 });
  });

  it('returns schema.parse output (enables stripping)', async () => {
    // Schema strips the `secret` field
    const schema: BridgeSchema<{ id: string }> = {
      parse(v: unknown) {
        const obj = v as Record<string, unknown>;
        return { id: String(obj['id']) }; // drops other fields
      },
    };

    const handler = async (_id: string) => ({ id: _id, secret: 'pw123', other: 'data' });
    const wrapped = withOutputValidation(schema, handler);

    const result = await wrapped('user1');
    expect(result).toEqual({ id: 'user1' });
    expect((result as Record<string, unknown>)['secret']).toBeUndefined();
  });

  it('propagates output schema errors', async () => {
    const schema: BridgeSchema<string> = {
      parse(v: unknown) {
        if (typeof v !== 'string') throw new TypeError('output must be string');
        return v;
      },
    };

    const handler = async () => 42 as unknown as string;
    const wrapped = withOutputValidation(schema, handler);

    await expect(wrapped()).rejects.toThrow('output must be string');
  });

  it('passes all handler args through', async () => {
    const schema: BridgeSchema<number> = { parse: (v) => Number(v) };
    const handler = vi.fn(async (a: number, b: number) => a + b);

    const wrapped = withOutputValidation(schema, handler);
    const result = await wrapped(3, 4);

    expect(handler).toHaveBeenCalledWith(3, 4);
    expect(result).toBe(7);
  });
});

// ─── withBoundary ─────────────────────────────────────────────────────────────

describe('withBoundary', () => {
  type Input  = { name: string };
  type Output = { greeting: string };

  const inputSchema: BridgeSchema<Input> = {
    parse(v: unknown) {
      const obj = v as Record<string, unknown>;
      if (typeof obj['name'] !== 'string') throw new TypeError('name required');
      return { name: obj['name'] };
    },
  };

  const outputSchema: BridgeSchema<Output> = {
    parse(v: unknown) {
      const obj = v as Record<string, unknown>;
      if (typeof obj['greeting'] !== 'string') throw new TypeError('greeting required');
      return { greeting: obj['greeting'] };
    },
  };

  it('validates input then output and returns correctly', async () => {
    const handler = async ({ name }: Input): Promise<Output> => ({ greeting: `Hello, ${name}!` });
    const wrapped = withBoundary(inputSchema, outputSchema, handler);

    const result = await wrapped({ name: 'Alice' });
    expect(result).toEqual({ greeting: 'Hello, Alice!' });
  });

  it('throws on invalid input without calling handler', async () => {
    const handler = vi.fn(async (_: Input): Promise<Output> => ({ greeting: 'nope' }));
    const wrapped = withBoundary(inputSchema, outputSchema, handler);

    await expect(wrapped({ name: 42 })).rejects.toThrow('name required');
    expect(handler).not.toHaveBeenCalled();
  });

  it('throws on invalid output without masking the original error', async () => {
    const badHandler = async (_: Input): Promise<Output> =>
      ({ notGreeting: 'wrong shape' } as unknown as Output);

    const wrapped = withBoundary(inputSchema, outputSchema, badHandler);

    await expect(wrapped({ name: 'Bob' })).rejects.toThrow('greeting required');
  });

  it('is equivalent to composing withOutputValidation and withValidation', async () => {
    const handler = async ({ name }: Input): Promise<Output> => ({ greeting: `Hi ${name}` });

    const composed = withOutputValidation(
      outputSchema,
      withValidation(inputSchema, handler) as (...args: [Input]) => Promise<Output>,
    );
    const direct = withBoundary(inputSchema, outputSchema, handler);

    const [r1, r2] = await Promise.all([
      (composed as (v: unknown) => Promise<Output>)({ name: 'Charlie' }),
      direct({ name: 'Charlie' }),
    ]);
    expect(r1).toEqual(r2);
  });
});
