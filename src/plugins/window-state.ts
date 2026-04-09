/**
 * @module plugins/window-state
 *
 * Reference plugin: Window State Persistence.
 *
 * Saves and restores a `BrowserWindow`'s bounds (x, y, width, height) and
 * maximized state across app launches using Electron's `app.getPath('userData')`.
 *
 * ## Usage
 *
 * ```ts
 * import { app, BrowserWindow } from 'electron';
 * import { PluginHost } from 'electron-ipc-helper/plugins';
 * import { WindowStatePlugin } from 'electron-ipc-helper/plugins/window-state';
 *
 * const host = new PluginHost();
 * const windowState = new WindowStatePlugin({ key: 'mainWindow' });
 * host.register(windowState);
 *
 * await host.init();
 *
 * const win = new BrowserWindow({
 *   ...windowState.getBounds(),
 *   webPreferences: { contextIsolation: true },
 * });
 *
 * windowState.attach(win);
 * await host.start();
 * ```
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin, PluginContext } from '../plugins.js';

/** Saved window state persisted to disk. */
export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

/** Options for `WindowStatePlugin`. */
export interface WindowStatePluginOptions {
  /**
   * Unique key identifying this window's state file.
   * Multiple windows can use separate instances with different keys.
   */
  key: string;

  /**
   * Default window bounds used when no saved state exists.
   */
  defaultBounds?: { width: number; height: number };

  /**
   * Directory where state files are stored.
   * Defaults to `app.getPath('userData')` when available, otherwise the
   * current working directory (useful in tests).
   */
  stateDir?: string;

  /**
   * Minimum debounce interval (ms) between disk writes on resize/move events.
   * @default 300
   */
  saveDebounceMs?: number;
}

/** Minimal BrowserWindow interface required by this plugin. */
export interface AttachableWindow {
  getBounds(): { x: number; y: number; width: number; height: number };
  isMaximized(): boolean;
  on(event: 'resize' | 'move' | 'close', listener: () => void): this;
  removeListener(event: 'resize' | 'move' | 'close', listener: () => void): this;
}

// ─── Capability declaration ───────────────────────────────────────────────────

export interface WindowStateCapabilities {
  windowState: true;
}

// ─── Plugin implementation ────────────────────────────────────────────────────

/**
 * Persists and restores window bounds across app launches.
 *
 * This is a **reference plugin** — it demonstrates the plugin contract and is
 * suitable for production use in simple cases. For advanced use cases
 * (multiple monitors, DPI changes) consider extending this class.
 */
export class WindowStatePlugin implements Plugin<WindowStateCapabilities> {
  readonly name = 'window-state';
  readonly capabilities: WindowStateCapabilities = { windowState: true };

  private readonly key: string;
  private readonly defaultBounds: { width: number; height: number };
  private readonly saveDebounceMs: number;
  private stateDir: string;
  private state: WindowState;
  private window: AttachableWindow | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly boundSave: () => void;
  private readonly boundOnClose: () => void;
  private ctx: PluginContext | null = null;

  constructor(options: WindowStatePluginOptions) {
    this.key = options.key;
    this.defaultBounds = options.defaultBounds ?? { width: 1200, height: 800 };
    this.saveDebounceMs = options.saveDebounceMs ?? 300;
    this.stateDir = options.stateDir ?? process.cwd();
    this.state = { ...this.defaultBounds };
    this.boundSave = this.scheduleSave.bind(this);
    this.boundOnClose = this.saveNow.bind(this);
  }

  async init(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    // Attempt to resolve userData path via electron app module
    try {
      // Dynamic import to avoid hard dependency when running in tests
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron') as { app: { getPath(name: string): string } };
      if (!this.stateDir || this.stateDir === process.cwd()) {
        this.stateDir = app.getPath('userData');
      }
    } catch {
      ctx.logger.warn('Could not resolve userData path; using stateDir:', this.stateDir);
    }

    this.state = this.loadState();
    ctx.logger.log(`Loaded window state for key "${this.key}":`, JSON.stringify(this.state));
  }

  async start(_ctx: PluginContext): Promise<void> {
    // Nothing to do here — attachment happens via attach()
  }

  async stop(_ctx: PluginContext): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.window) {
      this.saveNow();
    }
  }

  async dispose(_ctx: PluginContext): Promise<void> {
    this.detach();
    this.window = null;
    this.ctx = null;
  }

  /**
   * Returns the saved window bounds (or defaults if no state was found).
   *
   * Call this before creating the `BrowserWindow` to restore its last position:
   * ```ts
   * const win = new BrowserWindow({ ...windowState.getBounds(), ... });
   * ```
   */
  getBounds(): WindowState {
    return { ...this.state };
  }

  /**
   * Attaches this plugin to a `BrowserWindow` (or compatible object).
   *
   * Listens to `resize`, `move`, and `close` events to save state automatically.
   * Must be called after `init()` and before `start()`.
   */
  attach(win: AttachableWindow): void {
    if (this.window) {
      this.detach();
    }
    this.window = win;
    win.on('resize', this.boundSave);
    win.on('move', this.boundSave);
    win.on('close', this.boundOnClose);
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private detach(): void {
    if (!this.window) return;
    this.window.removeListener('resize', this.boundSave);
    this.window.removeListener('move', this.boundSave);
    this.window.removeListener('close', this.boundOnClose);
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, this.saveDebounceMs);
  }

  private saveNow(): void {
    if (!this.window) return;
    try {
      const bounds = this.window.getBounds();
      const isMaximized = this.window.isMaximized();
      this.state = { ...bounds, isMaximized };
      this.persistState(this.state);
      this.ctx?.logger.log(`Saved window state for key "${this.key}"`);
    } catch (err) {
      this.ctx?.logger.error('Failed to save window state:', err);
    }
  }

  private stateFilePath(): string {
    return join(this.stateDir, `window-state-${this.key}.json`);
  }

  private loadState(): WindowState {
    try {
      const raw = readFileSync(this.stateFilePath(), 'utf-8');
      const parsed = JSON.parse(raw) as WindowState;
      if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
        return parsed;
      }
    } catch {
      // No saved state or parse error — use defaults
    }
    return { ...this.defaultBounds };
  }

  private persistState(state: WindowState): void {
    try {
      mkdirSync(this.stateDir, { recursive: true });
      writeFileSync(this.stateFilePath(), JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      this.ctx?.logger.error('Failed to persist window state:', err);
    }
  }
}
