/**
 * @module plugins
 *
 * Plugin system for electron-ipc-helper.
 *
 * Plugins are self-contained, lifecycle-managed units that extend an Electron
 * app's main-process capabilities. Each plugin:
 *
 * - Declares a name and optional typed **capabilities**.
 * - Implements optional lifecycle hooks: `init → start → stop → dispose`.
 * - Receives a scoped `PluginContext` with its name and a logger.
 *
 * ## Quick start
 *
 * ```ts
 * import { PluginHost } from 'electron-ipc-helper/plugins';
 * import { WindowStatePlugin } from 'electron-ipc-helper/plugins/window-state';
 *
 * const host = new PluginHost();
 * host.register(new WindowStatePlugin({ key: 'mainWindow' }));
 *
 * // In app ready:
 * await host.init();
 * await host.start();
 *
 * // On before-quit:
 * await host.stop();
 * await host.dispose();
 * ```
 *
 * ## Writing a plugin
 *
 * ```ts
 * import type { Plugin, PluginContext } from 'electron-ipc-helper/plugins';
 *
 * export class MyPlugin implements Plugin<{ myFeature: true }> {
 *   readonly name = 'my-plugin';
 *   readonly capabilities = { myFeature: true as const };
 *
 *   async init(ctx: PluginContext): Promise<void> {
 *     ctx.logger.log('Initializing my plugin');
 *   }
 *
 *   async start(ctx: PluginContext): Promise<void> {
 *     ctx.logger.log('Starting my plugin');
 *   }
 *
 *   async stop(ctx: PluginContext): Promise<void> {
 *     ctx.logger.log('Stopping my plugin');
 *   }
 * }
 * ```
 */

// ─── Public interfaces ────────────────────────────────────────────────────────

/**
 * Context object injected into every plugin lifecycle hook.
 *
 * Provides the plugin's own name and a scoped logger so each plugin's output
 * can be identified and filtered independently.
 */
export interface PluginContext {
  /** The name this plugin was registered under. */
  readonly name: string;
  /** Scoped logger. Prefixes messages with `[plugin:name]`. */
  readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
}

/**
 * The contract that all plugins must satisfy.
 *
 * Only `name` is required. All lifecycle hooks and the `capabilities` record
 * are optional. A plugin may implement any subset of hooks.
 *
 * ### Lifecycle order
 * ```
 * register → init → start → stop → dispose
 * ```
 *
 * `stop` and `dispose` are called in **reverse registration order** to mirror
 * typical dependency teardown (last-registered, first-stopped).
 *
 * @typeParam Caps - A record of capability keys and their associated values.
 *   Used to detect conflicts when multiple plugins claim the same capability.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Plugin<Caps extends Record<string, any> = Record<string, never>> {
  /** Unique plugin name. Used in log messages and conflict detection. */
  readonly name: string;
  /** Optional semver string for documentation and debugging purposes. */
  readonly version?: string;
  /**
   * Typed capabilities this plugin provides.
   * Keys must be unique across all registered plugins — the host enforces this
   * at registration time.
   */
  readonly capabilities?: Caps;

  /** Called once before `start`. Good for one-time setup (reading config, etc.). */
  init?(context: PluginContext): void | Promise<void>;
  /** Called after `init`. Good for starting background work, registering listeners. */
  start?(context: PluginContext): void | Promise<void>;
  /** Called on graceful shutdown. Reverse registration order. */
  stop?(context: PluginContext): void | Promise<void>;
  /** Called after `stop` for final cleanup (close handles, flush buffers). Reverse order. */
  dispose?(context: PluginContext): void | Promise<void>;
}

/**
 * Options for configuring `PluginHost`.
 */
export interface PluginHostOptions {
  /**
   * Logger for host-level messages (plugin registration, lifecycle errors).
   * Defaults to `console`.
   */
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;

  /**
   * Global error handler called whenever a plugin lifecycle hook throws.
   * By default, errors are logged to `logger.error` and execution continues
   * (other plugins are not affected).
   *
   * @param error  - The error thrown by the plugin hook.
   * @param plugin - The name of the plugin that threw.
   * @param hook   - The lifecycle hook that threw (`init`, `start`, `stop`, `dispose`).
   */
  onError?: (error: Error, plugin: string, hook: PluginHook) => void;
}

/** The four lifecycle hook names. */
export type PluginHook = 'init' | 'start' | 'stop' | 'dispose';

/**
 * Error thrown when two plugins declare the same capability key.
 */
export class PluginConflictError extends Error {
  constructor(
    public readonly capability: string,
    public readonly existing: string,
    public readonly incoming: string,
  ) {
    super(
      `[electron-ipc-helper] Plugin "${incoming}" declares capability "${capability}" ` +
      `which is already registered by plugin "${existing}". ` +
      `Remove one of the conflicting plugins.`,
    );
    this.name = 'PluginConflictError';
  }
}

// ─── PluginHost ───────────────────────────────────────────────────────────────

/**
 * Manages a collection of plugins through their full lifecycle.
 *
 * ## Usage
 *
 * ```ts
 * const host = new PluginHost({ logger: console });
 *
 * host.register(new WindowStatePlugin());
 * host.register(new DiagnosticsPlugin());
 *
 * // app.whenReady():
 * await host.init();
 * await host.start();
 *
 * // app.on('before-quit'):
 * await host.stop();
 * await host.dispose();
 * ```
 *
 * ## Error isolation
 *
 * Each plugin hook is called in a try/catch. If a plugin throws, `onError` is
 * called and execution continues for the remaining plugins. This ensures that a
 * single broken plugin cannot bring down the entire application.
 */
export class PluginHost {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly plugins: Plugin<any>[] = [];
  private readonly capabilityOwners = new Map<string, string>();
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly onError: NonNullable<PluginHostOptions['onError']>;

  constructor(options: PluginHostOptions = {}) {
    this.logger = options.logger ?? console;
    this.onError = options.onError ?? ((error, plugin, hook) => {
      this.logger.error(
        `[electron-ipc-helper] Plugin "${plugin}" threw during "${hook}": ${error.message}`,
        error,
      );
    });
  }

  /**
   * Registers a plugin with this host.
   *
   * Throws `PluginConflictError` synchronously if the plugin's capabilities
   * overlap with any already-registered plugin.
   *
   * @throws {PluginConflictError}
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(plugin: Plugin<any>): this {
    // Conflict detection
    if (plugin.capabilities) {
      for (const key of Object.keys(plugin.capabilities)) {
        const existing = this.capabilityOwners.get(key);
        if (existing !== undefined) {
          throw new PluginConflictError(key, existing, plugin.name);
        }
      }
      for (const key of Object.keys(plugin.capabilities)) {
        this.capabilityOwners.set(key, plugin.name);
      }
    }

    this.plugins.push(plugin);
    this.logger.log(`[electron-ipc-helper] Plugin registered: "${plugin.name}"`);
    return this;
  }

  /**
   * Returns a copy of the currently registered plugin list.
   * Useful for introspection and testing.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPlugins(): ReadonlyArray<Plugin<any>> {
    return [...this.plugins];
  }

  /**
   * Returns `true` if any registered plugin declares the given capability key.
   */
  hasCapability(key: string): boolean {
    return this.capabilityOwners.has(key);
  }

  /**
   * Calls `init` on all plugins in registration order.
   *
   * Errors are isolated: a failing plugin's `init` does not prevent others
   * from initializing.
   */
  async init(): Promise<void> {
    await this.runHook('init', this.plugins);
  }

  /**
   * Calls `start` on all plugins in registration order.
   */
  async start(): Promise<void> {
    await this.runHook('start', this.plugins);
  }

  /**
   * Calls `stop` on all plugins in **reverse** registration order.
   */
  async stop(): Promise<void> {
    await this.runHook('stop', [...this.plugins].reverse());
  }

  /**
   * Calls `dispose` on all plugins in **reverse** registration order.
   */
  async dispose(): Promise<void> {
    await this.runHook('dispose', [...this.plugins].reverse());
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private makeContext(plugin: Plugin): PluginContext {
    const name = plugin.name;
    const prefix = `[plugin:${name}]`;
    return {
      name,
      logger: {
        log:   (...args: unknown[]) => this.logger.log(prefix, ...args),
        warn:  (...args: unknown[]) => this.logger.warn(prefix, ...args),
        error: (...args: unknown[]) => this.logger.error(prefix, ...args),
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async runHook(hook: PluginHook, plugins: Plugin<any>[]): Promise<void> {
    for (const plugin of plugins) {
      const hookFn = plugin[hook];
      if (typeof hookFn !== 'function') continue;

      const ctx = this.makeContext(plugin);
      try {
        await hookFn.call(plugin, ctx);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.onError(error, plugin.name, hook);
      }
    }
  }
}
