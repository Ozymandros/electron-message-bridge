/**
 * Tests for src/negotiation.ts — capability negotiation system.
 *
 * Coverage areas:
 * - negotiate(): all requirement combinations (protocol, binary, streaming, payload)
 * - negotiate(): effectiveCapabilities computation
 * - negotiate(): accepted vs rejected outcomes
 * - negotiate(): informational warnings (streaming disabled note)
 * - isNegotiablePlugin(): type guard correctness
 * - NegotiablePlugin integration with PluginHost (pre-init handshake)
 * - PluginHost.getNegotiationResult() / getAllNegotiationResults()
 * - PluginHost: getManifest() throwing is logged but does not abort init
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  negotiate,
  isNegotiablePlugin,
  PROTOCOL_VERSION,
} from '../src/negotiation.js';
import type {
  AdapterManifest,
  CapabilityRequirements,
  NegotiablePlugin,
} from '../src/negotiation.js';
import type { Plugin, PluginContext } from '../src/plugins.js';

/** Plugin + NegotiablePlugin fixture type usable with PluginHost.register(). */
type NegotiablePluginFixture = Plugin & NegotiablePlugin & {
  init?: (ctx: PluginContext) => void | Promise<void>;
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<AdapterManifest> = {}): AdapterManifest {
  return {
    name: 'test-adapter',
    version: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    supportsBinary: true,
    supportsStreaming: false,
    ...overrides,
  };
}

// ─── negotiate() — happy path ─────────────────────────────────────────────────

describe('negotiate() — accepted cases', () => {
  it('accepts a conforming manifest with no requirements', () => {
    const result = negotiate(makeManifest());
    expect(result.accepted).toBe(true);
    expect(result.rejections).toHaveLength(0);
  });

  it('accepts when all hard requirements are met', () => {
    const requirements: CapabilityRequirements = {
      minProtocolVersion: 1,
      requiresBinary: true,
    };
    const result = negotiate(makeManifest({ supportsBinary: true }), requirements);
    expect(result.accepted).toBe(true);
    expect(result.rejections).toHaveLength(0);
  });

  it('accepts when minProtocolVersion equals manifest protocolVersion', () => {
    const result = negotiate(
      makeManifest({ protocolVersion: 1 }),
      { minProtocolVersion: 1 },
    );
    expect(result.accepted).toBe(true);
  });

  it('accepts when adapter protocol version is higher than minimum', () => {
    const result = negotiate(
      makeManifest({ protocolVersion: 2 }),
      { minProtocolVersion: 1 },
    );
    expect(result.accepted).toBe(true);
  });

  it('accepts when streaming is not required and adapter does not support it', () => {
    const result = negotiate(
      makeManifest({ supportsStreaming: false }),
      { requiresStreaming: false },
    );
    expect(result.accepted).toBe(true);
  });

  it('accepts with no requirements even with minimal manifest', () => {
    const result = negotiate({
      name: 'minimal',
      version: '0.0.1',
      protocolVersion: 1,
    });
    expect(result.accepted).toBe(true);
  });
});

// ─── negotiate() — rejection cases ───────────────────────────────────────────

describe('negotiate() — rejection cases', () => {
  it('rejects when adapter protocol version is too old', () => {
    const result = negotiate(
      makeManifest({ protocolVersion: 1 }),
      { minProtocolVersion: 2 },
    );
    expect(result.accepted).toBe(false);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]).toContain('Protocol version mismatch');
    expect(result.rejections[0]).toContain('v1');
    expect(result.rejections[0]).toContain('v2');
  });

  it('rejects when binary is required but not supported', () => {
    const result = negotiate(
      makeManifest({ supportsBinary: false }),
      { requiresBinary: true },
    );
    expect(result.accepted).toBe(false);
    expect(result.rejections[0]).toContain('Binary payload support required');
  });

  it('rejects when binary is required and supportsBinary is undefined', () => {
    // Manifest with no supportsBinary field at all (omit to avoid exactOptionalPropertyTypes)
    const result = negotiate(
      { name: 'test-adapter', version: '1.0.0', protocolVersion: PROTOCOL_VERSION },
      { requiresBinary: true },
    );
    expect(result.accepted).toBe(false);
  });

  it('rejects when streaming is required but not supported', () => {
    const result = negotiate(
      makeManifest({ supportsStreaming: false }),
      { requiresStreaming: true },
    );
    expect(result.accepted).toBe(false);
    expect(result.rejections[0]).toContain('Streaming support required');
  });

  it('rejects when multiple hard requirements fail — accumulates all rejections', () => {
    const result = negotiate(
      makeManifest({ protocolVersion: 0, supportsBinary: false }),
      { minProtocolVersion: 1, requiresBinary: true },
    );
    expect(result.accepted).toBe(false);
    expect(result.rejections).toHaveLength(2);
  });
});

// ─── negotiate() — warnings ───────────────────────────────────────────────────

describe('negotiate() — warnings (soft requirements)', () => {
  it('warns when adapter maxPayloadBytes is below minPayloadBytes', () => {
    const result = negotiate(
      makeManifest({ maxPayloadBytes: 1 * 1024 * 1024 }), // 1 MB
      { minPayloadBytes: 4 * 1024 * 1024 },               // 4 MB
    );
    expect(result.accepted).toBe(true); // payload mismatch is soft
    expect(result.warnings.some(w => w.includes('Payload size gap'))).toBe(true);
    expect(result.warnings.some(w => w.includes('1.0 MB'))).toBe(true);
    expect(result.warnings.some(w => w.includes('4.0 MB'))).toBe(true);
  });

  it('does not warn about payload size when adapter has no limit', () => {
    // Omit maxPayloadBytes entirely — makeManifest() has no maxPayloadBytes by default
    const result = negotiate(
      makeManifest(),
      { minPayloadBytes: 100 * 1024 * 1024 },
    );
    expect(result.accepted).toBe(true);
    expect(result.warnings.some(w => w.includes('Payload size gap'))).toBe(false);
  });

  it('does not warn about payload size when adapter limit >= required', () => {
    const result = negotiate(
      makeManifest({ maxPayloadBytes: 10 * 1024 * 1024 }),
      { minPayloadBytes: 4 * 1024 * 1024 },
    );
    expect(result.accepted).toBe(true);
    expect(result.warnings.some(w => w.includes('Payload size gap'))).toBe(false);
  });

  it('warns when streaming is explicitly false (informational only)', () => {
    const result = negotiate(makeManifest({ supportsStreaming: false }));
    expect(result.accepted).toBe(true);
    const hasStreamingNote = result.warnings.some(w =>
      w.toLowerCase().includes('streaming'),
    );
    expect(hasStreamingNote).toBe(true);
  });

  it('does not warn about streaming when supportsStreaming is undefined', () => {
    // Omit supportsStreaming entirely to avoid exactOptionalPropertyTypes violation
    const result = negotiate({ name: 'test-adapter', version: '1.0.0', protocolVersion: PROTOCOL_VERSION, supportsBinary: true });
    expect(result.accepted).toBe(true);
    const hasStreamingNote = result.warnings.some(w =>
      w.toLowerCase().includes('streaming'),
    );
    expect(hasStreamingNote).toBe(false);
  });
});

// ─── negotiate() — effectiveCapabilities ─────────────────────────────────────

describe('negotiate() — effectiveCapabilities', () => {
  it('reflects manifest values in effectiveCapabilities', () => {
    const result = negotiate(makeManifest({
      protocolVersion: 1,
      supportsBinary: true,
      supportsStreaming: false,
      maxPayloadBytes: 8 * 1024 * 1024,
    }));

    expect(result.effectiveCapabilities.protocolVersion).toBe(1);
    expect(result.effectiveCapabilities.supportsBinary).toBe(true);
    expect(result.effectiveCapabilities.supportsStreaming).toBe(false);
    expect(result.effectiveCapabilities.maxPayloadBytes).toBe(8 * 1024 * 1024);
  });

  it('effectiveCapabilities.supportsBinary is false when undefined', () => {
    const result = negotiate({ name: 'a', version: '1', protocolVersion: 1 });
    expect(result.effectiveCapabilities.supportsBinary).toBe(false);
  });

  it('result is frozen (immutable)', () => {
    const result = negotiate(makeManifest());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
    expect(Object.isFrozen(result.rejections)).toBe(true);
    expect(Object.isFrozen(result.effectiveCapabilities)).toBe(true);
  });

  it('manifest is preserved as-is on the result', () => {
    const manifest = makeManifest({ capabilities: { wasmRuntime: 'assemblyscript' } });
    const result = negotiate(manifest);
    expect(result.manifest).toBe(manifest);
  });
});

// ─── isNegotiablePlugin() ─────────────────────────────────────────────────────

describe('isNegotiablePlugin()', () => {
  it('returns true for object with getManifest function', () => {
    const plugin = { name: 'p', getManifest: () => ({}) };
    expect(isNegotiablePlugin(plugin)).toBe(true);
  });

  it('returns false for plugin without getManifest', () => {
    expect(isNegotiablePlugin({ name: 'p' })).toBe(false);
  });

  it('returns false for getManifest that is not a function', () => {
    expect(isNegotiablePlugin({ name: 'p', getManifest: 'string' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isNegotiablePlugin(null)).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isNegotiablePlugin(42)).toBe(false);
    expect(isNegotiablePlugin('plugin')).toBe(false);
  });
});

// ─── PluginHost integration ───────────────────────────────────────────────────

describe('PluginHost — capability negotiation integration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('calls getManifest() and stores result before init() hooks run', async () => {
    const { PluginHost } = await import('../src/plugins.js');
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const getManifest = vi.fn((): AdapterManifest => makeManifest());
    const initHook = vi.fn(async () => {});

    const plugin: NegotiablePluginFixture = {
      name: 'negotiable-plugin',
      getManifest,
      init: initHook,
    };

    const host = new PluginHost({ logger });
    host.register(plugin);
    await host.init();

    expect(getManifest).toHaveBeenCalledOnce();
    // getManifest should run before init hook
    expect(getManifest.mock.invocationCallOrder[0])
      .toBeLessThan(initHook.mock.invocationCallOrder[0]!);
  });

  it('stores NegotiationResult accessible via getNegotiationResult()', async () => {
    const { PluginHost } = await import('../src/plugins.js');

    const plugin: NegotiablePluginFixture = {
      name: 'my-plugin',
      getManifest: () => makeManifest({ supportsBinary: true }),
    };

    const host = new PluginHost({ logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    host.register(plugin);
    await host.init();

    const result = host.getNegotiationResult('my-plugin');
    expect(result).toBeDefined();
    expect(result?.accepted).toBe(true);
    expect(result?.effectiveCapabilities.supportsBinary).toBe(true);
  });

  it('getAllNegotiationResults() returns all negotiated plugins', async () => {
    const { PluginHost } = await import('../src/plugins.js');

    const host = new PluginHost({ logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });

    const hasManifestPlugin: NegotiablePluginFixture = { name: 'has-manifest', getManifest: () => makeManifest() };
    host.register({ name: 'no-manifest' }); // non-negotiable
    host.register(hasManifestPlugin);

    await host.init();

    const all = host.getAllNegotiationResults();
    expect(all.size).toBe(1);
    expect(all.has('has-manifest')).toBe(true);
    expect(all.has('no-manifest')).toBe(false);
  });

  it('logs a warning when negotiation fails hard requirements', async () => {
    const { PluginHost } = await import('../src/plugins.js');
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const plugin: NegotiablePluginFixture = {
      name: 'old-adapter',
      getManifest: (): AdapterManifest => makeManifest({ protocolVersion: 0 }),
    };

    const host = new PluginHost({
      logger,
      requirements: { minProtocolVersion: 1 },
    });
    host.register(plugin);
    await host.init();

    const result = host.getNegotiationResult('old-adapter');
    expect(result?.accepted).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed capability negotiation'),
      expect.any(String),
    );
  });

  it('does not abort init() when getManifest() throws', async () => {
    const { PluginHost } = await import('../src/plugins.js');
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const initFn = vi.fn(async () => {});
    const plugin: NegotiablePluginFixture = {
      name: 'bad-manifest',
      getManifest: () => { throw new Error('manifest unavailable'); },
      init: initFn,
    };

    const host = new PluginHost({ logger });
    host.register(plugin);

    await expect(host.init()).resolves.toBeUndefined();
    expect(initFn).toHaveBeenCalled(); // init still runs
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('getManifest() threw'),
    );
  });

  it('non-negotiable plugins (no getManifest) are unaffected', async () => {
    const { PluginHost } = await import('../src/plugins.js');

    const initFn = vi.fn(async () => {});
    const plugin = { name: 'plain-plugin', init: initFn };

    const host = new PluginHost({ logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    host.register(plugin);
    await host.init();

    expect(initFn).toHaveBeenCalled();
    expect(host.getNegotiationResult('plain-plugin')).toBeUndefined();
  });

  it('getNegotiationResult() returns undefined before init() runs', async () => {
    const { PluginHost } = await import('../src/plugins.js');

    const pPlugin: NegotiablePluginFixture = { name: 'p', getManifest: () => makeManifest() };
    const host = new PluginHost({ logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    host.register(pPlugin);

    // Before init()
    expect(host.getNegotiationResult('p')).toBeUndefined();
  });

  it('logs success message when negotiation is accepted with no warnings', async () => {
    const { PluginHost } = await import('../src/plugins.js');
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    // Omit supportsStreaming entirely so there's no streaming warning — no exactOptionalPropertyTypes violation
    const plugin: NegotiablePluginFixture = {
      name: 'clean-adapter',
      getManifest: (): AdapterManifest => ({ name: 'test-adapter', version: '1.0.0', protocolVersion: PROTOCOL_VERSION, supportsBinary: true }),
    };

    const host = new PluginHost({ logger });
    host.register(plugin);
    await host.init();

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('negotiation accepted'),
    );
  });
});

// ─── PROTOCOL_VERSION constant ────────────────────────────────────────────────

describe('PROTOCOL_VERSION', () => {
  it('is a positive integer', () => {
    expect(typeof PROTOCOL_VERSION).toBe('number');
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});
