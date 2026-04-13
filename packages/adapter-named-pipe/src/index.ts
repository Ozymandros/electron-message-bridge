/**
 * @package @electron-message-bridge/adapter-named-pipe
 *
 * Named Pipe / Unix socket transport adapter for electron-message-bridge.
 *
 * Exposes the same typed `defineIpcApi` handlers over a local IPC socket
 * without requiring Electron's built-in `ipcMain` / `ipcRenderer` mechanism.
 *
 * ## When to use
 *
 * - Exposing main-process handlers to **spawned child processes**
 * - Enabling **external CLI tools** or test harnesses to call into the app
 * - **Cross-process RPC** where Electron IPC is unavailable (e.g. Node workers)
 *
 * ## Quick start
 *
 * ```ts
 * // main.ts (server side)
 * import { defineIpcApi } from 'electron-message-bridge';
 * import { createNamedPipeServerTransport } from '@electron-message-bridge/adapter-named-pipe';
 *
 * const transport = createNamedPipeServerTransport('/tmp/my-app.sock');
 * export const api = defineIpcApi(
 *   { getUser: async (id: string) => db.users.findById(id) },
 *   { transport },
 * );
 *
 * // client.ts (any Node.js process)
 * import { createNamedPipeClientTransport } from '@electron-message-bridge/adapter-named-pipe';
 *
 * const transport = createNamedPipeClientTransport('/tmp/my-app.sock');
 * await transport.start();
 * const user = await transport.invoke('getUser', '123');
 * ```
 *
 * @module
 */

import type { TransportAdapter } from '@ozymandros/electron-message-bridge/transport';
import type { BridgePayload } from '@ozymandros/electron-message-bridge/boundary';
import type { NegotiablePlugin, AdapterManifest } from '@ozymandros/electron-message-bridge/plugins';
import type { Plugin, PluginContext } from '@ozymandros/electron-message-bridge/plugins';
import { PROTOCOL_VERSION } from '@ozymandros/electron-message-bridge/plugins';
import { NamedPipeServer } from './server.js';
import { NamedPipeClient } from './client.js';

export type { NamedPipeServerOptions } from './server.js';
export type { NamedPipeClientOptions } from './client.js';
export { NamedPipeServer } from './server.js';
export { NamedPipeClient } from './client.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ADAPTER_NAME = '@electron-message-bridge/adapter-named-pipe';
const ADAPTER_VERSION = '0.1.0';

// ─── Server transport ─────────────────────────────────────────────────────────

/**
 * Options for the server-side Named Pipe transport.
 */
export interface NamedPipeServerTransportOptions {
  /** Unix socket path or Windows named pipe (e.g. `\\.\pipe\my-app`). */
  readonly path: string;
  /** Logger for diagnostics. */
  readonly logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

/**
 * Server-side Named Pipe transport.
 *
 * Use with `defineIpcApi` in the **main process** (or any Node.js host process).
 * Registers handlers and listens on the given socket path.
 */
export class NamedPipeServerTransport implements TransportAdapter {
  readonly name = 'named-pipe-server' as const;
  private readonly server: NamedPipeServer;

  constructor(options: NamedPipeServerTransportOptions) {
    this.server = new NamedPipeServer(options);
  }

  handle(channel: string, handler: Parameters<NamedPipeServer['handle']>[1]): void {
    this.server.handle(channel, handler);
  }

  invoke(_channel: string, _payload: BridgePayload): Promise<BridgePayload> {
    throw new Error(
      '[named-pipe] NamedPipeServerTransport.invoke() is not supported — ' +
        'use NamedPipeClientTransport on the client side.',
    );
  }

  async start(): Promise<void> {
    await this.server.start();
  }

  async dispose(): Promise<void> {
    await this.server.dispose();
  }
}

// ─── Client transport ─────────────────────────────────────────────────────────

/**
 * Options for the client-side Named Pipe transport.
 */
export interface NamedPipeClientTransportOptions {
  /** Unix socket path or Windows named pipe matching the server. */
  readonly path: string;
  /** Milliseconds before an invoke call times out. Defaults to 10 000 ms. */
  readonly timeoutMs?: number;
  /** Logger for diagnostics. */
  readonly logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

/**
 * Client-side Named Pipe transport.
 *
 * Connect to a `NamedPipeServerTransport` from **any Node.js process**
 * (child process, worker, external tool) to call the registered handlers.
 */
export class NamedPipeClientTransport implements TransportAdapter {
  readonly name = 'named-pipe-client' as const;
  private readonly client: NamedPipeClient;

  constructor(options: NamedPipeClientTransportOptions) {
    this.client = new NamedPipeClient(options);
  }

  handle(_channel: string, _handler: unknown): void {
    throw new Error(
      '[named-pipe] NamedPipeClientTransport.handle() is not supported — ' +
        'handlers are registered on the server side.',
    );
  }

  async invoke(channel: string, payload: BridgePayload): Promise<BridgePayload> {
    return this.client.invoke(channel, payload);
  }

  /** Establish the socket connection. Must be called before `invoke`. */
  async start(): Promise<void> {
    await this.client.connect();
  }

  async dispose(): Promise<void> {
    await this.client.dispose();
  }
}

// ─── Factory functions ────────────────────────────────────────────────────────

/**
 * Create a server-side Named Pipe transport.
 *
 * @example
 * ```ts
 * const transport = createNamedPipeServerTransport('/tmp/my-app.sock');
 * export const api = defineIpcApi({ getUser }, { transport });
 * ```
 */
export function createNamedPipeServerTransport(
  path: string,
  options?: Omit<NamedPipeServerTransportOptions, 'path'>,
): NamedPipeServerTransport {
  return new NamedPipeServerTransport({ path, ...options });
}

/**
 * Create a client-side Named Pipe transport.
 *
 * @example
 * ```ts
 * const transport = createNamedPipeClientTransport('/tmp/my-app.sock');
 * await transport.start();
 * const result = await transport.invoke('getUser', '123');
 * ```
 */
export function createNamedPipeClientTransport(
  path: string,
  options?: Omit<NamedPipeClientTransportOptions, 'path'>,
): NamedPipeClientTransport {
  return new NamedPipeClientTransport({ path, ...options });
}

// ─── NamedPipePlugin ──────────────────────────────────────────────────────────

/**
 * Capabilities exposed by the Named Pipe plugin.
 */
export interface NamedPipeCapabilities {
  /** The socket path this plugin is listening on. */
  pipePath: string;
}

/**
 * Plugin that integrates a `NamedPipeServerTransport` with the `PluginHost`
 * lifecycle system.
 *
 * The transport starts on `init` and shuts down on `dispose`.
 *
 * @example
 * ```ts
 * const host = new PluginHost({ logger: console });
 * host.register(new NamedPipePlugin({ path: '/tmp/my-app.sock' }));
 * await host.init();
 * ```
 */
export class NamedPipePlugin
  implements Plugin<NamedPipeCapabilities>, NegotiablePlugin
{
  readonly name = 'named-pipe' as const;
  readonly capabilities: NamedPipeCapabilities;
  private readonly transport: NamedPipeServerTransport;

  constructor(optionsOrPath: NamedPipeServerTransportOptions | string) {
    const options: NamedPipeServerTransportOptions =
      typeof optionsOrPath === 'string'
        ? { path: optionsOrPath }
        : optionsOrPath;

    this.transport = new NamedPipeServerTransport(options);
    this.capabilities = { pipePath: options.path };
  }

  /** Expose the configured server transport for `defineIpcApi`. */
  get serverTransport(): NamedPipeServerTransport {
    return this.transport;
  }

  getManifest(): AdapterManifest {
    return {
      name: ADAPTER_NAME,
      version: ADAPTER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      supportsBinary: false,
      supportsStreaming: false,
      capabilities: {
        protocol: 'named-pipe',
        pipePath: this.capabilities.pipePath,
      },
    };
  }

  async init(_ctx: PluginContext): Promise<void> {
    await this.transport.start();
  }

  async dispose(_ctx: PluginContext): Promise<void> {
    await this.transport.dispose();
  }
}
