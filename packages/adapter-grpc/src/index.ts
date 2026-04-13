/**
 * @package @electron-ipc-helper/adapter-grpc
 *
 * gRPC transport adapter for electron-ipc-helper.
 *
 * Exposes the same typed `defineIpcApi` handlers over a gRPC channel, enabling
 * language-agnostic clients (Go, Python, Rust, Java, …) to call into the
 * Electron main process using the `electronbridge.Bridge` service.
 *
 * ## When to use
 *
 * - **Microservice integration** — main process calls external gRPC services
 * - **Multi-language clients** — non-JS processes need to invoke Electron handlers
 * - **Remote access** — expose handlers over a network with mTLS security
 *
 * ## Quick start
 *
 * ```ts
 * // main.ts (gRPC server)
 * import { defineIpcApi } from 'electron-ipc-helper';
 * import { createGrpcServerTransport } from '@electron-ipc-helper/adapter-grpc';
 *
 * const transport = createGrpcServerTransport({ address: '127.0.0.1:50051' });
 * export const api = defineIpcApi(
 *   { getUser: async (id: string) => db.users.findById(id) },
 *   { transport },
 * );
 *
 * // client.ts (any Node.js process)
 * import { createGrpcClientTransport } from '@electron-ipc-helper/adapter-grpc';
 *
 * const transport = createGrpcClientTransport({ address: '127.0.0.1:50051' });
 * await transport.start();
 * const user = await transport.invoke('getUser', '123');
 * ```
 *
 * @module
 */

import type { TransportAdapter } from 'electron-ipc-helper/transport';
import type { BridgePayload } from 'electron-ipc-helper/boundary';
import type { NegotiablePlugin, AdapterManifest } from 'electron-ipc-helper/plugins';
import type { Plugin, PluginContext } from 'electron-ipc-helper/plugins';
import { PROTOCOL_VERSION } from 'electron-ipc-helper/plugins';
import { GrpcServer } from './server.js';
import { GrpcClient } from './client.js';

export type { GrpcServerOptions } from './server.js';
export type { GrpcClientOptions } from './client.js';
export { GrpcServer } from './server.js';
export { GrpcClient } from './client.js';
export { BridgeServiceDefinition } from './service.js';
export type { InvokeRequest, InvokeResponse } from './service.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ADAPTER_NAME = '@electron-ipc-helper/adapter-grpc';
const ADAPTER_VERSION = '0.1.0';

// ─── Server transport ─────────────────────────────────────────────────────────

/**
 * Options for the gRPC server transport.
 */
export interface GrpcServerTransportOptions {
  /** gRPC server address (host:port). @example '127.0.0.1:50051' */
  readonly address: string;
  /**
   * gRPC server credentials. Provide via `grpc.ServerCredentials.createSsl(...)`.
   * Typed `unknown` to avoid a hard compile-time dep on grpc-js.
   * Defaults to insecure when omitted.
   */
  readonly credentials?: unknown;
  /** Logger for diagnostics. */
  readonly logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

/**
 * Server-side gRPC transport.
 *
 * Use with `defineIpcApi` in the **main process**. Starts a `GrpcServer`
 * that accepts `Bridge.Invoke` RPCs and dispatches them to registered handlers.
 */
export class GrpcServerTransport implements TransportAdapter {
  readonly name = 'grpc-server' as const;
  private readonly server: GrpcServer;

  constructor(options: GrpcServerTransportOptions) {
    this.server = new GrpcServer(options);
  }

  handle(channel: string, handler: Parameters<GrpcServer['handle']>[1]): void {
    this.server.handle(channel, handler);
  }

  invoke(_channel: string, _payload: BridgePayload): Promise<BridgePayload> {
    throw new Error(
      '[grpc] GrpcServerTransport.invoke() is not supported — ' +
        'use GrpcClientTransport on the client side.',
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
 * Options for the gRPC client transport.
 */
export interface GrpcClientTransportOptions {
  /** Server address to connect to. @example '127.0.0.1:50051' */
  readonly address: string;
  /**
   * gRPC channel credentials. Provide via `grpc.credentials.createSsl(...)`.
   * Typed `unknown` to avoid a hard compile-time dep on grpc-js.
   * Defaults to insecure when omitted.
   */
  readonly credentials?: unknown;
  /** Timeout for each invoke call in milliseconds. Defaults to 10 000 ms. */
  readonly timeoutMs?: number;
  /** Logger for diagnostics. */
  readonly logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

/**
 * Client-side gRPC transport.
 *
 * Connect to a `GrpcServerTransport` from **any Node.js process** or
 * any gRPC-capable client in any language.
 */
export class GrpcClientTransport implements TransportAdapter {
  readonly name = 'grpc-client' as const;
  private readonly client: GrpcClient;

  constructor(options: GrpcClientTransportOptions) {
    this.client = new GrpcClient(options);
  }

  handle(_channel: string, _handler: unknown): void {
    throw new Error(
      '[grpc] GrpcClientTransport.handle() is not supported — ' +
        'handlers are registered on the server side.',
    );
  }

  async invoke(channel: string, payload: BridgePayload): Promise<BridgePayload> {
    return this.client.invoke(channel, payload);
  }

  /** Connect the gRPC channel. Must be called before `invoke`. */
  async start(): Promise<void> {
    await this.client.connect();
  }

  async dispose(): Promise<void> {
    await this.client.dispose();
  }
}

// ─── Factory functions ────────────────────────────────────────────────────────

/**
 * Create a server-side gRPC transport.
 *
 * @example
 * ```ts
 * const transport = createGrpcServerTransport({ address: '127.0.0.1:50051' });
 * export const api = defineIpcApi({ getUser }, { transport });
 * ```
 */
export function createGrpcServerTransport(
  options: GrpcServerTransportOptions,
): GrpcServerTransport {
  return new GrpcServerTransport(options);
}

/**
 * Create a client-side gRPC transport.
 *
 * @example
 * ```ts
 * const transport = createGrpcClientTransport({ address: '127.0.0.1:50051' });
 * await transport.start();
 * const result = await transport.invoke('getUser', '123');
 * ```
 */
export function createGrpcClientTransport(
  options: GrpcClientTransportOptions,
): GrpcClientTransport {
  return new GrpcClientTransport(options);
}

// ─── GrpcPlugin ───────────────────────────────────────────────────────────────

/**
 * Capabilities declared by the gRPC plugin.
 */
export interface GrpcCapabilities {
  /** The gRPC server address. */
  grpcAddress: string;
}

/**
 * Plugin that integrates a `GrpcServerTransport` with the `PluginHost`
 * lifecycle system.
 *
 * The gRPC server starts on `init` and shuts down on `dispose`.
 *
 * @example
 * ```ts
 * const host = new PluginHost({ logger: console });
 * host.register(new GrpcPlugin({ address: '127.0.0.1:50051' }));
 * await host.init();
 * ```
 */
export class GrpcPlugin implements Plugin<GrpcCapabilities>, NegotiablePlugin {
  readonly name = 'grpc' as const;
  readonly capabilities: GrpcCapabilities;
  private readonly transport: GrpcServerTransport;

  constructor(options: GrpcServerTransportOptions) {
    this.transport = new GrpcServerTransport(options);
    this.capabilities = { grpcAddress: options.address };
  }

  /** Expose the configured server transport for `defineIpcApi`. */
  get serverTransport(): GrpcServerTransport {
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
        protocol: 'grpc',
        grpcAddress: this.capabilities.grpcAddress,
        serviceFullName: 'electronbridge.Bridge',
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
