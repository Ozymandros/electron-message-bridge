/**
 * @module menus
 *
 * Declarative Electron menu helpers.
 *
 * This module lets you define menu structure as JSON/YAML, load it from disk,
 * validate the shape, and transform it to Electron menu templates.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

type MenuRole = NonNullable<MenuItemConstructorOptions['role']>;

/** Supported file formats for declarative menu specs. */
export type MenuSpecFormat = 'json' | 'yaml';

/**
 * A single declarative menu item.
 *
 * - Use `actionId` for app-specific actions.
 * - Use `role` for built-in Electron menu roles.
 * - Use `submenu` for nested hierarchical menus.
 */
export interface DeclarativeMenuItem {
  id?: string;
  label?: string;
  type?: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';
  role?: MenuRole;
  accelerator?: string;
  enabled?: boolean;
  visible?: boolean;
  checked?: boolean;
  actionId?: string;
  submenu?: DeclarativeMenuItem[];
}

/** Root menu spec object loaded from JSON/YAML. */
export interface DeclarativeMenuSpec {
  items: DeclarativeMenuItem[];
}

/** Loader options for `loadMenuSpecFromFile`. */
export interface LoadMenuSpecOptions {
  format?: MenuSpecFormat;
  encoding?: BufferEncoding;
}

/** Build options for `buildMenuTemplate`. */
export interface BuildMenuTemplateOptions {
  /** Optional action callback invoked for items that declare `actionId`. */
  onAction?: (actionId: string) => void;
}

function inferFormatFromPath(filePath: string): MenuSpecFormat {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    return 'json';
  }
  if (ext === '.yaml' || ext === '.yml') {
    return 'yaml';
  }

  throw new TypeError(
    `[electron-ipc-helper] Unsupported menu file extension "${ext}". Use .json, .yaml, or .yml.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateItem(item: unknown, pathLabel: string): asserts item is DeclarativeMenuItem {
  if (!isRecord(item)) {
    throw new TypeError(`[electron-ipc-helper] ${pathLabel} must be an object.`);
  }

  const type = item['type'];
  if (type !== undefined && typeof type !== 'string') {
    throw new TypeError(`[electron-ipc-helper] ${pathLabel}.type must be a string.`);
  }

  if (type === 'separator') {
    return;
  }

  if (item['label'] !== undefined && typeof item['label'] !== 'string') {
    throw new TypeError(`[electron-ipc-helper] ${pathLabel}.label must be a string.`);
  }

  if (item['id'] !== undefined && typeof item['id'] !== 'string') {
    throw new TypeError(`[electron-ipc-helper] ${pathLabel}.id must be a string.`);
  }

  if (item['role'] !== undefined && typeof item['role'] !== 'string') {
    throw new TypeError(`[electron-ipc-helper] ${pathLabel}.role must be a string.`);
  }

  if (item['accelerator'] !== undefined && typeof item['accelerator'] !== 'string') {
    throw new TypeError(`[electron-ipc-helper] ${pathLabel}.accelerator must be a string.`);
  }

  if (item['enabled'] !== undefined && typeof item['enabled'] !== 'boolean') {
    throw new TypeError(`[electron-ipc-helper] ${pathLabel}.enabled must be a boolean.`);
  }

  if (item['visible'] !== undefined && typeof item['visible'] !== 'boolean') {
    throw new TypeError(`[electron-ipc-helper] ${pathLabel}.visible must be a boolean.`);
  }

  if (item['checked'] !== undefined && typeof item['checked'] !== 'boolean') {
    throw new TypeError(`[electron-ipc-helper] ${pathLabel}.checked must be a boolean.`);
  }

  if (item['actionId'] !== undefined && typeof item['actionId'] !== 'string') {
    throw new TypeError(`[electron-ipc-helper] ${pathLabel}.actionId must be a string.`);
  }

  if (item['submenu'] !== undefined) {
    if (!Array.isArray(item['submenu'])) {
      throw new TypeError(`[electron-ipc-helper] ${pathLabel}.submenu must be an array.`);
    }
    item['submenu'].forEach((child, index) => validateItem(child, `${pathLabel}.submenu[${index}]`));
  }
}

/**
 * Validates and normalizes a raw object into a `DeclarativeMenuSpec`.
 */
export function validateMenuSpec(raw: unknown): DeclarativeMenuSpec {
  if (!isRecord(raw)) {
    throw new TypeError('[electron-ipc-helper] Menu spec root must be an object.');
  }

  const items = raw['items'];
  if (!Array.isArray(items)) {
    throw new TypeError('[electron-ipc-helper] Menu spec root must contain an "items" array.');
  }

  items.forEach((item, index) => validateItem(item, `items[${index}]`));
  return { items: items as DeclarativeMenuItem[] };
}

/**
 * Parses a declarative menu string as JSON or YAML and validates it.
 */
export function parseMenuSpec(content: string, format: MenuSpecFormat): DeclarativeMenuSpec {
  let raw: unknown;

  if (format === 'json') {
    raw = JSON.parse(content) as unknown;
  } else {
    raw = parseYaml(content) as unknown;
  }

  return validateMenuSpec(raw);
}

/**
 * Loads a declarative menu spec from a JSON/YAML file path.
 */
export async function loadMenuSpecFromFile(
  filePath: string,
  options: LoadMenuSpecOptions = {},
): Promise<DeclarativeMenuSpec> {
  const encoding = options.encoding ?? 'utf8';
  const format = options.format ?? inferFormatFromPath(filePath);
  const fileContent = await readFile(filePath, { encoding });
  return parseMenuSpec(fileContent, format);
}

function toTemplateItem(
  item: DeclarativeMenuItem,
  options: BuildMenuTemplateOptions,
): MenuItemConstructorOptions {
  if (item.type === 'separator') {
    return { type: 'separator' };
  }

  const templateItem: MenuItemConstructorOptions = {};

  if (item.id !== undefined) templateItem.id = item.id;
  if (item.label !== undefined) templateItem.label = item.label;
  if (item.type !== undefined) templateItem.type = item.type;
  if (item.role !== undefined) templateItem.role = item.role;
  if (item.accelerator !== undefined) templateItem.accelerator = item.accelerator;
  if (item.enabled !== undefined) templateItem.enabled = item.enabled;
  if (item.visible !== undefined) templateItem.visible = item.visible;
  if (item.checked !== undefined) templateItem.checked = item.checked;

  if (item.submenu && item.submenu.length > 0) {
    templateItem.submenu = buildMenuTemplate(item.submenu, options);
  }

  if (item.actionId !== undefined) {
    const actionId = item.actionId;
    templateItem.click = () => {
      options.onAction?.(actionId);
    };
  }

  return templateItem;
}

/**
 * Converts declarative items into an Electron `Menu.buildFromTemplate` payload.
 */
export function buildMenuTemplate(
  items: DeclarativeMenuItem[],
  options: BuildMenuTemplateOptions = {},
): MenuItemConstructorOptions[] {
  return items.map((item) => toTemplateItem(item, options));
}

/**
 * Loads a menu spec from disk and applies it as the application menu.
 */
export async function applyApplicationMenuFromFile(
  filePath: string,
  options: LoadMenuSpecOptions & BuildMenuTemplateOptions = {},
): Promise<DeclarativeMenuSpec> {
  const spec = await loadMenuSpecFromFile(filePath, options);
  const template = buildMenuTemplate(spec.items, options);
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return spec;
}
