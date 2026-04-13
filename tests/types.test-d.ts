/**
 * Type-level tests for electron-message-bridge.
 *
 * These tests run via `vitest --typecheck` and verify that the type utilities
 * produce the correct TypeScript types — no runtime assertions needed.
 */

import { beforeEach, describe, it, expectTypeOf } from 'vitest';
import { defineIpcApi, defineIpcEvents } from '../src/main.js';
import { resetMocks } from './__mocks__/electron.js';
import type {
  ExtractRendererApi,
  ExtractRendererEvents,
  IpcApi,
  IpcEvents,
  RendererApi,
  RendererEvents,
} from '../src/types.js';

// ─── defineIpcApi type inference ─────────────────────────────────────────────

beforeEach(() => {
  resetMocks();
});

describe('defineIpcApi — type inference', () => {
  it('infers simple return types correctly', () => {
    const api = defineIpcApi({
      getUser: async (_id: string) => ({ id: _id, name: 'Alice' }),
    });

    type Api = ExtractRendererApi<typeof api>;
    type GetUserReturn = ReturnType<Api['getUser']>;

    expectTypeOf<GetUserReturn>().toEqualTypeOf<Promise<{ id: string; name: string }>>();
  });

  it('infers parameter types correctly', () => {
    const api = defineIpcApi({
      saveSettings: async (_theme: 'dark' | 'light', _fontSize: number) => true,
    });

    type Api = ExtractRendererApi<typeof api>;
    type Params = Parameters<Api['saveSettings']>;

    expectTypeOf<Params>().toEqualTypeOf<['dark' | 'light', number]>();
  });

  it('infers const return types (literal types)', () => {
    const api = defineIpcApi({
      ping: async () => 'pong' as const,
    });

    type Api = ExtractRendererApi<typeof api>;
    type PingReturn = Awaited<ReturnType<Api['ping']>>;

    expectTypeOf<PingReturn>().toEqualTypeOf<'pong'>();
  });

  it('renderer API mirrors all declared channels', () => {
    const api = defineIpcApi({
      ping:       async () => 'pong' as const,
      getCount:   async () => 42,
      deleteUser: async (_id: string) => void 0 as void,
    });

    type Api = ExtractRendererApi<typeof api>;

    expectTypeOf<Api>().toMatchTypeOf<{
      ping:       () => Promise<'pong'>;
      getCount:   () => Promise<number>;
      deleteUser: (id: string) => Promise<void>;
    }>();
  });

  it('IpcApi handle carries the correct phantom type', () => {
    const api = defineIpcApi({ ping: async () => 'pong' as const });
    expectTypeOf(api).toMatchTypeOf<IpcApi<{ ping: () => Promise<'pong'> }>>();
  });

  it('RendererApi maps async functions to async functions', () => {
    type Handlers = { getData: (id: string) => Promise<number[]> };
    type Renderer = RendererApi<Handlers>;

    expectTypeOf<Renderer['getData']>().toEqualTypeOf<(id: string) => Promise<number[]>>();
  });
});

// ─── defineIpcEvents type inference ──────────────────────────────────────────

describe('defineIpcEvents — type inference', () => {
  it('infers event parameter types correctly', () => {
    const events = defineIpcEvents({
      backendReady: (_code: number) => {},
    });

    type Events = ExtractRendererEvents<typeof events>;
    // backendReady should be a subscription fn: (cb: (code: number) => void) => () => void
    type SubscribeFn = Events['backendReady'];

    expectTypeOf<SubscribeFn>().toEqualTypeOf<
      (callback: (code: number) => void) => () => void
    >();
  });

  it('infers multi-arg event parameter types', () => {
    const events = defineIpcEvents({
      backendCrashed: (_code: number | null, _signal: string | null) => {},
    });

    type Events = ExtractRendererEvents<typeof events>;
    type SubscribeFn = Events['backendCrashed'];

    expectTypeOf<SubscribeFn>().toEqualTypeOf<
      (callback: (code: number | null, signal: string | null) => void) => () => void
    >();
  });

  it('infers zero-arg event parameter types', () => {
    const events = defineIpcEvents({ ping: () => {} });

    type Events = ExtractRendererEvents<typeof events>;
    type SubscribeFn = Events['ping'];

    expectTypeOf<SubscribeFn>().toEqualTypeOf<
      (callback: () => void) => () => void
    >();
  });

  it('IpcEvents handle carries the correct phantom type', () => {
    const events = defineIpcEvents({ ready: (_code: number) => {} });
    expectTypeOf(events).toMatchTypeOf<IpcEvents<{ ready: (code: number) => void }>>();
  });

  it('RendererEvents maps event descriptors to subscription functions', () => {
    type Schema = { folderSelected: (path: string) => void };
    type Renderer = RendererEvents<Schema>;

    expectTypeOf<Renderer['folderSelected']>().toEqualTypeOf<
      (callback: (path: string) => void) => () => void
    >();
  });
});

// ─── ExtractRendererApi utility type ─────────────────────────────────────────

describe('ExtractRendererApi utility', () => {
  it('extracts the renderer API from an IpcApi type-level handle', () => {
    const api = defineIpcApi({ greet: async (name: string) => `Hello ${name}` });

    type Extracted = ExtractRendererApi<typeof api>;
    type GreetReturn = Awaited<ReturnType<Extracted['greet']>>;

    expectTypeOf<GreetReturn>().toEqualTypeOf<string>();
  });

  it('returns never for non-IpcApi input', () => {
    type Extracted = ExtractRendererApi<string>;
    expectTypeOf<Extracted>().toEqualTypeOf<never>();
  });
});

// ─── ExtractRendererEvents utility type ──────────────────────────────────────

describe('ExtractRendererEvents utility', () => {
  it('extracts the renderer events from an IpcEvents type-level handle', () => {
    const events = defineIpcEvents({ notified: (_msg: string) => {} });

    type Extracted = ExtractRendererEvents<typeof events>;
    type NotifiedFn = Extracted['notified'];

    expectTypeOf<NotifiedFn>().toEqualTypeOf<
      (callback: (msg: string) => void) => () => void
    >();
  });

  it('returns never for non-IpcEvents input', () => {
    type Extracted = ExtractRendererEvents<number>;
    expectTypeOf<Extracted>().toEqualTypeOf<never>();
  });
});
