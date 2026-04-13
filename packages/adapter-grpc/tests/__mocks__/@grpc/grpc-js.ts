/**
 * Vitest manual mock for `@grpc/grpc-js`.
 *
 * Provides minimal stubs so gRPC adapter unit tests run without a real
 * gRPC runtime.
 */

import { vi } from 'vitest';
import { EventEmitter } from 'node:events';

// ─── Mock credentials ─────────────────────────────────────────────────────────

export const ServerCredentials = {
  createInsecure: vi.fn(() => ({ _type: 'insecure-server-credentials' })),
  createSsl: vi.fn(() => ({ _type: 'ssl-server-credentials' })),
};

export const credentials = {
  createInsecure: vi.fn(() => ({ _type: 'insecure-credentials' })),
  createSsl: vi.fn(() => ({ _type: 'ssl-credentials' })),
};

// ─── Mock Metadata ────────────────────────────────────────────────────────────

export class Metadata {
  private readonly _entries = new Map<string, string>();
  add(key: string, value: string): void { this._entries.set(key, value); }
  get(key: string): string[] { return this._entries.has(key) ? [this._entries.get(key)!] : []; }
}

// ─── Mock Server ──────────────────────────────────────────────────────────────

export class Server extends EventEmitter {
  addService = vi.fn();
  bindAsync = vi.fn(
    (_address: string, _creds: unknown, cb: (err: null, port: number) => void) => {
      setImmediate(() => cb(null, 50051));
    },
  );
  tryShutdown = vi.fn((cb?: (err?: Error) => void) => {
    if (cb) setImmediate(() => cb());
  });
}

// ─── Mock makeGenericClientConstructor ────────────────────────────────────────

/** Minimal client stub returned by makeGenericClientConstructor (plain class avoids TS4023 on export). */
class MockClient {
  close = vi.fn();
  invoke = vi.fn(
    (
      _req: unknown,
      _meta: unknown,
      _opts: unknown,
      cb: (err: null, res: { result: string; error: string }) => void,
    ) => {
      setImmediate(() => cb(null, { result: '"ok"', error: '' }));
    },
  );
}

export const makeGenericClientConstructor = vi.fn(
  (): new (_address: string, _creds: unknown) => MockClient =>
    class extends MockClient {
      constructor(_address: string, _creds: unknown) {
        super();
      }
    },
);

// ─── Re-export types needed by the adapter ────────────────────────────────────

export type ServiceDefinition = Record<string, unknown>;
export type UntypedServiceImplementation = Record<string, unknown>;
export type ServerCredentials = { _type: string };
export type ChannelCredentials = { _type: string };
export type ServiceError = Error & { code: number };
export type ServerUnaryCall<Req, Res> = {
  request: Req;
  metadata: Metadata;
  sendMetadata: (m: Metadata) => void;
} & EventEmitter;
export type sendUnaryData<Res> = (err: null | ServiceError, response: Res) => void;
export type ClientUnaryCall = EventEmitter;
export type CallOptions = { deadline?: Date };
export type Client = MockClient;
