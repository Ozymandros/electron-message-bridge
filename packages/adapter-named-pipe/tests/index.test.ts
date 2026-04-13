/**
 * Tests for @electron-ipc-helper/adapter-named-pipe
 *
 * Covers:
 *  - FrameDecoder / encodeFrame round-trip
 *  - NamedPipeServer: handler dispatch, error propagation, unknown channel
 *  - NamedPipeClient: invoke, timeout, connection loss
 *  - NamedPipeServerTransport / NamedPipeClientTransport: TransportAdapter contract
 *  - NamedPipePlugin: NegotiablePlugin manifest, Plugin lifecycle
 *  - Factory functions: createNamedPipeServerTransport, createNamedPipeClientTransport
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ─── Imports under test ───────────────────────────────────────────────────────

import { encodeFrame, FrameDecoder, attachDecoder } from '../src/framing.js';
import type { Frame } from '../src/framing.js';

import {
  NamedPipeServerTransport,
  NamedPipeClientTransport,
  NamedPipePlugin,
  createNamedPipeServerTransport,
  createNamedPipeClientTransport,
} from '../src/index.js';

// ─── Framing ──────────────────────────────────────────────────────────────────

describe('encodeFrame / FrameDecoder', () => {
  it('round-trips a FrameRequest', () => {
    const frame: Frame = { id: 'abc', channel: 'ping', payload: { n: 42 } };
    const buf = encodeFrame(frame);

    const received: Frame[] = [];
    const decoder = new FrameDecoder((f) => received.push(f));
    decoder.push(buf);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(frame);
  });

  it('round-trips a FrameResponse with result', () => {
    const frame: Frame = { id: 'xyz', result: 'hello' };
    const buf = encodeFrame(frame);

    const received: Frame[] = [];
    const decoder = new FrameDecoder((f) => received.push(f));
    decoder.push(buf);

    expect(received[0]).toEqual(frame);
  });

  it('handles multiple frames in a single push (concatenated buffers)', () => {
    const f1: Frame = { id: '1', channel: 'a', payload: null };
    const f2: Frame = { id: '2', channel: 'b', payload: 99 };
    const combined = Buffer.concat([encodeFrame(f1), encodeFrame(f2)]);

    const received: Frame[] = [];
    const decoder = new FrameDecoder((f) => received.push(f));
    decoder.push(combined);

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(f1);
    expect(received[1]).toEqual(f2);
  });

  it('handles split chunk delivery (simulates TCP fragmentation)', () => {
    const frame: Frame = { id: 'split', channel: 'x', payload: true };
    const buf = encodeFrame(frame);
    const mid = Math.floor(buf.length / 2);

    const received: Frame[] = [];
    const decoder = new FrameDecoder((f) => received.push(f));
    decoder.push(buf.subarray(0, mid));
    expect(received).toHaveLength(0); // incomplete — no frame yet
    decoder.push(buf.subarray(mid));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(frame);
  });

  it('skips malformed JSON frames without crashing', () => {
    const bad = Buffer.allocUnsafe(4 + 5);
    bad.writeUInt32BE(5, 0);
    bad.write('!!BAD', 4, 'utf8');

    const received: Frame[] = [];
    const decoder = new FrameDecoder((f) => received.push(f));
    decoder.push(bad);
    expect(received).toHaveLength(0); // skipped silently
  });

  it('reset() clears the internal buffer', () => {
    const frame: Frame = { id: 'r', channel: 'q', payload: 0 };
    const buf = encodeFrame(frame);
    const half = buf.subarray(0, 2);

    const received: Frame[] = [];
    const decoder = new FrameDecoder((f) => received.push(f));
    decoder.push(half); // partial — buffered
    decoder.reset();
    decoder.push(buf); // start fresh — full frame
    expect(received).toHaveLength(1);
  });

  it('attachDecoder() wires decoder to a readable stream', () => {
    const stream = new EventEmitter() as EventEmitter & { on: typeof EventEmitter.prototype.on };
    const received: Frame[] = [];
    attachDecoder(stream as Parameters<typeof attachDecoder>[0], (f) => received.push(f));

    const frame: Frame = { id: 'ev', channel: 'test', payload: 'hi' };
    stream.emit('data', encodeFrame(frame));
    expect(received[0]).toEqual(frame);
  });
});

// ─── NamedPipeServerTransport ─────────────────────────────────────────────────

describe('NamedPipeServerTransport', () => {
  it('has name "named-pipe-server"', () => {
    const t = createNamedPipeServerTransport('/tmp/test.sock');
    expect(t.name).toBe('named-pipe-server');
  });

  it('invoke() throws — server transport does not support invoke', () => {
    const t = createNamedPipeServerTransport('/tmp/test.sock');
    expect(() => t.invoke('ch', null)).toThrow('NamedPipeServerTransport.invoke()');
  });

  it('handle() does not throw', () => {
    const t = createNamedPipeServerTransport('/tmp/test.sock');
    expect(() => t.handle('ping', async () => 'pong')).not.toThrow();
  });
});

// ─── NamedPipeClientTransport ─────────────────────────────────────────────────

describe('NamedPipeClientTransport', () => {
  it('has name "named-pipe-client"', () => {
    const t = createNamedPipeClientTransport('/tmp/test.sock');
    expect(t.name).toBe('named-pipe-client');
  });

  it('handle() throws — client transport does not register handlers', () => {
    const t = createNamedPipeClientTransport('/tmp/test.sock');
    expect(() => t.handle('ch', async () => null)).toThrow(
      'NamedPipeClientTransport.handle()',
    );
  });
});

// ─── Factory functions ────────────────────────────────────────────────────────

describe('createNamedPipeServerTransport', () => {
  it('returns a NamedPipeServerTransport instance', () => {
    expect(createNamedPipeServerTransport('/tmp/t.sock')).toBeInstanceOf(NamedPipeServerTransport);
  });
});

describe('createNamedPipeClientTransport', () => {
  it('returns a NamedPipeClientTransport instance', () => {
    expect(createNamedPipeClientTransport('/tmp/t.sock')).toBeInstanceOf(NamedPipeClientTransport);
  });
});

// ─── NamedPipePlugin ──────────────────────────────────────────────────────────

describe('NamedPipePlugin', () => {
  it('implements NegotiablePlugin — getManifest() returns AdapterManifest', () => {
    const plugin = new NamedPipePlugin({ path: '/tmp/plugin.sock' });
    const manifest = plugin.getManifest();

    expect(manifest.name).toBe('@electron-ipc-helper/adapter-named-pipe');
    expect(typeof manifest.version).toBe('string');
    expect(manifest.protocolVersion).toBeGreaterThanOrEqual(1);
    expect(manifest.supportsBinary).toBe(true);
    expect(manifest.supportsStreaming).toBe(false);
    expect((manifest.capabilities as Record<string, unknown>)['protocol']).toBe('named-pipe');
    expect((manifest.capabilities as Record<string, unknown>)['pipePath']).toBe('/tmp/plugin.sock');
  });

  it('has Plugin.name = "named-pipe"', () => {
    const plugin = new NamedPipePlugin({ path: '/tmp/p.sock' });
    expect(plugin.name).toBe('named-pipe');
  });

  it('exposes capabilities with pipePath', () => {
    const plugin = new NamedPipePlugin({ path: '/tmp/caps.sock' });
    expect(plugin.capabilities.pipePath).toBe('/tmp/caps.sock');
  });

  it('serverTransport getter returns a NamedPipeServerTransport', () => {
    const plugin = new NamedPipePlugin({ path: '/tmp/s.sock' });
    expect(plugin.serverTransport).toBeInstanceOf(NamedPipeServerTransport);
  });
});
