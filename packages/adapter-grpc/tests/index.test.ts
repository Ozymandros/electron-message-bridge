/**
 * Tests for @electron-ipc-helper/adapter-grpc
 *
 * Covers:
 *  - BridgeServiceDefinition: serialize/deserialize round-trip
 *  - GrpcServerTransport / GrpcClientTransport: TransportAdapter contract
 *  - GrpcPlugin: NegotiablePlugin manifest, Plugin lifecycle
 *  - Factory functions: createGrpcServerTransport, createGrpcClientTransport
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@grpc/grpc-js', () => {
  const MockServer = vi.fn(() => ({
    addService: vi.fn(),
    bindAsync: vi.fn((_addr: unknown, _creds: unknown, cb: (err: null, port: number) => void) => {
      setImmediate(() => cb(null, 50051));
    }),
    tryShutdown: vi.fn((cb: () => void) => {
      setImmediate(() => cb());
    }),
  }));

  const MockClientConstructor = vi.fn(function (this: Record<string, unknown>, _addr: unknown, _creds: unknown) {
    this['invoke'] = vi.fn(
      (_req: unknown, _meta: unknown, _opts: unknown, cb: (err: null, res: { result: string; error: string }) => void) => {
        setImmediate(() => cb(null, { result: '"ok"', error: '' }));
      },
    );
    this['close'] = vi.fn();
  });

  return {
    Server: MockServer,
    ServerCredentials: { createInsecure: vi.fn(() => ({})) },
    credentials: { createInsecure: vi.fn(() => ({})) },
    Metadata: class {},
    makeGenericClientConstructor: vi.fn(() => MockClientConstructor),
  };
});

import {
  GrpcServerTransport,
  GrpcClientTransport,
  GrpcPlugin,
  createGrpcServerTransport,
  createGrpcClientTransport,
  BridgeServiceDefinition,
} from '../src/index.js';

// ─── BridgeServiceDefinition ──────────────────────────────────────────────────

describe('BridgeServiceDefinition', () => {
  it('has the expected gRPC path', () => {
    expect(BridgeServiceDefinition.invoke.path).toBe('/electronbridge.Bridge/Invoke');
  });

  it('is a unary (non-streaming) RPC', () => {
    expect(BridgeServiceDefinition.invoke.requestStream).toBe(false);
    expect(BridgeServiceDefinition.invoke.responseStream).toBe(false);
  });

  it('serialize/deserialize InvokeRequest round-trip', () => {
    const req = { channel: 'getUser', payload: JSON.stringify({ id: '1' }) };
    const buf = BridgeServiceDefinition.invoke.requestSerialize(req);
    const recovered = BridgeServiceDefinition.invoke.requestDeserialize(buf);
    expect(recovered).toEqual(req);
  });

  it('serialize/deserialize InvokeResponse round-trip', () => {
    const res = { result: '"hello"', error: '' };
    const buf = BridgeServiceDefinition.invoke.responseSerialize(res);
    const recovered = BridgeServiceDefinition.invoke.responseDeserialize(buf);
    expect(recovered).toEqual(res);
  });
});

// ─── GrpcServerTransport ──────────────────────────────────────────────────────

describe('GrpcServerTransport', () => {
  it('has name "grpc-server"', () => {
    const t = createGrpcServerTransport({ address: '127.0.0.1:50051' });
    expect(t.name).toBe('grpc-server');
  });

  it('invoke() throws — server transport does not support invoke', () => {
    const t = createGrpcServerTransport({ address: '127.0.0.1:50051' });
    expect(() => t.invoke('ch', null)).toThrow('GrpcServerTransport.invoke()');
  });

  it('handle() does not throw', () => {
    const t = createGrpcServerTransport({ address: '127.0.0.1:50051' });
    expect(() => t.handle('ping', async () => 'pong')).not.toThrow();
  });

  it('start() calls gRPC Server.bindAsync and resolves', async () => {
    const t = createGrpcServerTransport({ address: '127.0.0.1:50051' });
    await expect(t.start()).resolves.toBeUndefined();
  });

  it('dispose() calls Server.tryShutdown', async () => {
    const t = createGrpcServerTransport({ address: '127.0.0.1:50051' });
    await t.start();
    await expect(t.dispose()).resolves.toBeUndefined();
  });

  it('dispose() is safe before start()', async () => {
    const t = createGrpcServerTransport({ address: '127.0.0.1:50051' });
    await expect(t.dispose()).resolves.toBeUndefined();
  });
});

// ─── GrpcClientTransport ─────────────────────────────────────────────────────

describe('GrpcClientTransport', () => {
  it('has name "grpc-client"', () => {
    const t = createGrpcClientTransport({ address: '127.0.0.1:50051' });
    expect(t.name).toBe('grpc-client');
  });

  it('handle() throws — client transport does not register handlers', () => {
    const t = createGrpcClientTransport({ address: '127.0.0.1:50051' });
    expect(() => t.handle('ch', async () => null)).toThrow(
      'GrpcClientTransport.handle()',
    );
  });

  it('start() connects the gRPC channel', async () => {
    const t = createGrpcClientTransport({ address: '127.0.0.1:50051' });
    await expect(t.start()).resolves.toBeUndefined();
  });

  it('invoke() returns the result from the server', async () => {
    const t = createGrpcClientTransport({ address: '127.0.0.1:50051' });
    await t.start();
    // Mock client returns { result: '"ok"', error: '' }
    const result = await t.invoke('anyChannel', { hello: 'world' });
    expect(result).toBe('ok'); // JSON.parse('"ok"') === 'ok'
  });

  it('dispose() closes the channel', async () => {
    const t = createGrpcClientTransport({ address: '127.0.0.1:50051' });
    await t.start();
    await expect(t.dispose()).resolves.toBeUndefined();
  });
});

// ─── Factory functions ────────────────────────────────────────────────────────

describe('createGrpcServerTransport', () => {
  it('returns a GrpcServerTransport instance', () => {
    expect(createGrpcServerTransport({ address: '127.0.0.1:50051' })).toBeInstanceOf(
      GrpcServerTransport,
    );
  });
});

describe('createGrpcClientTransport', () => {
  it('returns a GrpcClientTransport instance', () => {
    expect(createGrpcClientTransport({ address: '127.0.0.1:50051' })).toBeInstanceOf(
      GrpcClientTransport,
    );
  });
});

// ─── GrpcPlugin ───────────────────────────────────────────────────────────────

describe('GrpcPlugin', () => {
  it('implements NegotiablePlugin — getManifest() returns AdapterManifest', () => {
    const plugin = new GrpcPlugin({ address: '127.0.0.1:50051' });
    const manifest = plugin.getManifest();

    expect(manifest.name).toBe('@electron-ipc-helper/adapter-grpc');
    expect(typeof manifest.version).toBe('string');
    expect(manifest.protocolVersion).toBeGreaterThanOrEqual(1);
    expect(manifest.supportsBinary).toBe(false);
    expect(manifest.supportsStreaming).toBe(false);
    expect((manifest.capabilities as Record<string, unknown>)['protocol']).toBe('grpc');
    expect((manifest.capabilities as Record<string, unknown>)['grpcAddress']).toBe(
      '127.0.0.1:50051',
    );
  });

  it('has Plugin.name = "grpc"', () => {
    const plugin = new GrpcPlugin({ address: '127.0.0.1:50051' });
    expect(plugin.name).toBe('grpc');
  });

  it('exposes capabilities with grpcAddress', () => {
    const plugin = new GrpcPlugin({ address: '0.0.0.0:9090' });
    expect(plugin.capabilities.grpcAddress).toBe('0.0.0.0:9090');
  });

  it('serverTransport getter returns a GrpcServerTransport', () => {
    const plugin = new GrpcPlugin({ address: '127.0.0.1:50051' });
    expect(plugin.serverTransport).toBeInstanceOf(GrpcServerTransport);
  });

  it('init() starts the gRPC server', async () => {
    const plugin = new GrpcPlugin({ address: '127.0.0.1:50051' });
    const ctx = { name: 'grpc', logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    await expect(plugin.init(ctx)).resolves.toBeUndefined();
  });

  it('dispose() shuts down the gRPC server', async () => {
    const plugin = new GrpcPlugin({ address: '127.0.0.1:50051' });
    const ctx = { name: 'grpc', logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    await plugin.init(ctx);
    await expect(plugin.dispose(ctx)).resolves.toBeUndefined();
  });
});
