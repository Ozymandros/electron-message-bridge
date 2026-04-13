/**
 * gRPC server for the main process.
 *
 * Registers a `Bridge.Invoke` unary handler that dispatches incoming RPC
 * calls to electron-ipc-helper transport handlers and sends back JSON-encoded
 * responses.
 *
 * `@grpc/grpc-js` is dynamically imported inside `start()` so the package
 * can be omitted without breaking the import graph (optional peer dep).
 */

import { BridgeServiceDefinition } from './service.js';
import type { InvokeRequest, InvokeResponse } from './service.js';
import type { TransportHandler } from 'electron-ipc-helper/transport';

// ─── GrpcServer ───────────────────────────────────────────────────────────────

export interface GrpcServerOptions {
  /**
   * Host and port to listen on.
   * @example '0.0.0.0:50051'   (all interfaces)
   * @example '127.0.0.1:50051' (loopback only — recommended for local IPC)
   */
  readonly address: string;
  /**
   * gRPC server credentials. Provide via `grpc.ServerCredentials.createSsl(...)`.
   * Defaults to `grpc.ServerCredentials.createInsecure()` when omitted.
   * Typed `unknown` to avoid a hard compile-time dependency on grpc-js types.
   */
  readonly credentials?: unknown;
  /** Logger for diagnostics. Defaults to `console`. */
  readonly logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export class GrpcServer {
  private readonly address: string;
  private readonly credentials: unknown;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly handlers = new Map<string, TransportHandler>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private server: any | null = null;

  constructor(options: GrpcServerOptions) {
    this.address = options.address;
    this.credentials = options.credentials;
    this.logger = options.logger ?? console;
  }

  handle(channel: string, handler: TransportHandler): void {
    this.handlers.set(channel, handler);
  }

  async start(): Promise<void> {
    // Lazy-import @grpc/grpc-js only when start() is called.
    const grpcLib = await import('@grpc/grpc-js') as typeof import('@grpc/grpc-js');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    this.server = new grpcLib.Server();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const creds = this.credentials ?? grpcLib.ServerCredentials.createInsecure();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    this.server.addService(
      BridgeServiceDefinition,
      { invoke: this.invokeHandler.bind(this) },
    );

    await new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      this.server.bindAsync(this.address, creds, (err: Error | null, port: number) => {
        if (err) {
          reject(err);
          return;
        }
        this.logger.log(`[grpc] Server listening on port ${port}`);
        resolve();
      });
    });
  }

  async dispose(): Promise<void> {
    if (!this.server) return;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const srv = this.server;
    this.server = null;

    await new Promise<void>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      srv.tryShutdown((err?: Error) => {
        if (err) this.logger.warn('[grpc] Shutdown error:', err.message);
        else this.logger.log('[grpc] Server shut down');
        resolve();
      });
    });
  }

  // ── private ────────────────────────────────────────────────────────────────

  private invokeHandler(
    call: { request: InvokeRequest },
    callback: (err: null, res: InvokeResponse) => void,
  ): void {
    const { channel, payload } = call.request;
    const handler = this.handlers.get(channel);

    if (!handler) {
      callback(null, {
        result: '',
        error: `No handler registered for channel "${channel}"`,
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      callback(null, { result: '', error: `Invalid JSON payload for channel "${channel}"` });
      return;
    }

    handler(parsed as Parameters<TransportHandler>[0])
      .then((result: unknown) => {
        callback(null, { result: JSON.stringify(result), error: '' });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        callback(null, { result: '', error: msg });
      });
  }
}
