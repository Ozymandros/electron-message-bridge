/**
 * Vitest manual mock for Node.js `net` module.
 *
 * Provides controllable socket/server doubles so Named Pipe tests
 * run entirely in-process without opening real OS sockets.
 */

import { vi } from 'vitest';
import { EventEmitter } from 'node:events';

// ─── MockSocket ───────────────────────────────────────────────────────────────

export class MockSocket extends EventEmitter {
  readonly destroyed = false;
  write = vi.fn();
  destroy = vi.fn();
}

// ─── MockServer ───────────────────────────────────────────────────────────────

export class MockServer extends EventEmitter {
  listen = vi.fn((_path: string, cb?: () => void) => {
    if (cb) setImmediate(cb);
    return this;
  });
  close = vi.fn((cb?: () => void) => {
    if (cb) setImmediate(cb);
  });
}

// ─── createServer / createConnection ─────────────────────────────────────────

export const createServer = vi.fn(() => new MockServer());
export const createConnection = vi.fn(() => new MockSocket());

// Default export matching `import net from 'node:net'`
export default {
  createServer,
  createConnection,
  MockServer,
  MockSocket,
};
