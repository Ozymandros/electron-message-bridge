/**
 * gRPC client for the Electron Bridge protocol.
 *
 * Connects to a `GrpcServer` and issues `Bridge.Invoke` unary RPCs.
 * The payload and result are JSON-encoded BridgePayload values.
 *
 * `@grpc/grpc-js` is dynamically imported inside `connect()` so the package
 * can be omitted without breaking the import graph (optional peer dep).
 */

import { makeBridgeClientConstructor } from './service.js';
import type { InvokeRequest, InvokeResponse } from './service.js';
import type { BridgePayload } from '@ozymandros/electron-message-bridge/boundary';
import { TransportError } from '@ozymandros/electron-message-bridge';

// ─── GrpcClient ───────────────────────────────────────────────────────────────

export interface GrpcClientOptions {
  /**
   * Server address to connect to.
   * @example '127.0.0.1:50051'
   */
  readonly address: string;
  /**
   * gRPC channel credentials. Provide via `grpc.credentials.createSsl(...)`.
   * Defaults to `grpc.credentials.createInsecure()` when omitted.
   * Typed `unknown` to avoid a hard compile-time dependency on grpc-js types.
   */
  readonly credentials?: unknown;
  /** Milliseconds before an invoke call times out. Defaults to 10 000 ms. */
  readonly timeoutMs?: number;
  /** Logger for diagnostics. Defaults to `console`. */
  readonly logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export class GrpcClient {
  private readonly address: string;
  private readonly credentials: unknown;
  private readonly timeoutMs: number;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stub: any | null = null;

  constructor(options: GrpcClientOptions) {
    this.address = options.address;
    this.credentials = options.credentials;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.logger = options.logger ?? console;
  }

  /** Create the gRPC channel and stub. */
  async connect(): Promise<void> {
    const grpcLib = await import('@grpc/grpc-js') as typeof import('@grpc/grpc-js');
    const ClientCtor = makeBridgeClientConstructor(grpcLib) as new (
      address: string,
      credentials: unknown,
      options?: unknown,
    ) => unknown;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const creds = this.credentials ?? grpcLib.credentials.createInsecure();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.stub = new ClientCtor(this.address, creds);
    this.logger.log(`[grpc] Client connected to ${this.address}`);
  }

  /** Invoke a channel on the remote server. */
  async invoke(channel: string, payload: BridgePayload): Promise<BridgePayload> {
    if (!this.stub) {
      throw new TransportError('gRPC client is not connected — call connect() first');
    }

    const request: InvokeRequest = {
      channel,
      payload: JSON.stringify(payload),
    };

    return new Promise<BridgePayload>((resolve, reject) => {
      const deadline = new Date(Date.now() + this.timeoutMs);

      // The stub's method name matches the key in BridgeServiceDefinition ('invoke').
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      this.stub.invoke(
        request,
        {},
        { deadline },
        (err: Error | null, response: InvokeResponse) => {
          if (err) {
            reject(new TransportError(`gRPC invoke failed: ${err.message}`));
            return;
          }
          if (response.error) {
            reject(new TransportError(response.error));
            return;
          }
          try {
            resolve(JSON.parse(response.result) as BridgePayload);
          } catch {
            reject(new TransportError('gRPC response contained invalid JSON'));
          }
        },
      );
    });
  }

  /** Close the gRPC channel. */
  async dispose(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    this.stub?.close();
    this.stub = null;
    this.logger.log('[grpc] Client channel closed');
  }
}