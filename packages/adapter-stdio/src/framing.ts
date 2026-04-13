/**
 * Newline-delimited JSON (NDJSON) framing for stdio streams.
 *
 * Wire format: one JSON object per line, terminated by `\n`.
 * This is the simplest possible framing — compatible with every language's
 * standard I/O primitives and trivial to inspect with `cat` or `jq`.
 *
 * Each line encodes either a request or a response:
 *
 *   Request  → { "id": "<uuid>", "channel": "<name>", "payload": <json> }
 *   Response → { "id": "<uuid>", "result": <json> }
 *            | { "id": "<uuid>", "error":  { "code": "<string>", "message": "<string>" } }
 */

import type { Readable } from 'node:stream';

// ─── Frame types ──────────────────────────────────────────────────────────────

export interface StdioRequest {
  readonly id: string;
  readonly channel: string;
  readonly payload: unknown;
}

export interface StdioResponse {
  readonly id: string;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export type StdioFrame = StdioRequest | StdioResponse;

// ─── Encoder ─────────────────────────────────────────────────────────────────

/**
 * Serialise a frame to a single newline-terminated JSON string.
 * Safe to write directly to a `WritableStream` or `process.stdout`.
 */
export function encodeStdioFrame(frame: StdioFrame): string {
  return JSON.stringify(frame) + '\n';
}

// ─── Line splitter ────────────────────────────────────────────────────────────

/**
 * Splits a stream into complete newline-delimited lines.
 * Handles chunks that arrive mid-line (common with large payloads).
 */
export class LineSplitter {
  private buf = '';

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: string | Buffer): void {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trimEnd(); // strip \r if Windows CRLF
      this.buf = this.buf.slice(nl + 1);
      if (line.length > 0) this.onLine(line);
    }
  }

  reset(): void {
    this.buf = '';
  }
}

// ─── Stream decoder ───────────────────────────────────────────────────────────

/**
 * Parse incoming NDJSON lines from a `Readable` and emit decoded frames.
 */
export function attachStdioDecoder(
  stream: Readable,
  onFrame: (frame: StdioFrame) => void,
): LineSplitter {
  const splitter = new LineSplitter((line) => {
    try {
      const frame = JSON.parse(line) as StdioFrame;
      onFrame(frame);
    } catch {
      // Malformed JSON line — skip silently; stream remains usable.
    }
  });

  stream.setEncoding('utf8');
  stream.on('data', (chunk: string | Buffer) => splitter.push(chunk));
  stream.on('close', () => splitter.reset());
  return splitter;
}
