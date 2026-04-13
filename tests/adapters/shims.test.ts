/**
 * Tests for adapter lazy-loader shims:
 *   src/adapters/grpc.ts
 *   src/adapters/named-pipe.ts
 *   src/adapters/stdio.ts
 *
 * Each shim wraps `requireAdapter()` (from loader.ts) and re-exports types.
 * We test:
 *   - The loader resolves to the actual adapter module (aliased in test env).
 *   - The factory functions returned by each adapter work correctly.
 *   - `requireAdapter` throws `AdapterMissingError` on module-not-found errors.
 */

import { describe, it, expect, vi } from 'vitest';
import { AdapterMissingError } from '../../src/errors.js';
import { requireAdapter } from '../../src/adapters/loader.js';

// Virtual adapter mocks keep this suite independent from optional package installs.
vi.mock('@electron-ipc-helper/adapter-stdio', () => ({
  createStdioServerTransport: () => ({ name: 'stdio-server' }),
  createStdioClientTransport: () => ({ name: 'stdio-client' }),
  StdioPlugin: class StdioPlugin {
    public readonly name = 'stdio';
  },
}));

vi.mock('@electron-ipc-helper/adapter-grpc', () => ({
  createGrpcServerTransport: () => ({ name: 'grpc-server' }),
  createGrpcClientTransport: () => ({ name: 'grpc-client' }),
  BridgeServiceDefinition: {
    invoke: { path: '/electronbridge.Bridge/Invoke' },
  },
  GrpcPlugin: class GrpcPlugin {
    public readonly name = 'grpc';
  },
}));

vi.mock('@electron-ipc-helper/adapter-named-pipe', () => ({
  createNamedPipeServerTransport: () => ({ name: 'named-pipe-server' }),
  createNamedPipeClientTransport: () => ({ name: 'named-pipe-client' }),
  NamedPipePlugin: class NamedPipePlugin {
    public readonly name = 'named-pipe';
    public getManifest() {
      return {
        name: '@electron-ipc-helper/adapter-named-pipe',
        supportsBinary: true,
        supportsStreaming: false,
      };
    }
  },
}));

// ─── requireAdapter error path (shared across all shims) ─────────────────────

describe('requireAdapter — error handling', () => {
  it('throws AdapterMissingError when importFn rejects with ERR_MODULE_NOT_FOUND', async () => {
    const err = new Error("Cannot find package '@my/missing'") as NodeJS.ErrnoException;
    err.code = 'ERR_MODULE_NOT_FOUND';

    await expect(
      requireAdapter('@my/missing', async () => { throw err; }),
    ).rejects.toBeInstanceOf(AdapterMissingError);
  });

  it('throws AdapterMissingError when importFn rejects with MODULE_NOT_FOUND', async () => {
    const err = new Error("Cannot find module '@my/missing'") as NodeJS.ErrnoException;
    err.code = 'MODULE_NOT_FOUND';

    await expect(
      requireAdapter('@my/missing', async () => { throw err; }),
    ).rejects.toBeInstanceOf(AdapterMissingError);
  });

  it('throws AdapterMissingError on "Cannot find module" string message', async () => {
    await expect(
      requireAdapter('@my/missing', async () => {
        throw new Error("Cannot find module '@my/missing' from somewhere");
      }),
    ).rejects.toBeInstanceOf(AdapterMissingError);
  });

  it('re-throws unrelated errors (not module-not-found)', async () => {
    const err = new TypeError('something else went wrong');

    await expect(
      requireAdapter('@my/pkg', async () => { throw err; }),
    ).rejects.toBe(err);
  });

  it('resolves when importFn resolves', async () => {
    const mod = { hello: 'world' };
    const result = await requireAdapter('@my/pkg', async () => mod);
    expect(result).toBe(mod);
  });
});

// ─── loadStdioAdapter ─────────────────────────────────────────────────────────

describe('loadStdioAdapter', () => {
  it('resolves and exposes createStdioServerTransport + createStdioClientTransport', async () => {
    const { loadStdioAdapter } = await import('../../src/adapters/stdio.js');
    const mod = await loadStdioAdapter();

    expect(typeof mod.createStdioServerTransport).toBe('function');
    expect(typeof mod.createStdioClientTransport).toBe('function');
  });

  it('createStdioServerTransport returns transport with name "stdio-server"', async () => {
    const { loadStdioAdapter } = await import('../../src/adapters/stdio.js');
    const mod = await loadStdioAdapter();
    const t = mod.createStdioServerTransport();
    expect(t.name).toBe('stdio-server');
  });

  it('createStdioClientTransport returns transport with name "stdio-client"', async () => {
    const { loadStdioAdapter } = await import('../../src/adapters/stdio.js');
    const mod = await loadStdioAdapter();
    const t = mod.createStdioClientTransport();
    expect(t.name).toBe('stdio-client');
  });

  it('StdioPlugin class is exposed and has correct name', async () => {
    const { loadStdioAdapter } = await import('../../src/adapters/stdio.js');
    const mod = await loadStdioAdapter();
    const plugin = new mod.StdioPlugin();
    expect(plugin.name).toBe('stdio');
  });
});

// ─── loadGrpcAdapter ─────────────────────────────────────────────────────────

describe('loadGrpcAdapter', () => {
  it('resolves and exposes createGrpcServerTransport + createGrpcClientTransport', async () => {
    const { loadGrpcAdapter } = await import('../../src/adapters/grpc.js');
    const mod = await loadGrpcAdapter();

    expect(typeof mod.createGrpcServerTransport).toBe('function');
    expect(typeof mod.createGrpcClientTransport).toBe('function');
  });

  it('createGrpcServerTransport returns transport with name "grpc-server"', async () => {
    const { loadGrpcAdapter } = await import('../../src/adapters/grpc.js');
    const mod = await loadGrpcAdapter();
    const t = mod.createGrpcServerTransport({ address: '127.0.0.1:50051' });
    expect(t.name).toBe('grpc-server');
  });

  it('createGrpcClientTransport returns transport with name "grpc-client"', async () => {
    const { loadGrpcAdapter } = await import('../../src/adapters/grpc.js');
    const mod = await loadGrpcAdapter();
    const t = mod.createGrpcClientTransport({ address: '127.0.0.1:50051' });
    expect(t.name).toBe('grpc-client');
  });

  it('BridgeServiceDefinition has the gRPC path', async () => {
    const { loadGrpcAdapter } = await import('../../src/adapters/grpc.js');
    const mod = await loadGrpcAdapter();
    expect(mod.BridgeServiceDefinition.invoke.path).toBe('/electronbridge.Bridge/Invoke');
  });

  it('GrpcPlugin class is exposed and has correct name', async () => {
    const { loadGrpcAdapter } = await import('../../src/adapters/grpc.js');
    const mod = await loadGrpcAdapter();
    const plugin = new mod.GrpcPlugin({ address: '127.0.0.1:50051' });
    expect(plugin.name).toBe('grpc');
  });
});

// ─── loadNamedPipeAdapter ─────────────────────────────────────────────────────

describe('loadNamedPipeAdapter', () => {
  it('resolves and exposes createNamedPipeServerTransport + createNamedPipeClientTransport', async () => {
    const { loadNamedPipeAdapter } = await import('../../src/adapters/named-pipe.js');
    const mod = await loadNamedPipeAdapter();

    expect(typeof mod.createNamedPipeServerTransport).toBe('function');
    expect(typeof mod.createNamedPipeClientTransport).toBe('function');
  });

  it('createNamedPipeServerTransport returns transport with name "named-pipe-server"', async () => {
    const { loadNamedPipeAdapter } = await import('../../src/adapters/named-pipe.js');
    const mod = await loadNamedPipeAdapter();
    const t = mod.createNamedPipeServerTransport('/tmp/test-shim.sock');
    expect(t.name).toBe('named-pipe-server');
  });

  it('createNamedPipeClientTransport returns transport with name "named-pipe-client"', async () => {
    const { loadNamedPipeAdapter } = await import('../../src/adapters/named-pipe.js');
    const mod = await loadNamedPipeAdapter();
    const t = mod.createNamedPipeClientTransport('/tmp/test-shim.sock');
    expect(t.name).toBe('named-pipe-client');
  });

  it('NamedPipePlugin has correct name and manifest', async () => {
    const { loadNamedPipeAdapter } = await import('../../src/adapters/named-pipe.js');
    const mod = await loadNamedPipeAdapter();
    const plugin = new mod.NamedPipePlugin('/tmp/test-shim.sock');
    expect(plugin.name).toBe('named-pipe');
    const manifest = plugin.getManifest();
    expect(manifest.name).toBe('@electron-ipc-helper/adapter-named-pipe');
    expect(manifest.supportsBinary).toBe(true);
    expect(manifest.supportsStreaming).toBe(false);
  });
});
