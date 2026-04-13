/**
 * Named Pipe / Unix socket server for the main process.
 *
 * Accepts multiple connections, dispatches `FrameRequest` messages to
 * registered handlers, and writes `FrameResponse` replies back.
 *
 * On Windows: `path` should be `\\.\pipe\<name>`.
 * On macOS/Linux: `path` should be an absolute filesystem path (e.g. `/tmp/app.sock`).
 */

import net from 'node:net';
import { encodeFrame, attachDecoder } from './framing.js';
import type { FrameRequest, FrameResponse } from './framing.js';
import type { TransportHandler } from 'electron-ipc-helper/transport';

// ─── NamedPipeServer ──────────────────────────────────────────────────────────

export interface NamedPipeServerOptions {
  /**
   * Path for the Unix socket or Windows named pipe.
   * Defaults to `/tmp/electron-ipc-helper.sock` (or the Windows equivalent).
   */
  readonly path: string;
  /** Logger for diagnostics. Defaults to `console`. */
  readonly logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export class NamedPipeServer {
  private readonly path: string;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly handlers = new Map<string, TransportHandler>();
  private server: net.Server | null = null;

  constructor(options: NamedPipeServerOptions) {
    this.path = options.path;
    this.logger = options.logger ?? console;
  }

  /** Register a handler for a named channel. */
  handle(channel: string, handler: TransportHandler): void {
    this.handlers.set(channel, handler);
  }

  /** Start listening for connections on the pipe path. */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.onConnection(socket);
      });

      this.server.on('error', (err) => {
        this.logger.error('[named-pipe] Server error:', err.message);
        reject(err);
      });

      this.server.listen(this.path, () => {
        this.logger.log(`[named-pipe] Listening on ${this.path}`);
        resolve();
      });
    });
  }

  /** Close the server and all open connections. */
  async dispose(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.logger.log('[named-pipe] Server closed');
        resolve();
      });
      this.server = null;
    });
  }

  // ── private ────────────────────────────────────────────────────────────────

  private onConnection(socket: net.Socket): void {
    attachDecoder(socket, (frame) => {
      // Only process frames that look like requests (have channel field).
      if (!('channel' in frame)) return;
      void this.dispatch(frame as FrameRequest, socket);
    });

    socket.on('error', (err) => {
      this.logger.warn('[named-pipe] Socket error:', err.message);
    });
  }

  private async dispatch(req: FrameRequest, socket: net.Socket): Promise<void> {
    const handler = this.handlers.get(req.channel);
    let response: FrameResponse;

    if (!handler) {
      response = {
        id: req.id,
        error: { code: 'ERR_UNKNOWN_CHANNEL', message: `No handler for channel "${req.channel}"` },
      };
    } else {
      try {
        const result = await handler(req.payload as Parameters<TransportHandler>[0]);
        response = { id: req.id, result };
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        response = {
          id: req.id,
          error: { code: 'ERR_HANDLER_THREW', message: e.message },
        };
      }
    }

    if (!socket.destroyed) {
      socket.write(encodeFrame(response));
    }
  }
}
