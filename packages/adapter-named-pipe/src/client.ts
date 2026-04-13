/**
 * Named Pipe / Unix socket client.
 *
 * Connects to a `NamedPipeServer`, sends `FrameRequest` messages,
 * and resolves the correlated `FrameResponse` using a pending-promise map.
 */

import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { encodeFrame, attachDecoder } from './framing.js';
import type { FrameRequest, FrameResponse } from './framing.js';
import type { BridgePayload } from 'electron-ipc-helper/boundary';
import { TransportError } from 'electron-ipc-helper';

// ─── NamedPipeClient ──────────────────────────────────────────────────────────

export interface NamedPipeClientOptions {
  /** Path for the Unix socket or Windows named pipe. */
  readonly path: string;
  /** Milliseconds before an invoke call times out. Defaults to 10 000 ms. */
  readonly timeoutMs?: number;
  /** Logger for diagnostics. Defaults to `console`. */
  readonly logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

interface PendingCall {
  resolve: (value: BridgePayload) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class NamedPipeClient {
  private readonly path: string;
  private readonly timeoutMs: number;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly pending = new Map<string, PendingCall>();
  private socket: net.Socket | null = null;
  private connected = false;

  constructor(options: NamedPipeClientOptions) {
    this.path = options.path;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.logger = options.logger ?? console;
  }

  /** Connect to the server. Resolves when the socket is ready. */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ path: this.path });
      this.socket = socket;

      attachDecoder(socket, (frame) => {
        if (!('id' in frame) || 'channel' in frame) return; // skip requests
        this.onResponse(frame as FrameResponse);
      });

      socket.once('connect', () => {
        this.connected = true;
        this.logger.log(`[named-pipe] Client connected to ${this.path}`);
        resolve();
      });

      socket.once('error', (err) => {
        if (!this.connected) reject(err);
        else this.logger.error('[named-pipe] Client socket error:', err.message);
      });

      socket.on('close', () => {
        this.connected = false;
        this.rejectAllPending(new TransportError('Named pipe connection closed'));
      });
    });
  }

  /** Send a request and await the response. */
  async invoke(channel: string, payload: BridgePayload): Promise<BridgePayload> {
    if (!this.socket || !this.connected) {
      throw new TransportError('Named pipe client is not connected');
    }

    const id = randomUUID();
    const request: FrameRequest = { id, channel, payload };

    return new Promise<BridgePayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TransportError(`Named pipe invoke timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.socket!.write(encodeFrame(request));
    });
  }

  /** Disconnect cleanly. */
  async dispose(): Promise<void> {
    this.rejectAllPending(new TransportError('Named pipe client disposed'));
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
  }

  // ── private ────────────────────────────────────────────────────────────────

  private onResponse(response: FrameResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;

    this.pending.delete(response.id);
    clearTimeout(pending.timer);

    if (response.error) {
      pending.reject(new TransportError(response.error.message));
    } else {
      pending.resolve(response.result as BridgePayload);
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
  }
}
