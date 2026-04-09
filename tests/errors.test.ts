/**
 * Unit tests for the typed error taxonomy in src/errors.ts.
 *
 * Covers:
 * - Correct prototype chain (instanceof checks)
 * - Stable `code` constants and class fields
 * - Structured `context` object
 * - Error `name` property
 * - Integration: errors thrown by defineIpcApi, lifecycle, plugins
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  IpcHelperError,
  InvalidPayloadError,
  InvalidBridgePayloadError,
  BridgeTimeoutError,
  MaxRestartsError,
  PluginConflictError,
  ExportMissingError,
  RuntimeMissingError,
  AdapterMissingError,
  TransportError,
  ERR_INVALID_PAYLOAD,
  ERR_INVALID_BRIDGE_PAYLOAD,
  ERR_BRIDGE_TIMEOUT,
  ERR_MAX_RESTARTS,
  ERR_PLUGIN_CONFLICT,
  ERR_EXPORT_MISSING,
  ERR_RUNTIME_MISSING,
  ERR_ADAPTER_MISSING,
  ERR_TRANSPORT_FAILURE,
} from '../src/errors.js';
import type { IpcHelperErrorCode } from '../src/errors.js';

// ─── IpcHelperError (base) ────────────────────────────────────────────────────

describe('IpcHelperError (base class)', () => {
  it('extends Error', () => {
    const err = new IpcHelperError(ERR_INVALID_PAYLOAD, 'test message');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(IpcHelperError);
  });

  it('sets .code to the given error code', () => {
    const err = new IpcHelperError(ERR_BRIDGE_TIMEOUT, 'msg');
    expect(err.code).toBe('ERR_BRIDGE_TIMEOUT');
  });

  it('sets .message correctly', () => {
    const err = new IpcHelperError(ERR_EXPORT_MISSING, 'export "foo" not found');
    expect(err.message).toBe('export "foo" not found');
  });

  it('defaults context to an empty frozen object', () => {
    const err = new IpcHelperError(ERR_INVALID_PAYLOAD, 'msg');
    expect(err.context).toEqual({});
    expect(Object.isFrozen(err.context)).toBe(true);
  });

  it('stores and freezes provided context', () => {
    const err = new IpcHelperError(ERR_BRIDGE_TIMEOUT, 'msg', { timeoutMs: 5000 });
    expect(err.context).toEqual({ timeoutMs: 5000 });
    expect(Object.isFrozen(err.context)).toBe(true);
  });

  it('sets .name to "IpcHelperError"', () => {
    const err = new IpcHelperError(ERR_TRANSPORT_FAILURE, 'msg');
    expect(err.name).toBe('IpcHelperError');
  });

  it('IpcHelperErrorCode type is satisfied by all code constants', () => {
    // Compile-time check — verifying the union at runtime
    const codes: IpcHelperErrorCode[] = [
      ERR_INVALID_PAYLOAD,
      ERR_INVALID_BRIDGE_PAYLOAD,
      ERR_BRIDGE_TIMEOUT,
      ERR_MAX_RESTARTS,
      ERR_PLUGIN_CONFLICT,
      ERR_EXPORT_MISSING,
      ERR_RUNTIME_MISSING,
      ERR_ADAPTER_MISSING,
      ERR_TRANSPORT_FAILURE,
    ];
    expect(codes).toHaveLength(9);
  });
});

// ─── InvalidPayloadError ──────────────────────────────────────────────────────

describe('InvalidPayloadError', () => {
  it('is an IpcHelperError and an Error', () => {
    const err = new InvalidPayloadError('ping');
    expect(err).toBeInstanceOf(IpcHelperError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has code ERR_INVALID_PAYLOAD', () => {
    expect(new InvalidPayloadError('ping').code).toBe('ERR_INVALID_PAYLOAD');
  });

  it('has name "InvalidPayloadError"', () => {
    expect(new InvalidPayloadError('ping').name).toBe('InvalidPayloadError');
  });

  it('exposes .channel field', () => {
    const err = new InvalidPayloadError('myChannel');
    expect(err.channel).toBe('myChannel');
  });

  it('context contains channel', () => {
    const err = new InvalidPayloadError('myChannel');
    expect(err.context).toEqual({ channel: 'myChannel' });
  });

  it('message mentions the channel name', () => {
    const err = new InvalidPayloadError('getUser');
    expect(err.message).toContain('"getUser"');
  });
});

// ─── InvalidBridgePayloadError ────────────────────────────────────────────────

describe('InvalidBridgePayloadError', () => {
  it('is an IpcHelperError and an Error', () => {
    const err = new InvalidBridgePayloadError('myContext');
    expect(err).toBeInstanceOf(IpcHelperError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has code ERR_INVALID_BRIDGE_PAYLOAD', () => {
    expect(new InvalidBridgePayloadError('ctx').code).toBe('ERR_INVALID_BRIDGE_PAYLOAD');
  });

  it('has name "InvalidBridgePayloadError"', () => {
    expect(new InvalidBridgePayloadError('ctx').name).toBe('InvalidBridgePayloadError');
  });

  it('context record contains the provided context string', () => {
    const err = new InvalidBridgePayloadError('saveSettings:input');
    expect(err.context['context']).toBe('saveSettings:input');
  });

  it('defaults context to "(unknown)" when not provided', () => {
    const err = new InvalidBridgePayloadError();
    expect(err.context['context']).toBe('(unknown)');
  });

  it('message mentions the context location', () => {
    const err = new InvalidBridgePayloadError('getUser:output');
    expect(err.message).toContain('"getUser:output"');
  });
});

// ─── BridgeTimeoutError ───────────────────────────────────────────────────────

describe('BridgeTimeoutError', () => {
  it('is an IpcHelperError', () => {
    expect(new BridgeTimeoutError(5000)).toBeInstanceOf(IpcHelperError);
  });

  it('has code ERR_BRIDGE_TIMEOUT', () => {
    expect(new BridgeTimeoutError(5000).code).toBe('ERR_BRIDGE_TIMEOUT');
  });

  it('has name "BridgeTimeoutError"', () => {
    expect(new BridgeTimeoutError(5000).name).toBe('BridgeTimeoutError');
  });

  it('exposes .timeoutMs field', () => {
    expect(new BridgeTimeoutError(3000).timeoutMs).toBe(3000);
  });

  it('context contains timeoutMs', () => {
    expect(new BridgeTimeoutError(3000).context).toEqual({ timeoutMs: 3000 });
  });

  it('message contains the timeout value', () => {
    expect(new BridgeTimeoutError(9999).message).toContain('9999ms');
  });
});

// ─── MaxRestartsError ─────────────────────────────────────────────────────────

describe('MaxRestartsError', () => {
  it('is an IpcHelperError', () => {
    expect(new MaxRestartsError(5)).toBeInstanceOf(IpcHelperError);
  });

  it('has code ERR_MAX_RESTARTS', () => {
    expect(new MaxRestartsError(5).code).toBe('ERR_MAX_RESTARTS');
  });

  it('has name "MaxRestartsError"', () => {
    expect(new MaxRestartsError(5).name).toBe('MaxRestartsError');
  });

  it('exposes .maxRestarts field', () => {
    expect(new MaxRestartsError(10).maxRestarts).toBe(10);
  });

  it('context contains maxRestarts', () => {
    expect(new MaxRestartsError(10).context).toEqual({ maxRestarts: 10 });
  });

  it('message contains the max restarts count', () => {
    expect(new MaxRestartsError(7).message).toContain('7');
  });
});

// ─── PluginConflictError ──────────────────────────────────────────────────────

describe('PluginConflictError', () => {
  it('is an IpcHelperError', () => {
    const err = new PluginConflictError('storage', 'plugin-a', 'plugin-b');
    expect(err).toBeInstanceOf(IpcHelperError);
  });

  it('has code ERR_PLUGIN_CONFLICT', () => {
    const err = new PluginConflictError('storage', 'plugin-a', 'plugin-b');
    expect(err.code).toBe('ERR_PLUGIN_CONFLICT');
  });

  it('has name "PluginConflictError"', () => {
    const err = new PluginConflictError('storage', 'plugin-a', 'plugin-b');
    expect(err.name).toBe('PluginConflictError');
  });

  it('exposes capability, existing, incoming fields', () => {
    const err = new PluginConflictError('storage', 'plugin-a', 'plugin-b');
    expect(err.capability).toBe('storage');
    expect(err.existing).toBe('plugin-a');
    expect(err.incoming).toBe('plugin-b');
  });

  it('context carries all three fields', () => {
    const err = new PluginConflictError('storage', 'plugin-a', 'plugin-b');
    expect(err.context).toEqual({ capability: 'storage', existing: 'plugin-a', incoming: 'plugin-b' });
  });

  it('message mentions both plugin names and the capability', () => {
    const err = new PluginConflictError('storage', 'plugin-a', 'plugin-b');
    expect(err.message).toContain('plugin-a');
    expect(err.message).toContain('plugin-b');
    expect(err.message).toContain('storage');
  });
});

// ─── ExportMissingError ───────────────────────────────────────────────────────

describe('ExportMissingError', () => {
  it('is an IpcHelperError', () => {
    expect(new ExportMissingError('multiply')).toBeInstanceOf(IpcHelperError);
  });

  it('has code ERR_EXPORT_MISSING', () => {
    expect(new ExportMissingError('multiply').code).toBe('ERR_EXPORT_MISSING');
  });

  it('has name "ExportMissingError"', () => {
    expect(new ExportMissingError('multiply').name).toBe('ExportMissingError');
  });

  it('exposes .exportName field', () => {
    expect(new ExportMissingError('hashBytes').exportName).toBe('hashBytes');
  });

  it('message mentions the export name', () => {
    expect(new ExportMissingError('multiply').message).toContain('"multiply"');
  });
});

// ─── RuntimeMissingError ──────────────────────────────────────────────────────

describe('RuntimeMissingError', () => {
  it('is an IpcHelperError', () => {
    const err = new RuntimeMissingError(['__new', '__pin']);
    expect(err).toBeInstanceOf(IpcHelperError);
  });

  it('has code ERR_RUNTIME_MISSING', () => {
    expect(new RuntimeMissingError(['__new']).code).toBe('ERR_RUNTIME_MISSING');
  });

  it('has name "RuntimeMissingError"', () => {
    expect(new RuntimeMissingError(['__new']).name).toBe('RuntimeMissingError');
  });

  it('exposes .missingExports as a frozen array', () => {
    const err = new RuntimeMissingError(['__new', '__pin']);
    expect(err.missingExports).toEqual(['__new', '__pin']);
    expect(Object.isFrozen(err.missingExports)).toBe(true);
  });

  it('message lists the missing exports', () => {
    const err = new RuntimeMissingError(['__new', '__pin']);
    expect(err.message).toContain('__new');
    expect(err.message).toContain('__pin');
  });
});

// ─── AdapterMissingError ──────────────────────────────────────────────────────

describe('AdapterMissingError', () => {
  it('is an IpcHelperError', () => {
    expect(new AdapterMissingError('@my/adapter')).toBeInstanceOf(IpcHelperError);
  });

  it('has code ERR_ADAPTER_MISSING', () => {
    expect(new AdapterMissingError('@my/adapter').code).toBe('ERR_ADAPTER_MISSING');
  });

  it('has name "AdapterMissingError"', () => {
    expect(new AdapterMissingError('@my/adapter').name).toBe('AdapterMissingError');
  });

  it('exposes .adapterName field', () => {
    const err = new AdapterMissingError('electron-message-bridge-adapter-assemblyscript');
    expect(err.adapterName).toBe('electron-message-bridge-adapter-assemblyscript');
  });

  it('message includes the adapter name and an install hint', () => {
    const err = new AdapterMissingError('electron-message-bridge-adapter-assemblyscript');
    expect(err.message).toContain('electron-message-bridge-adapter-assemblyscript');
    expect(err.message).toContain('npm install');
  });
});

// ─── TransportError ───────────────────────────────────────────────────────────

describe('TransportError', () => {
  it('is an IpcHelperError', () => {
    expect(new TransportError('connection refused')).toBeInstanceOf(IpcHelperError);
  });

  it('has code ERR_TRANSPORT_FAILURE', () => {
    expect(new TransportError('connection refused').code).toBe('ERR_TRANSPORT_FAILURE');
  });

  it('has name "TransportError"', () => {
    expect(new TransportError('connection refused').name).toBe('TransportError');
  });

  it('message includes the given reason', () => {
    const err = new TransportError('renderer destroyed');
    expect(err.message).toContain('renderer destroyed');
  });

  it('accepts optional context', () => {
    const err = new TransportError('timeout', { channel: 'getUser' });
    expect(err.context).toEqual({ channel: 'getUser' });
  });
});

// ─── Integration: defineIpcApi throws InvalidPayloadError ────────────────────

const { ipcMainMock } = vi.hoisted(() => ({ ipcMainMock: { handle: vi.fn(), removeHandler: vi.fn() } }));
vi.mock('electron', () => ({ ipcMain: ipcMainMock }));

describe('defineIpcApi — throws InvalidPayloadError for non-function handler', () => {
  beforeEach(() => { ipcMainMock.handle.mockReset(); });
  afterEach(() => { ipcMainMock.removeHandler.mockReset(); });

  it('throws InvalidPayloadError with correct code and channel', async () => {
    const { defineIpcApi } = await import('../src/main.js');

    expect(() =>
      defineIpcApi({ ping: 'not-a-function' as unknown as () => Promise<string> }),
    ).toThrow(InvalidPayloadError);

    try {
      defineIpcApi({ myChannel: 42 as unknown as () => Promise<number> });
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidPayloadError);
      if (err instanceof InvalidPayloadError) {
        expect(err.code).toBe('ERR_INVALID_PAYLOAD');
        expect(err.channel).toBe('myChannel');
      }
    }
  });
});

// ─── Integration: PluginHost throws PluginConflictError ──────────────────────

describe('PluginHost — throws PluginConflictError on capability conflict', () => {
  it('throws PluginConflictError with correct fields', async () => {
    const { PluginHost } = await import('../src/plugins.js');

    const host = new PluginHost({ logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });

    const pluginA = {
      name: 'plugin-a',
      capabilities: { storage: true as const },
    };
    const pluginB = {
      name: 'plugin-b',
      capabilities: { storage: true as const },
    };

    host.register(pluginA);

    expect(() => host.register(pluginB)).toThrow(PluginConflictError);

    try {
      host.register(pluginB);
    } catch (err) {
      if (err instanceof PluginConflictError) {
        expect(err.code).toBe('ERR_PLUGIN_CONFLICT');
        expect(err.capability).toBe('storage');
        expect(err.existing).toBe('plugin-a');
        expect(err.incoming).toBe('plugin-b');
      }
    }
  });
});
