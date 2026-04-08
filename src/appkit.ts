/**
 * @module appkit
 *
 * Optional composition helpers that glue IPC core, integrations, preload
 * exposure, and declarative menus into a single setup flow.
 */

import { defineIpcApi, defineIpcEvents } from './main.js';
import {
  exposeApiToRenderer,
  exposeEventsToRenderer,
  exposeValues,
} from './preload.js';
import {
  exposeDialogsToRenderer,
  exposeShellToRenderer,
  registerDialogHandlers,
  registerShellHandlers,
  type IpcRegistration,
} from './integrations.js';
import {
  applyApplicationMenuFromFile,
  type DeclarativeMenuSpec,
  type MenuSpecFormat,
} from './menus.js';
import type { ApiHandlers, EventsSchema, IpcApi, IpcEvents } from './types.js';

export interface MainAppKitOptions<
  TApi extends ApiHandlers = ApiHandlers,
  TEvents extends EventsSchema = EventsSchema,
> {
  apiHandlers?: TApi;
  eventSchema?: TEvents;
  dialogs?: boolean | { channelPrefix?: string };
  shell?: boolean | { channelPrefix?: string };
  menu?: {
    filePath: string;
    format?: MenuSpecFormat;
    encoding?: BufferEncoding;
    onAction?: (actionId: string) => void;
  };
}

export interface MainAppKitResult<
  TApi extends ApiHandlers = ApiHandlers,
  TEvents extends EventsSchema = EventsSchema,
> {
  api?: IpcApi<TApi>;
  events?: IpcEvents<TEvents>;
  menuSpec?: DeclarativeMenuSpec;
  dispose(): void;
}

export interface PreloadAppKitOptions<
  TApi extends ApiHandlers = ApiHandlers,
  TEvents extends EventsSchema = EventsSchema,
> {
  api?: IpcApi<TApi>;
  apiKey?: string;
  events?: IpcEvents<TEvents>;
  eventsKey?: string;
  values?: Record<string, unknown>;
  valuesKey?: string;
  dialogs?: boolean | { key?: string; channelPrefix?: string };
  shell?: boolean | { key?: string; channelPrefix?: string };
}

function isEnabled(option: boolean | object | undefined): boolean {
  return option === true || typeof option === 'object';
}

/**
 * Sets up optional IPC application components in the main process.
 */
export async function setupMainAppKit<
  TApi extends ApiHandlers,
  TEvents extends EventsSchema,
>(options: MainAppKitOptions<TApi, TEvents> = {}): Promise<MainAppKitResult<TApi, TEvents>> {
  const disposables: IpcRegistration[] = [];

  const api = options.apiHandlers ? defineIpcApi(options.apiHandlers) : undefined;
  if (api) {
    disposables.push(api);
  }

  const events = options.eventSchema ? defineIpcEvents(options.eventSchema) : undefined;

  if (isEnabled(options.dialogs)) {
    const channelPrefix = typeof options.dialogs === 'object'
      ? options.dialogs.channelPrefix
      : undefined;
    disposables.push(registerDialogHandlers(channelPrefix));
  }

  if (isEnabled(options.shell)) {
    const channelPrefix = typeof options.shell === 'object'
      ? options.shell.channelPrefix
      : undefined;
    disposables.push(registerShellHandlers(channelPrefix));
  }

  let menuSpec: DeclarativeMenuSpec | undefined;
  if (options.menu) {
    const menuOptions: {
      format?: MenuSpecFormat;
      encoding?: BufferEncoding;
      onAction?: (actionId: string) => void;
    } = {};

    if (options.menu.format !== undefined) menuOptions.format = options.menu.format;
    if (options.menu.encoding !== undefined) menuOptions.encoding = options.menu.encoding;
    if (options.menu.onAction !== undefined) menuOptions.onAction = options.menu.onAction;

    menuSpec = await applyApplicationMenuFromFile(options.menu.filePath, menuOptions);
  }

  const result: MainAppKitResult<TApi, TEvents> = {
    dispose(): void {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    },
  };

  if (api) result.api = api;
  if (events) result.events = events;
  if (menuSpec) result.menuSpec = menuSpec;

  return result;
}

/**
 * Exposes optional IPC application components in preload with sensible defaults.
 */
export function setupPreloadAppKit<
  TApi extends ApiHandlers,
  TEvents extends EventsSchema,
>(options: PreloadAppKitOptions<TApi, TEvents> = {}): void {
  if (options.api) {
    exposeApiToRenderer(options.api, options.apiKey ?? 'api');
  }

  if (options.events) {
    exposeEventsToRenderer(options.events, options.eventsKey ?? 'events');
  }

  if (options.values) {
    exposeValues(options.values, options.valuesKey ?? 'meta');
  }

  if (isEnabled(options.dialogs)) {
    const key = typeof options.dialogs === 'object'
      ? (options.dialogs.key ?? 'dialogs')
      : 'dialogs';
    const channelPrefix = typeof options.dialogs === 'object'
      ? (options.dialogs.channelPrefix ?? 'dialog')
      : 'dialog';
    exposeDialogsToRenderer(key, channelPrefix);
  }

  if (isEnabled(options.shell)) {
    const key = typeof options.shell === 'object'
      ? (options.shell.key ?? 'shell')
      : 'shell';
    const channelPrefix = typeof options.shell === 'object'
      ? (options.shell.channelPrefix ?? 'shell')
      : 'shell';
    exposeShellToRenderer(key, channelPrefix);
  }
}
