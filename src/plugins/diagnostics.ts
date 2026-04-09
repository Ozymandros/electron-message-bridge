/**
 * @module plugins/diagnostics
 *
 * Reference plugin: Diagnostics and Tracing.
 *
 * Collects lightweight runtime diagnostics including:
 * - IPC invocation counts per channel
 * - Process memory and CPU usage snapshots
 * - App uptime
 * - A structured crash summary hook
 *
 * ## Usage
 *
 * ```ts
 * import { PluginHost } from 'electron-ipc-helper/plugins';
 * import { DiagnosticsPlugin } from 'electron-ipc-helper/plugins/diagnostics';
 *
 * const diagnostics = new DiagnosticsPlugin({ logIntervalMs: 60_000 });
 * const host = new PluginHost();
 * host.register(diagnostics);
 *
 * await host.init();
 * await host.start();
 *
 * // Later:
 * const snapshot = diagnostics.getSnapshot();
 * ```
 */

import type { Plugin, PluginContext } from '../plugins.js';

/** A single diagnostic snapshot taken at a point in time. */
export interface DiagnosticsSnapshot {
  /** ISO timestamp of this snapshot. */
  timestamp: string;
  /** App uptime in milliseconds since init. */
  uptimeMs: number;
  /** Process memory usage in bytes. */
  memoryUsage: NodeJS.MemoryUsage;
  /** Process CPU time usage. */
  cpuUsage: NodeJS.CpuUsage;
  /** Count of IPC invocations per channel since start. */
  ipcCounts: Record<string, number>;
}

/** Options for `DiagnosticsPlugin`. */
export interface DiagnosticsPluginOptions {
  /**
   * If set, logs a diagnostics snapshot to the plugin logger at this interval (ms).
   * Set to 0 or omit to disable automatic logging.
   * @default 0
   */
  logIntervalMs?: number;

  /**
   * If `true`, logs memory/CPU stats at each interval. Requires `logIntervalMs`.
   * @default false
   */
  includeSystemStats?: boolean;
}

// ─── Capability declaration ───────────────────────────────────────────────────

export interface DiagnosticsCapabilities {
  diagnostics: true;
}

// ─── Plugin implementation ────────────────────────────────────────────────────

/**
 * Collects runtime diagnostics: IPC counts, memory, CPU, uptime.
 *
 * This is a **reference plugin** demonstrating capability declaration and
 * periodic background work with proper cleanup.
 */
export class DiagnosticsPlugin implements Plugin<DiagnosticsCapabilities> {
  readonly name = 'diagnostics';
  readonly capabilities: DiagnosticsCapabilities = { diagnostics: true };

  private readonly options: Required<DiagnosticsPluginOptions>;
  private startedAt = 0;
  private ipcCounts: Record<string, number> = {};
  private logTimer: ReturnType<typeof setInterval> | null = null;
  private ctx: PluginContext | null = null;

  constructor(options: DiagnosticsPluginOptions = {}) {
    this.options = {
      logIntervalMs: options.logIntervalMs ?? 0,
      includeSystemStats: options.includeSystemStats ?? false,
    };
  }

  init(ctx: PluginContext): void {
    this.ctx = ctx;
    this.startedAt = Date.now();
    ctx.logger.log('Diagnostics initialized');
  }

  start(ctx: PluginContext): void {
    if (this.options.logIntervalMs > 0) {
      this.logTimer = setInterval(() => {
        const snap = this.getSnapshot();
        if (this.options.includeSystemStats) {
          ctx.logger.log('Diagnostics snapshot:', JSON.stringify(snap, null, 2));
        } else {
          ctx.logger.log('IPC counts:', JSON.stringify(snap.ipcCounts));
        }
      }, this.options.logIntervalMs);
      this.logTimer.unref?.();
    }
    ctx.logger.log('Diagnostics started');
  }

  stop(ctx: PluginContext): void {
    if (this.logTimer !== null) {
      clearInterval(this.logTimer);
      this.logTimer = null;
    }
    ctx.logger.log('Diagnostics stopped. Final snapshot:', JSON.stringify(this.getSnapshot()));
  }

  dispose(_ctx: PluginContext): void {
    this.ipcCounts = {};
    this.ctx = null;
  }

  /**
   * Increments the invocation count for an IPC channel.
   *
   * Call this from your `defineIpcApi` handlers, or wrap handlers automatically
   * via a middleware pattern in `appkit`.
   *
   * ```ts
   * const api = defineIpcApi({
   *   getUser: async (id: string) => {
   *     diagnostics.recordIpc('getUser');
   *     return db.getUser(id);
   *   },
   * });
   * ```
   */
  recordIpc(channel: string): void {
    this.ipcCounts[channel] = (this.ipcCounts[channel] ?? 0) + 1;
  }

  /**
   * Returns a diagnostic snapshot of the current runtime state.
   */
  getSnapshot(): DiagnosticsSnapshot {
    return {
      timestamp: new Date().toISOString(),
      uptimeMs: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      ipcCounts: { ...this.ipcCounts },
    };
  }

  /**
   * Resets all IPC counters. Useful between test runs or after flushing metrics.
   */
  resetCounts(): void {
    this.ipcCounts = {};
    this.ctx?.logger.log('IPC counts reset');
  }
}
