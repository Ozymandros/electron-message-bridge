/**
 * electron-ipc-helper — main process entry point
 *
 * A small, typed, zero-boilerplate Electron IPC helper.
 * Abstracts all IPC setup for the main process, preload, and renderer.
 *
 * ┌──────────────────────────────────┬──────────────────────────────────────┐
 * │  Import path                     │  Use in                              │
 * ├──────────────────────────────────┼──────────────────────────────────────┤
 * │  'electron-ipc-helper'           │  Main process                        │
 * │  'electron-ipc-helper/preload'   │  Preload script                      │
 * └──────────────────────────────────┴──────────────────────────────────────┘
 *
 * @see https://github.com/your-org/electron-ipc-helper
 */

export {
  defineIpcApi,
  defineIpcEvents,
} from './main.js';

export {
  IpcHelperError,
  InvalidPayloadError,
  BridgeTimeoutError,
  MaxRestartsError,
  PluginConflictError,
  ExportMissingError,
  RuntimeMissingError,
  AdapterMissingError,
  TransportError,
  ERR_INVALID_PAYLOAD,
  ERR_BRIDGE_TIMEOUT,
  ERR_MAX_RESTARTS,
  ERR_PLUGIN_CONFLICT,
  ERR_EXPORT_MISSING,
  ERR_RUNTIME_MISSING,
  ERR_ADAPTER_MISSING,
  ERR_TRANSPORT_FAILURE,
} from './errors.js';

export type { IpcHelperErrorCode } from './errors.js';

export {
  isBridgePayload,
  assertBridgePayload,
  withValidation,
  withOutputValidation,
  withBoundary,
} from './boundary.js';

export type {
  JsonPrimitive,
  JsonArray,
  JsonObject,
  JsonValue,
  BridgePayload,
  BridgeSchema,
} from './boundary.js';

export {
  ChildProcessLifecycle,
} from './lifecycle.js';

export type {
  ChildProcessLifecycleEvents,
  ChildProcessLifecycleOptions,
  ProcessExitInfo,
} from './lifecycle.js';

export type {
  ActionDescriptor,
  ActionRegistry,
  ApiHandlers,
  AsyncFn,
  CommandActionDescriptor,
  EmitActionDescriptor,
  EventHandler,
  EventsSchema,
  ExtractRendererApi,
  ExtractRendererEvents,
  IpcApi,
  IpcEvents,
  RendererApi,
  RendererEvents,
  ServiceActionDescriptor,
  WindowTarget,
} from './types.js';
