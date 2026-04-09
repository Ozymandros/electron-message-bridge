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

import { PluginConflictError } from './errors.js';
export { PluginConflictError } from './errors.js';
import {
  negotiate,
  isNegotiablePlugin,
} from './negotiation.js';
import type {
  AdapterManifest,
  CapabilityRequirements,
  NegotiationResult,
} from './negotiation.js';
export type {
  AdapterManifest,
  CapabilityRequirements,
  NegotiationResult,
  NegotiablePlugin,
} from './negotiation.js';
export {
  negotiate,
  isNegotiablePlugin,
  PROTOCOL_VERSION,
} from './negotiation.js';

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

  /**
   * Minimum capability requirements enforced during the pre-`init` negotiation
   * handshake.
   *
   * Plugins that implement {@link NegotiablePlugin} (`getManifest()`) will have
   * their manifests compared against these requirements before `init()` runs.
   * Plugins that do not implement `NegotiablePlugin` are unaffected.
   *
   * Hard mismatches (protocol version, required binary/streaming) are logged as
   * warnings. The plugin's `init()` hook still runs — the host never silently
   * skips a plugin. Use {@link PluginHost.getNegotiationResult} to inspect the
   * outcome and react in your own code.
   *
   * @example
   * ```ts
   * const host = new PluginHost({
   *   requirements: {
   *     minProtocolVersion: 1,
   *     requiresBinary: true,
   *     minPayloadBytes: 4 * 1024 * 1024, // 4 MB
   *   },
   * });
   * ```
   */
  requirements?: CapabilityRequirements;
}

/** The four lifecycle hook names. */
export type PluginHook = 'init' | 'start' | 'stop' | 'dispose';

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
  private readonly requirements: CapabilityRequirements;
  private readonly negotiationResults = new Map<
    string,
    NegotiationResult
  >();

  constructor(options: PluginHostOptions = {}) {
    this.logger = options.logger ?? console;
    this.requirements = options.requirements ?? {};
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
   * Returns the {@link NegotiationResult} for the named plugin, or `undefined`
   * if the plugin did not implement {@link NegotiablePlugin} or has not yet
   * been through the `init()` negotiation phase.
   *
   * @example
   * ```ts
   * await host.init();
   * const result = host.getNegotiationResult('assemblyscript:math');
   * if (result && !result.accepted) {
   *   console.error('Adapter capability mismatch:', result.rejections);
   * }
   * ```
   */
  getNegotiationResult(pluginName: string): NegotiationResult | undefined {
    return this.negotiationResults.get(pluginName);
  }

  /**
   * Returns a snapshot of all negotiation results keyed by plugin name.
   * Only plugins that implement {@link NegotiablePlugin} appear in this map.
   */
  getAllNegotiationResults(): ReadonlyMap<string, NegotiationResult> {
    return new Map(this.negotiationResults);
  }

  /**
   * Calls `init` on all plugins in registration order.
   *
   * Before running `init` hooks, the host performs the capability negotiation
   * handshake for every plugin that implements {@link NegotiablePlugin}
   * (`getManifest()`). Results are stored and accessible via
   * {@link getNegotiationResult}. Negotiation failures are logged as warnings
   * but do not prevent `init()` from running — the caller decides how to react.
   *
   * Errors from individual `init` hooks are isolated: a failing plugin does not
   * prevent others from initialising.
   */
  async init(): Promise<void> {
    await this.runNegotiation();
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

  /**
   * Runs the capability negotiation handshake for all plugins that implement
   * {@link NegotiablePlugin}. Results are stored in `this.negotiationResults`.
   *
   * This is deliberately non-throwing: if `getManifest()` itself throws, the
   * error is caught, logged, and execution continues for the remaining plugins.
   */
  private async runNegotiation(): Promise<void> {
    for (const plugin of this.plugins) {
      if (!isNegotiablePlugin(plugin)) continue;

      let manifest: AdapterManifest;
      try {
        manifest = await plugin.getManifest();
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `[electron-ipc-helper] Plugin "${plugin.name}" getManifest() threw: ${e.message}`,
        );
        continue;
      }

      const result = negotiate(manifest, this.requirements);
      this.negotiationResults.set(plugin.name, result);

      if (!result.accepted) {
        this.logger.warn(
          `[electron-ipc-helper] Plugin "${plugin.name}" failed capability negotiation:`,
          result.rejections.join(' | '),
        );
      }

      for (const warning of result.warnings) {
        this.logger.warn(`[electron-ipc-helper] [negotiate:${plugin.name}] ${warning}`);
      }

      if (result.accepted && result.warnings.length === 0) {
        this.logger.log(
          `[electron-ipc-helper] Plugin "${plugin.name}" negotiation accepted ` +
          `(protocol v${result.effectiveCapabilities.protocolVersion}).`,
        );
      }
    }
  }

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
