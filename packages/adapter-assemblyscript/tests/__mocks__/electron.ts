/**
 * Vitest mock for the 'electron' module.
 *
 * Simulates ipcMain, ipcRenderer, contextBridge, dialog, shell, and Menu with
 * enough fidelity to exercise electron-ipc-helper's logic end-to-end without a
 * real Electron runtime.
 *
 * Registered handlers are stored in a shared in-memory map so that
 * ipcRenderer.invoke can call them directly, matching the actual round-trip
 * behaviour of Electron IPC.
 */

import { vi } from 'vitest';

// ─── Shared state ─────────────────────────────────────────────────────────────

/** Registry of handlers registered via ipcMain.handle. Keyed by channel name. */
const _handlers = new Map<string, (...args: unknown[]) => unknown>();

/** Registry of APIs exposed via contextBridge.exposeInMainWorld. Keyed by window property. */
const _exposed = new Map<string, Record<string, unknown>>();

/** Registry of listeners registered via ipcRenderer.on. Keyed by channel name. */
const _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

// ─── ipcMain ──────────────────────────────────────────────────────────────────

export const ipcMain = {
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    if (_handlers.has(channel)) {
      throw new Error(
        `[mock/electron] Attempted to register duplicate handler for channel "${channel}".`,
      );
    }
    _handlers.set(channel, handler);
  }),

  removeHandler: vi.fn((channel: string) => {
    _handlers.delete(channel);
  }),

  /** @internal For test assertions only — not part of the real Electron API. */
  _handlers,
};

// ─── dialog ───────────────────────────────────────────────────────────────────

export const dialog = {
  showOpenDialog: vi.fn(async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({
    canceled: false,
    filePaths: ['C:/tmp/default.txt'],
  })),

  showSaveDialog: vi.fn(async (): Promise<{ canceled: boolean; filePath?: string }> => ({
    canceled: false,
    filePath: 'C:/tmp/saved.txt',
  })),

  showMessageBox: vi.fn(async (): Promise<{ response: number; checkboxChecked: boolean }> => ({
    response: 0,
    checkboxChecked: false,
  })),
};

// ─── shell ────────────────────────────────────────────────────────────────────

export const shell = {
  openExternal: vi.fn(async () => {}),
  openPath: vi.fn(async () => ''),
};

// ─── Menu ─────────────────────────────────────────────────────────────────────

export const Menu = {
  buildFromTemplate: vi.fn((template: unknown) => ({ template })),
  setApplicationMenu: vi.fn((_menu: unknown) => {}),
};

// ─── ipcRenderer ──────────────────────────────────────────────────────────────

export const ipcRenderer = {
  invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
    const handler = _handlers.get(channel);
    if (!handler) {
      throw new Error(
        `[mock/electron] No handler registered for channel "${channel}".`,
      );
    }
    // Electron passes a synthetic IpcMainInvokeEvent as the first arg.
    // Our library strips it before forwarding to user handlers.
    return handler({ sender: null }, ...args);
  }),

  on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    if (!_listeners.has(channel)) _listeners.set(channel, new Set());
    _listeners.get(channel)!.add(listener);
  }),

  removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    _listeners.get(channel)?.delete(listener);
  }),

  /**
   * @internal Simulates a push event from the main process to the renderer.
   * Calls all listeners registered for the channel with the provided args.
   * Matches the real Electron wire format where args include the IpcRendererEvent
   * as the first argument (e.g. _emit('test', { sender: null }, ...userArgs)).
   */
  _emit(channel: string, ...args: unknown[]): void {
    for (const listener of _listeners.get(channel) ?? []) {
      listener(...args);
    }
  },

  /** @internal Exposed listeners registry for assertion and emit testing. */
  _listeners,
};

// ─── contextBridge ────────────────────────────────────────────────────────────

export const contextBridge = {
  exposeInMainWorld: vi.fn((key: string, api: Record<string, unknown>) => {
    _exposed.set(key, api);
  }),

  /** @internal For test assertions only — not part of the real Electron API. */
  _exposed,
};

// ─── Test helper ─────────────────────────────────────────────────────────────

/**
 * Resets all mock state and call history.
 * Call this in a beforeEach hook to keep tests fully isolated.
 */
export function resetMocks(): void {
  _handlers.clear();
  _exposed.clear();
  _listeners.clear();
  vi.clearAllMocks();
}
