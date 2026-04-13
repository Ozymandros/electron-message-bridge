/**
 * @package @electron-ipc-helper/adapter-stdio
 *
 * stdio (stdin/stdout) transport adapter for electron-ipc-helper.
 *
 * Exposes the same typed `defineIpcApi` handlers over newline-delimited JSON
 * (NDJSON) written to a pair of `Readable`/`Writable` streams — by default
 * `process.stdin` / `process.stdout`.
 *
 * ## When to use
 *
 * - **Child-process communication** — Electron spawns a helper worker and
 *   communicates over stdio (no sockets, no ports, no network config)
 * - **CLI integration** — shell scripts or language-agnostic tools pipe JSON
 *   requests to the app and read JSON responses
 * - **Test harnesses** — inject mock streams in tests for deterministic I/O
 * - **Language bridges** — any runtime that can read/write stdout/stdin works
 *   without additional libraries
 *
 * ## Protocol
 *
 * One JSON object per line (`\n` terminated):
 *
 * ```
 * → {"id":"<uuid>","channel":"<name>","payload":<json>}
 * ← {"id":"<uuid>","result":<json>}
 * ← {"id":"<uuid>","error":{"code":"<string>","message":"<string>"}}
 * ```
 *
 * ## Quick start
 *
 * ```ts
 * // main.ts (server — reads from child's stdout, writes to child's stdin)
 * import { defineIpcApi } from 'electron-ipc-helper';
 * import { createStdioServerTransport } from '@electron-ipc-helper/adapter-stdio';
 * import { spawn } from 'node:child_process';
 *
 * const child = spawn('node', ['worker.js']);
 * const transport = createStdioServerTransport({
 *   readable: child.stdout,
 *   writable: child.stdin,
 * });
 * export const api = defineIpcApi({ getUser }, { transport });
 *
 * // worker.js (client — uses process.stdin / process.stdout)
 * import { createStdioClientTransport } from '@electron-ipc-helper/adapter-stdio';
 *
 * const transport = createStdioClientTransport();   // defaults to stdin/stdout
 * await transport.start();
 * const user = await transport.invoke('getUser', '123');
 * ```
 *
 * @module
 */

import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';
import type { TransportAdapter, TransportHandler } from 'electron-ipc-helper/transport';
import type { BridgePayload } from 'electron-ipc-helper/boundary';
import type { NegotiablePlugin, AdapterManifest } from 'electron-ipc-helper/plugins';
import type { Plugin, PluginContext } from 'electron-ipc-helper/plugins';
import { PROTOCOL_VERSION } from 'electron-ipc-helper/plugins';
import { TransportError } from 'electron-ipc-helper';
import {
  encodeStdioFrame,
  attachStdioDecoder,
} from './framing.js';
import type { StdioRequest, StdioResponse } from './framing.js';

export type { StdioRequest, StdioResponse, StdioFrame } from './framing.js';
export { encodeStdioFrame, attachStdioDecoder, LineSplitter } from './framing.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ADAPTER_NAME = '@electron-ipc-helper/adapter-stdio';
const ADAPTER_VERSION = '0.1.0';

// ─── Server transport ─────────────────────────────────────────────────────────

export interface StdioServerTransportOptions {
  /**
   * Readable stream carrying incoming requests.
   * @default process.stdin
   */
  readonly readable?: Readable;
  /**
   * Writable stream for outgoing responses.
   * @default process.stdout
   */
  readonly writable?: Writable;
  /** Logger for diagnostics. */
  readonly logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

/**
 * Server-side stdio transport.
 *
 * Reads NDJSON requests from `readable`, dispatches them to registered
 * handlers, and writes NDJSON responses to `writable`.
 *
 * Use with `defineIpcApi` in the **main process** or any Node.js host:
 *
 * ```ts
 * const transport = createStdioServerTransport({
 *   readable: childProcess.stdout,
 *   writable: childProcess.stdin,
 * });
 * defineIpcApi({ getUser }, { transport });
 * ```
 */
export class StdioServerTransport implements TransportAdapter {
  readonly name = 'stdio-server' as const;

  private readonly readable: Readable;
  private readonly writable: Writable;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly handlers = new Map<string, TransportHandler>();
  private started = false;

  constructor(options: StdioServerTransportOptions = {}) {
    this.readable = options.readable ?? process.stdin;
    this.writable = options.writable ?? process.stdout;
    this.logger = options.logger ?? console;
  }

  handle(channel: string, handler: TransportHandler): void {
    this.handlers.set(channel, handler);
  }

  invoke(_channel: string, _payload: BridgePayload): Promise<BridgePayload> {
    throw new Error(
      '[stdio] StdioServerTransport.invoke() is not supported — ' +
        'use StdioClientTransport on the client side.',
    );
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    attachStdioDecoder(this.readable, (frame) => {
      if (!('channel' in frame)) return; // skip responses
      void this.dispatch(frame as StdioRequest);
    });

    this.logger.log('[stdio] Server transport started');
  }

  async dispose(): Promise<void> {
    this.started = false;
    this.logger.log('[stdio] Server transport disposed');
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async dispatch(req: StdioRequest): Promise<void> {
    const handler = this.handlers.get(req.channel);
    let response: StdioResponse;

    if (!handler) {
      response = {
        id: req.id,
        error: {
          code: 'ERR_UNKNOWN_CHANNEL',
          message: `No handler for channel "${req.channel}"`,
        },
      };
    } else {
      try {
        const result = await handler(req.payload as BridgePayload);
        response = { id: req.id, result };
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        response = {
          id: req.id,
          error: { code: 'ERR_HANDLER_THREW', message: e.message },
        };
      }
    }

    this.writable.write(encodeStdioFrame(response));
  }
}

// ─── Client transport ─────────────────────────────────────────────────────────

export interface StdioClientTransportOptions {
  /**
   * Readable stream carrying incoming responses.
   * @default process.stdin
   */
  readonly readable?: Readable;
  /**
   * Writable stream for outgoing requests.
   * @default process.stdout
   */
  readonly writable?: Writable;
  /** Milliseconds before an invoke call times out. Defaults to 10 000 ms. */
  readonly timeoutMs?: number;
  /** Logger for diagnostics. */
  readonly logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

interface PendingCall {
  resolve: (value: BridgePayload) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Client-side stdio transport.
 *
 * Writes NDJSON requests to `writable` and reads NDJSON responses from
 * `readable`. Defaults to `process.stdout` / `process.stdin` so a child
 * process can talk back to its parent without any configuration.
 *
 * ```ts
 * const transport = createStdioClientTransport(); // uses process.stdin/stdout
 * await transport.start();
 * const result = await transport.invoke('getUser', '123');
 * ```
 */
export class StdioClientTransport implements TransportAdapter {
  readonly name = 'stdio-client' as const;

  private readonly readable: Readable;
  private readonly writable: Writable;
  private readonly timeoutMs: number;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly pending = new Map<string, PendingCall>();
  private started = false;

  constructor(options: StdioClientTransportOptions = {}) {
    this.readable = options.readable ?? process.stdin;
    this.writable = options.writable ?? process.stdout;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.logger = options.logger ?? console;
  }

  handle(_channel: string, _handler: unknown): void {
    throw new Error(
      '[stdio] StdioClientTransport.handle() is not supported — ' +
        'handlers are registered on the server side.',
    );
  }

  async invoke(channel: string, payload: BridgePayload): Promise<BridgePayload> {
    if (!this.started) {
      throw new TransportError('stdio client transport has not been started — call start() first');
    }

    const id = randomUUID();
    const request: StdioRequest = { id, channel, payload };

    return new Promise<BridgePayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TransportError(`stdio invoke timed out after ${this.timeoutMs}ms on channel "${channel}"`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.writable.write(encodeStdioFrame(request));
    });
  }

  /** Begin reading responses from the readable stream. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    attachStdioDecoder(this.readable, (frame) => {
      if ('channel' in frame) return; // skip requests
      this.onResponse(frame as StdioResponse);
    });

    this.readable.on('close', () => {
      this.rejectAllPending(new TransportError('stdio stream closed'));
    });

    this.logger.log('[stdio] Client transport started');
  }

  async dispose(): Promise<void> {
    this.rejectAllPending(new TransportError('stdio client disposed'));
    this.started = false;
  }

  // ── private ────────────────────────────────────────────────────────────────

  private onResponse(response: StdioResponse): void {
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
    for (const [id, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(err);
      this.pending.delete(id);
    }
  }
}

// ─── Factory functions ────────────────────────────────────────────────────────

/**
 * Create a server-side stdio transport.
 *
 * @example
 * ```ts
 * const child = spawn('node', ['worker.js']);
 * const transport = createStdioServerTransport({
 *   readable: child.stdout,
 *   writable: child.stdin,
 * });
 * defineIpcApi({ getUser }, { transport });
 * ```
 */
export function createStdioServerTransport(
  options: StdioServerTransportOptions = {},
): StdioServerTransport {
  return new StdioServerTransport(options);
}

/**
 * Create a client-side stdio transport.
 *
 * @example
 * ```ts
 * // In a child process — talks to its parent via stdin/stdout
 * const transport = createStdioClientTransport();
 * await transport.start();
 * const result = await transport.invoke('getUser', '123');
 * ```
 */
export function createStdioClientTransport(
  options: StdioClientTransportOptions = {},
): StdioClientTransport {
  return new StdioClientTransport(options);
}

// ─── StdioPlugin ──────────────────────────────────────────────────────────────

/**
 * Capabilities declared by the stdio plugin.
 */
export interface StdioCapabilities {
  /** Whether the transport is using default process streams. */
  usesProcessStreams: boolean;
}

/**
 * Plugin that integrates a `StdioServerTransport` with the `PluginHost`
 * lifecycle system.
 *
 * The transport starts listening on `init` and stops on `dispose`.
 *
 * @example
 * ```ts
 * import { spawn } from 'node:child_process';
 * const child = spawn('node', ['worker.js']);
 *
 * const host = new PluginHost({ logger: console });
 * host.register(new StdioPlugin({
 *   readable: child.stdout,
 *   writable: child.stdin,
 * }));
 * await host.init();
 * ```
 */
export class StdioPlugin implements Plugin<StdioCapabilities>, NegotiablePlugin {
  readonly name = 'stdio' as const;
  readonly capabilities: StdioCapabilities;
  private readonly transport: StdioServerTransport;

  constructor(private readonly options: StdioServerTransportOptions = {}) {
    this.transport = new StdioServerTransport(options);
    this.capabilities = {
      usesProcessStreams: !options.readable && !options.writable,
    };
  }

  /** Expose the server transport for use with `defineIpcApi`. */
  get serverTransport(): StdioServerTransport {
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
        protocol: 'stdio',
        framing: 'ndjson',
        usesProcessStreams: this.capabilities.usesProcessStreams,
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
