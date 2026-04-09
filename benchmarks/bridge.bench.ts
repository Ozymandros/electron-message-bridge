/**
 * Bridge boundary performance benchmarks.
 *
 * Measures the overhead introduced by each layer of the IPC boundary stack:
 *
 * 1. `isBridgePayload`      — deep JSON-serialisability guard
 * 2. `assertBridgePayload`  — guard + throw on failure
 * 3. `withValidation`       — schema HOF wrapper overhead vs raw handler
 * 4. `withOutputValidation` — output schema HOF overhead
 * 5. `withBoundary`         — bidirectional validation overhead
 * 6. `negotiate()`          — capability handshake overhead
 *
 * ## Reading the numbers
 *
 * Each benchmark reports:
 *   - `avg`  — arithmetic mean latency
 *   - `p75`  — 75th percentile (most calls land here or below)
 *   - `p99`  — 99th percentile (tail latency — CI budget gate)
 *   - `min`  — best-case (V8 fully JIT-compiled hot path)
 *
 * ## Budget targets
 *
 *  Operation                         | p99 budget
 * -----------------------------------|------------
 *  isBridgePayload (small primitive) | < 0.5 µs
 *  isBridgePayload (100-key object)  | < 10 µs
 *  withValidation overhead           | < 2 µs
 *  withBoundary overhead             | < 4 µs
 *  negotiate() single call           | < 5 µs
 *
 * Run with: vitest bench
 */

import { bench, describe } from 'vitest';
import { isBridgePayload, assertBridgePayload, withValidation, withOutputValidation, withBoundary } from '../src/boundary.js';
import type { BridgeSchema } from '../src/boundary.js';
import { negotiate } from '../src/negotiation.js';
import type { AdapterManifest } from '../src/negotiation.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PRIMITIVE_PAYLOAD = 42;
const STRING_PAYLOAD    = 'hello, bridge!';
const NULL_PAYLOAD      = null;

const FLAT_OBJECT_PAYLOAD = {
  id: 'usr_abc123',
  name: 'Alice',
  email: 'alice@example.com',
  age: 30,
  active: true,
  score: 98.6,
};

// 50-key nested object — representative of a real IPC response
const MEDIUM_OBJECT_PAYLOAD = Object.fromEntries(
  Array.from({ length: 50 }, (_, i) => [
    `field_${i}`,
    i % 5 === 0 ? { nested: `value_${i}`, count: i } : `string_value_${i}`,
  ]),
);

// 100-key deep nested object — stress test for the recursive guard
const LARGE_NESTED_PAYLOAD = {
  metadata: {
    version: '1.0.0',
    timestamp: 1_700_000_000,
    tags: Array.from({ length: 20 }, (_, i) => `tag-${i}`),
  },
  items: Array.from({ length: 50 }, (_, i) => ({
    id: `item_${i}`,
    value: i * 3.14,
    active: i % 2 === 0,
    labels: [`a_${i}`, `b_${i}`],
  })),
  summary: { total: 50, active: 25, score: 77.5 },
};

// Invalid payload — non-serialisable (Date) at top level
const INVALID_DATE_PAYLOAD    = new Date();
// Invalid payload — NaN buried in an array (must recurse to find it)
const INVALID_DEEP_NAN: unknown[] = Array.from({ length: 20 }, (_, i) =>
  i === 19 ? NaN : i,
);

// Hand-rolled Zod-shaped schemas
const IdentitySchema: BridgeSchema<unknown> = { parse: (v) => v };

const StringSchema: BridgeSchema<string> = {
  parse(v: unknown): string {
    if (typeof v !== 'string') throw new TypeError('Expected string');
    return v;
  },
};

const FlatObjectSchema: BridgeSchema<typeof FLAT_OBJECT_PAYLOAD> = {
  parse(v: unknown) {
    const obj = v as typeof FLAT_OBJECT_PAYLOAD;
    if (typeof obj.id !== 'string') throw new TypeError('id required');
    return obj;
  },
};

// Benchmark manifest (reused across negotiation benches)
const SAMPLE_MANIFEST: AdapterManifest = {
  name: '@electron-ipc-helper/adapter-assemblyscript',
  version: '0.1.0',
  protocolVersion: 1,
  supportsBinary: true,
  supportsStreaming: false,
  capabilities: { wasmRuntime: 'assemblyscript', managedMemory: true },
};

// ─── isBridgePayload ──────────────────────────────────────────────────────────

describe('isBridgePayload — valid payloads', () => {
  bench('primitive number', () => {
    isBridgePayload(PRIMITIVE_PAYLOAD);
  });

  bench('primitive string', () => {
    isBridgePayload(STRING_PAYLOAD);
  });

  bench('null', () => {
    isBridgePayload(NULL_PAYLOAD);
  });

  bench('flat object (6 keys)', () => {
    isBridgePayload(FLAT_OBJECT_PAYLOAD);
  });

  bench('medium object (50 keys, mixed nested)', () => {
    isBridgePayload(MEDIUM_OBJECT_PAYLOAD);
  });

  bench('large nested object (100+ total values)', () => {
    isBridgePayload(LARGE_NESTED_PAYLOAD);
  });

  bench('array of 50 primitives', () => {
    isBridgePayload(Array.from({ length: 50 }, (_, i) => i));
  });
});

describe('isBridgePayload — invalid payloads (short-circuit / deep scan)', () => {
  bench('Date at top level (instant rejection)', () => {
    isBridgePayload(INVALID_DATE_PAYLOAD);
  });

  bench('NaN buried at end of 20-element array (full scan)', () => {
    isBridgePayload(INVALID_DEEP_NAN);
  });

  bench('undefined', () => {
    isBridgePayload(undefined);
  });

  bench('Function', () => {
    isBridgePayload(() => {});
  });

  bench('BigInt', () => {
    isBridgePayload(BigInt(42));
  });
});

// ─── assertBridgePayload ──────────────────────────────────────────────────────

describe('assertBridgePayload', () => {
  bench('valid flat object — no throw', () => {
    assertBridgePayload(FLAT_OBJECT_PAYLOAD);
  });

  bench('valid large nested — no throw', () => {
    assertBridgePayload(LARGE_NESTED_PAYLOAD);
  });

  bench('invalid (Date) — throws InvalidPayloadError', () => {
    try {
      assertBridgePayload(INVALID_DATE_PAYLOAD);
    } catch {
      // expected
    }
  });
});

// ─── withValidation ───────────────────────────────────────────────────────────

describe('withValidation — HOF wrapper overhead', () => {
  // Baseline: raw async handler with no wrapping
  const rawHandler = async (v: unknown) => v;
  // With identity schema (parse is a no-op — measures pure HOF overhead)
  const identityWrapped = withValidation(IdentitySchema, rawHandler);
  // With real string schema
  const stringWrapped = withValidation(StringSchema, async (s: string) => s.length);
  // With object schema
  const objectWrapped = withValidation(FlatObjectSchema, async (o) => o.id);

  bench('raw async handler (baseline)', async () => {
    await rawHandler(FLAT_OBJECT_PAYLOAD);
  });

  bench('withValidation — identity schema (HOF overhead only)', async () => {
    await identityWrapped(FLAT_OBJECT_PAYLOAD);
  });

  bench('withValidation — string schema', async () => {
    await stringWrapped(STRING_PAYLOAD);
  });

  bench('withValidation — object schema', async () => {
    await objectWrapped(FLAT_OBJECT_PAYLOAD);
  });
});

// ─── withOutputValidation ─────────────────────────────────────────────────────

describe('withOutputValidation — output schema overhead', () => {
  const rawHandler = async (x: number) => x * 2;
  const identitySchema: BridgeSchema<number> = { parse: (v) => v as number };
  const wrapped = withOutputValidation(identitySchema, rawHandler);

  bench('raw async handler returning number (baseline)', async () => {
    await rawHandler(42);
  });

  bench('withOutputValidation — identity output schema', async () => {
    await wrapped(42);
  });
});

// ─── withBoundary ─────────────────────────────────────────────────────────────

describe('withBoundary — bidirectional validation overhead', () => {
  const handler = async (s: string) => `result:${s}`;

  const inputSchema: BridgeSchema<string> = {
    parse(v: unknown) {
      if (typeof v !== 'string') throw new TypeError('not a string');
      return v;
    },
  };
  const outputSchema: BridgeSchema<string> = {
    parse(v: unknown) {
      if (typeof v !== 'string') throw new TypeError('not a string');
      return v;
    },
  };

  const rawAsync = async (v: unknown) => `result:${String(v)}`;
  const bounded  = withBoundary(inputSchema, outputSchema, handler);

  bench('raw async handler (baseline)', async () => {
    await rawAsync('hello');
  });

  bench('withBoundary — string input + string output validation', async () => {
    await bounded('hello');
  });
});

// ─── negotiate() ─────────────────────────────────────────────────────────────

describe('negotiate() — capability handshake overhead', () => {
  bench('no requirements (fast path)', () => {
    negotiate(SAMPLE_MANIFEST);
  });

  bench('all requirements provided — all met', () => {
    negotiate(SAMPLE_MANIFEST, {
      minProtocolVersion: 1,
      requiresBinary: true,
      minPayloadBytes: 1 * 1024 * 1024,
    });
  });

  bench('requirements provided — protocol mismatch (rejection path)', () => {
    negotiate(SAMPLE_MANIFEST, { minProtocolVersion: 99 });
  });

  bench('requirements provided — payload size warning path', () => {
    negotiate(
      { ...SAMPLE_MANIFEST, maxPayloadBytes: 1 * 1024 * 1024 },
      { minPayloadBytes: 10 * 1024 * 1024 },
    );
  });
});
