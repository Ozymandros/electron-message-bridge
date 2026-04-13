/**
 * Length-prefixed framing for JSON messages over a duplex Node.js stream.
 *
 * Wire format (per message):
 *   [ 4 bytes big-endian uint32 length ][ UTF-8 JSON body ]
 *
 * This is the lowest-level building block — both the server and client
 * parsers share this framing logic.
 */

import type { Readable } from 'node:stream';

// ─── Frame types ──────────────────────────────────────────────────────────────

export interface FrameRequest {
  readonly id: string;
  readonly channel: string;
  readonly payload: unknown;
}

export interface FrameResponse {
  readonly id: string;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export type Frame = FrameRequest | FrameResponse;

// ─── Encoder ─────────────────────────────────────────────────────────────────

/**
 * Encode a JSON-serialisable `Frame` into a length-prefixed `Buffer`.
 */
export function encodeFrame(frame: Frame): Buffer {
  const body = Buffer.from(JSON.stringify(frame), 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

// ─── Streaming decoder ────────────────────────────────────────────────────────

/**
 * Stateful incremental decoder for a length-prefixed JSON stream.
 *
 * Push incoming `Buffer` chunks via `push(chunk)`.
 * Completed frames are emitted via the `onFrame` callback.
 */
export class FrameDecoder {
  private buf = Buffer.alloc(0);

  constructor(private readonly onFrame: (frame: Frame) => void) {}

  push(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);

    while (this.buf.length >= 4) {
      const msgLen = this.buf.readUInt32BE(0);
      if (this.buf.length < 4 + msgLen) break; // wait for more data

      const body = this.buf.subarray(4, 4 + msgLen);
      this.buf = this.buf.subarray(4 + msgLen);

      try {
        const frame = JSON.parse(body.toString('utf8')) as Frame;
        this.onFrame(frame);
      } catch {
        // Malformed JSON — skip frame; connection remains usable.
      }
    }
  }

  /** Reset internal buffer (call on socket close). */
  reset(): void {
    this.buf = Buffer.alloc(0);
  }
}

// ─── Convenience pipe helper ──────────────────────────────────────────────────

/**
 * Attach a `FrameDecoder` to a Node.js `Readable` stream.
 * Returns the decoder so callers can hook into `onFrame` via the constructor.
 */
export function attachDecoder(
  stream: Readable,
  onFrame: (frame: Frame) => void,
): FrameDecoder {
  const decoder = new FrameDecoder(onFrame);
  stream.on('data', (chunk: Buffer) => decoder.push(chunk));
  stream.on('close', () => decoder.reset());
  return decoder;
}
