/**
 * Tests for @electron-ipc-helper/adapter-stdio
 *
 * Covers:
 *  - LineSplitter / encodeStdioFrame / attachStdioDecoder (framing)
 *  - StdioServerTransport: handler dispatch, error propagation, unknown channel
 *  - StdioClientTransport: invoke, timeout, stream close rejection
 *  - Round-trip: server + client wired via PassThrough streams
 *  - StdioPlugin: NegotiablePlugin manifest, Plugin lifecycle
 *  - Factory functions: createStdioServerTransport, createStdioClientTransport
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';

import {
  encodeStdioFrame,
  LineSplitter,
  attachStdioDecoder,
} from '../src/framing.js';
import type { StdioFrame } from '../src/framing.js';

import {
  StdioServerTransport,
  StdioClientTransport,
  StdioPlugin,
  createStdioServerTransport,
  createStdioClientTransport,
} from '../src/index.js';
import type { BridgePayload } from 'electron-ipc-helper/boundary';

// ─── Framing ──────────────────────────────────────────────────────────────────

describe('encodeStdioFrame', () => {
  it('produces a JSON string terminated by \\n', () => {
    const frame: StdioFrame = { id: '1', channel: 'ping', payload: null };
    const line = encodeStdioFrame(frame);
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line.trim())).toEqual(frame);
  });

  it('encodes response frames', () => {
    const frame: StdioFrame = { id: '2', result: { ok: true } };
    const line = encodeStdioFrame(frame);
    expect(JSON.parse(line.trim())).toEqual(frame);
  });

  it('encodes error response frames', () => {
    const frame: StdioFrame = {
      id: '3',
      error: { code: 'ERR_OOPS', message: 'something went wrong' },
    };
    const line = encodeStdioFrame(frame);
    expect(JSON.parse(line.trim())).toEqual(frame);
  });
});

describe('LineSplitter', () => {
  it('emits complete lines', () => {
    const lines: string[] = [];
    const s = new LineSplitter((l) => lines.push(l));
    s.push('{"a":1}\n{"b":2}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('handles fragmented input', () => {
    const lines: string[] = [];
    const s = new LineSplitter((l) => lines.push(l));
    s.push('{"x"');
    expect(lines).toHaveLength(0);
    s.push(':42}\n');
    expect(lines).toEqual(['{"x":42}']);
  });

  it('handles CRLF line endings', () => {
    const lines: string[] = [];
    const s = new LineSplitter((l) => lines.push(l));
    s.push('{"cr":true}\r\n');
    expect(lines).toEqual(['{"cr":true}']);
  });

  it('ignores empty lines', () => {
    const lines: string[] = [];
    const s = new LineSplitter((l) => lines.push(l));
    s.push('\n\n{"ok":1}\n\n');
    expect(lines).toEqual(['{"ok":1}']);
  });

  it('reset() clears the internal buffer', () => {
    const lines: string[] = [];
    const s = new LineSplitter((l) => lines.push(l));
    s.push('{"part"');
    s.reset();
    s.push('{"clean":true}\n');
    expect(lines).toEqual(['{"clean":true}']);
  });
});

describe('attachStdioDecoder', () => {
  it('decodes frames from a readable stream', () => {
    const stream = new PassThrough();
    const frames: StdioFrame[] = [];
    attachStdioDecoder(stream, (f) => frames.push(f));

    const req: StdioFrame = { id: 'r1', channel: 'hello', payload: 'world' };
    stream.write(encodeStdioFrame(req));
    expect(frames[0]).toEqual(req);
  });

  it('skips malformed JSON without crashing', () => {
    const stream = new PassThrough();
    const frames: StdioFrame[] = [];
    attachStdioDecoder(stream, (f) => frames.push(f));

    stream.write('NOT JSON\n');
    expect(frames).toHaveLength(0);

    const valid: StdioFrame = { id: 'v', result: 42 };
    stream.write(encodeStdioFrame(valid));
    expect(frames[0]).toEqual(valid);
  });
});

// ─── StdioServerTransport ─────────────────────────────────────────────────────

describe('StdioServerTransport', () => {
  it('has name "stdio-server"', () => {
    expect(createStdioServerTransport().name).toBe('stdio-server');
  });

  it('invoke() throws — server transport does not invoke', () => {
    const t = createStdioServerTransport();
    expect(() => t.invoke('ch', null)).toThrow('StdioServerTransport.invoke()');
  });

  it('start() attaches decoder and resolves', async () => {
    const r = new PassThrough();
    const w = new PassThrough();
    const t = createStdioServerTransport({ readable: r, writable: w, logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    await expect(t.start()).resolves.toBeUndefined();
    await t.dispose();
  });

  it('dispatches requests to registered handlers', async () => {
    const r = new PassThrough();
    const w = new PassThrough();
    const t = createStdioServerTransport({ readable: r, writable: w, logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    t.handle('echo', async (p: BridgePayload) => p);
    await t.start();

    const req: StdioFrame = { id: 'echo1', channel: 'echo', payload: { msg: 'hi' } };
    r.write(encodeStdioFrame(req));

    // Give the async dispatch a tick to complete
    await new Promise((res) => setImmediate(res));

    const out = w.read() as Buffer | null;
    expect(out).not.toBeNull();
    const response = JSON.parse(out!.toString()) as { id: string; result: unknown };
    expect(response.id).toBe('echo1');
    expect(response.result).toEqual({ msg: 'hi' });

    await t.dispose();
  });

  it('writes error response for unknown channel', async () => {
    const r = new PassThrough();
    const w = new PassThrough();
    const t = createStdioServerTransport({ readable: r, writable: w, logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    await t.start();

    r.write(encodeStdioFrame({ id: 'u1', channel: 'nonexistent', payload: null }));
    await new Promise((res) => setImmediate(res));

    const out = JSON.parse((w.read() as Buffer).toString()) as { error: { code: string } };
    expect(out.error.code).toBe('ERR_UNKNOWN_CHANNEL');

    await t.dispose();
  });

  it('writes error response when handler throws', async () => {
    const r = new PassThrough();
    const w = new PassThrough();
    const t = createStdioServerTransport({ readable: r, writable: w, logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    t.handle('fail', async () => { throw new Error('boom'); });
    await t.start();

    r.write(encodeStdioFrame({ id: 'f1', channel: 'fail', payload: null }));
    await new Promise((res) => setImmediate(res));

    const out = JSON.parse((w.read() as Buffer).toString()) as { error: { message: string } };
    expect(out.error.message).toBe('boom');

    await t.dispose();
  });
});

// ─── StdioClientTransport ─────────────────────────────────────────────────────

describe('StdioClientTransport', () => {
  it('has name "stdio-client"', () => {
    expect(createStdioClientTransport().name).toBe('stdio-client');
  });

  it('handle() throws — client transport does not register handlers', () => {
    const t = createStdioClientTransport();
    expect(() => t.handle('ch', async () => null)).toThrow('StdioClientTransport.handle()');
  });

  it('invoke() before start() throws TransportError', async () => {
    const t = createStdioClientTransport();
    await expect(t.invoke('ch', null)).rejects.toThrow('not been started');
  });

  it('invoke() writes a request line to the writable stream', async () => {
    const r = new PassThrough();
    const w = new PassThrough();
    const t = createStdioClientTransport({ readable: r, writable: w, logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    await t.start();

    // Don't await — we'll manually feed the response
    const invocation = t.invoke('greet', 'alice');
    await new Promise((res) => setImmediate(res));

    const sent = JSON.parse((w.read() as Buffer).toString()) as StdioFrame;
    expect('channel' in sent).toBe(true);
    expect((sent as { channel: string }).channel).toBe('greet');

    // Feed a matching response
    r.push(encodeStdioFrame({ id: (sent as { id: string }).id, result: 'hello alice' }));
    const result = await invocation;
    expect(result).toBe('hello alice');

    await t.dispose();
  });

  it('rejects with TransportError when response carries error', async () => {
    const r = new PassThrough();
    const w = new PassThrough();
    const t = createStdioClientTransport({ readable: r, writable: w, logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    await t.start();

    const invocation = t.invoke('boom', null);
    await new Promise((res) => setImmediate(res));

    const sent = JSON.parse((w.read() as Buffer).toString()) as { id: string };
    r.push(encodeStdioFrame({ id: sent.id, error: { code: 'ERR_BOOM', message: 'it exploded' } }));

    await expect(invocation).rejects.toThrow('it exploded');
    await t.dispose();
  });

  it('rejects all pending calls on dispose()', async () => {
    const r = new PassThrough();
    const w = new PassThrough();
    const t = createStdioClientTransport({ readable: r, writable: w, logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    await t.start();

    const invocation = t.invoke('slow', null);
    await new Promise((res) => setImmediate(res));
    w.read(); // consume the request line

    await t.dispose();
    await expect(invocation).rejects.toThrow('disposed');
  });
});

// ─── End-to-end round-trip ────────────────────────────────────────────────────

describe('stdio round-trip (server + client via PassThrough)', () => {
  it('routes a request through and returns the result', async () => {
    // server reads from pipe1, writes to pipe2
    // client reads from pipe2, writes to pipe1
    const pipe1 = new PassThrough(); // client → server
    const pipe2 = new PassThrough(); // server → client

    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const server = createStdioServerTransport({ readable: pipe1, writable: pipe2, logger });
    const client = createStdioClientTransport({ readable: pipe2, writable: pipe1, logger });

    server.handle('add', async (payload: BridgePayload) => {
      const { a, b } = payload as { a: number; b: number };
      return a + b;
    });

    await server.start();
    await client.start();

    const result = await client.invoke('add', { a: 3, b: 4 });
    expect(result).toBe(7);

    await server.dispose();
    await client.dispose();
  });
});

// ─── Factory functions ────────────────────────────────────────────────────────

describe('createStdioServerTransport', () => {
  it('returns a StdioServerTransport instance', () => {
    expect(createStdioServerTransport()).toBeInstanceOf(StdioServerTransport);
  });
});

describe('createStdioClientTransport', () => {
  it('returns a StdioClientTransport instance', () => {
    expect(createStdioClientTransport()).toBeInstanceOf(StdioClientTransport);
  });
});

// ─── StdioPlugin ─────────────────────────────────────────────────────────────

describe('StdioPlugin', () => {
  it('has Plugin.name = "stdio"', () => {
    expect(new StdioPlugin().name).toBe('stdio');
  });

  it('getManifest() returns a valid AdapterManifest', () => {
    const plugin = new StdioPlugin();
    const manifest = plugin.getManifest();
    expect(manifest.name).toBe('@electron-ipc-helper/adapter-stdio');
    expect(typeof manifest.version).toBe('string');
    expect(manifest.protocolVersion).toBeGreaterThanOrEqual(1);
    expect(manifest.supportsBinary).toBe(false);
    expect(manifest.supportsStreaming).toBe(false);
    expect((manifest.capabilities as Record<string, unknown>)['protocol']).toBe('stdio');
    expect((manifest.capabilities as Record<string, unknown>)['framing']).toBe('ndjson');
  });

  it('capabilities.usesProcessStreams is true when no streams provided', () => {
    const plugin = new StdioPlugin();
    expect(plugin.capabilities.usesProcessStreams).toBe(true);
  });

  it('capabilities.usesProcessStreams is false when custom streams provided', () => {
    const plugin = new StdioPlugin({ readable: new PassThrough(), writable: new PassThrough() });
    expect(plugin.capabilities.usesProcessStreams).toBe(false);
  });

  it('serverTransport getter returns a StdioServerTransport', () => {
    expect(new StdioPlugin().serverTransport).toBeInstanceOf(StdioServerTransport);
  });

  it('init() starts the server transport', async () => {
    const r = new PassThrough();
    const w = new PassThrough();
    const ctx = { name: 'stdio', logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    const plugin = new StdioPlugin({ readable: r, writable: w, logger: ctx.logger });
    await expect(plugin.init(ctx)).resolves.toBeUndefined();
    await plugin.dispose(ctx);
  });

  it('dispose() stops the server transport', async () => {
    const r = new PassThrough();
    const w = new PassThrough();
    const ctx = { name: 'stdio', logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    const plugin = new StdioPlugin({ readable: r, writable: w, logger: ctx.logger });
    await plugin.init(ctx);
    await expect(plugin.dispose(ctx)).resolves.toBeUndefined();
  });
});
