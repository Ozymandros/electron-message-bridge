/**
 * @module plugins/updater
 *
 * Reference plugin: Auto-updater Facade.
 *
 * Provides a typed, lifecycle-managed facade over any auto-update engine that
 * satisfies the `UpdaterEngine` interface. Works out of the box with
 * `electron-updater` (from `electron-builder`) or any compatible engine.
 *
 * ## Usage with electron-updater
 *
 * ```ts
 * import { autoUpdater } from 'electron-updater';
 * import { PluginHost } from 'electron-ipc-helper/plugins';
 * import { UpdaterPlugin } from 'electron-ipc-helper/plugins/updater';
 *
 * const host = new PluginHost();
 * host.register(new UpdaterPlugin({
 *   engine: autoUpdater,
 *   checkIntervalMs: 4 * 60 * 60 * 1000, // every 4 hours
 *   onUpdateAvailable: (info) => {
 *     mainWindow.webContents.send('update-available', info);
 *   },
 * }));
 *
 * await host.init();
 * await host.start();
 * ```
 *
 * ## Custom engine
 *
 * Any object satisfying `UpdaterEngine` can be used:
 *
 * ```ts
 * const host = new PluginHost();
 * host.register(new UpdaterPlugin({
 *   engine: myCustomUpdater,
 * }));
 * ```
 */

import type { Plugin, PluginContext } from '../plugins.js';

// ─── Engine interface ─────────────────────────────────────────────────────────

/** Minimal interface satisfied by `electron-updater`'s `autoUpdater`. */
export interface UpdaterEngine {
  checkForUpdatesAndNotify?(): Promise<unknown>;
  checkForUpdates?(): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): this;
  removeListener(event: string, listener: (...args: unknown[]) => void): this;
}

/** Shape of the update-available info object (matches electron-updater). */
export interface UpdateInfo {
  version: string;
  releaseNotes?: string | null;
  releaseName?: string | null;
  releaseDate?: string;
  [key: string]: unknown;
}

/** Shape of download progress info. */
export interface DownloadProgressInfo {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

// ─── Options ──────────────────────────────────────────────────────────────────

/** Options for `UpdaterPlugin`. */
export interface UpdaterPluginOptions {
  /** The update engine to delegate to. */
  engine: UpdaterEngine;

  /**
   * How often (ms) to check for updates after start.
   * Set to 0 to disable automatic checks.
   * @default 0
   */
  checkIntervalMs?: number;

  /**
   * Called when an update is available. Use this to notify the renderer.
   */
  onUpdateAvailable?: (info: UpdateInfo) => void;

  /**
   * Called when the update has been downloaded and is ready to install.
   */
  onUpdateDownloaded?: (info: UpdateInfo) => void;

  /**
   * Called on download progress.
   */
  onDownloadProgress?: (progress: DownloadProgressInfo) => void;

  /**
   * Called when an update check finds no new version.
   */
  onUpdateNotAvailable?: () => void;

  /**
   * Called when the update engine emits an error.
   */
  onError?: (error: Error) => void;
}

// ─── Capability declaration ───────────────────────────────────────────────────

export interface UpdaterCapabilities {
  updater: true;
}

// ─── Plugin implementation ────────────────────────────────────────────────────

/**
 * Lifecycle-managed facade over any auto-update engine.
 *
 * This is a **reference plugin** — it is intentionally thin. The facade decouples
 * your app code from the concrete updater library, making testing easy (inject a
 * mock engine in tests).
 */
export class UpdaterPlugin implements Plugin<UpdaterCapabilities> {
  readonly name = 'updater';
  readonly capabilities: UpdaterCapabilities = { updater: true };

  private readonly opts: UpdaterPluginOptions;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private ctx: PluginContext | null = null;

  // Bound listeners for clean removal
  private readonly onUpdateAvailableBound: (...args: unknown[]) => void;
  private readonly onUpdateDownloadedBound: (...args: unknown[]) => void;
  private readonly onDownloadProgressBound: (...args: unknown[]) => void;
  private readonly onUpdateNotAvailableBound: (...args: unknown[]) => void;
  private readonly onErrorBound: (...args: unknown[]) => void;

  constructor(options: UpdaterPluginOptions) {
    this.opts = options;

    this.onUpdateAvailableBound = (...args: unknown[]) => {
      const info = args[0] as UpdateInfo;
      this.ctx?.logger.log('Update available:', info.version);
      this.opts.onUpdateAvailable?.(info);
    };

    this.onUpdateDownloadedBound = (...args: unknown[]) => {
      const info = args[0] as UpdateInfo;
      this.ctx?.logger.log('Update downloaded:', info.version);
      this.opts.onUpdateDownloaded?.(info);
    };

    this.onDownloadProgressBound = (...args: unknown[]) => {
      const progress = args[0] as DownloadProgressInfo;
      this.opts.onDownloadProgress?.(progress);
    };

    this.onUpdateNotAvailableBound = () => {
      this.ctx?.logger.log('No update available');
      this.opts.onUpdateNotAvailable?.();
    };

    this.onErrorBound = (...args: unknown[]) => {
      const err = args[0] instanceof Error ? args[0] : new Error(String(args[0]));
      this.ctx?.logger.error('Updater error:', err.message);
      this.opts.onError?.(err);
    };
  }

  init(ctx: PluginContext): void {
    this.ctx = ctx;
    ctx.logger.log('Updater facade initialized');
  }

  start(ctx: PluginContext): void {
    const engine = this.opts.engine;

    engine.on('update-available', this.onUpdateAvailableBound);
    engine.on('update-downloaded', this.onUpdateDownloadedBound);
    engine.on('download-progress', this.onDownloadProgressBound);
    engine.on('update-not-available', this.onUpdateNotAvailableBound);
    engine.on('error', this.onErrorBound);

    if (this.opts.checkIntervalMs && this.opts.checkIntervalMs > 0) {
      this.checkTimer = setInterval(() => {
        void this.check();
      }, this.opts.checkIntervalMs);
      this.checkTimer.unref?.();
    }

    ctx.logger.log('Updater started');
  }

  async stop(ctx: PluginContext): Promise<void> {
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    const engine = this.opts.engine;
    engine.removeListener('update-available', this.onUpdateAvailableBound);
    engine.removeListener('update-downloaded', this.onUpdateDownloadedBound);
    engine.removeListener('download-progress', this.onDownloadProgressBound);
    engine.removeListener('update-not-available', this.onUpdateNotAvailableBound);
    engine.removeListener('error', this.onErrorBound);

    ctx.logger.log('Updater stopped');
  }

  dispose(_ctx: PluginContext): void {
    this.ctx = null;
  }

  /**
   * Manually trigger an update check.
   *
   * Delegates to `checkForUpdatesAndNotify` if available,
   * otherwise falls back to `checkForUpdates`.
   */
  async check(): Promise<void> {
    const engine = this.opts.engine;
    try {
      if (typeof engine.checkForUpdatesAndNotify === 'function') {
        await engine.checkForUpdatesAndNotify();
      } else if (typeof engine.checkForUpdates === 'function') {
        await engine.checkForUpdates();
      } else {
        this.ctx?.logger.warn('Update engine has no checkForUpdates method');
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.ctx?.logger.error('Update check failed:', error.message);
      this.opts.onError?.(error);
    }
  }
}
