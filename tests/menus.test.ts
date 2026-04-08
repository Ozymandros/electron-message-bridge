/**
 * Unit tests for declarative menus helpers.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Menu, resetMocks } from './__mocks__/electron.js';
import {
  applyApplicationMenuFromFile,
  buildMenuTemplate,
  loadMenuSpecFromFile,
  parseMenuSpec,
  validateMenuSpec,
} from '../src/menus.js';

beforeEach(() => {
  resetMocks();
});

describe('validateMenuSpec', () => {
  it('accepts a valid root object with items', () => {
    const spec = validateMenuSpec({
      items: [{ label: 'File', submenu: [{ label: 'Open', actionId: 'file.open' }] }],
    });

    expect(spec.items).toHaveLength(1);
  });

  it('throws on non-object root', () => {
    expect(() => validateMenuSpec('bad')).toThrow('Menu spec root must be an object');
  });

  it('throws when items is missing', () => {
    expect(() => validateMenuSpec({})).toThrow('must contain an "items" array');
  });

  it('throws for invalid item field types', () => {
    expect(() => validateMenuSpec({ items: [{ type: 123 }] })).toThrow('.type must be a string');
    expect(() => validateMenuSpec({ items: [{ label: 123 }] })).toThrow('.label must be a string');
    expect(() => validateMenuSpec({ items: [{ id: 123 }] })).toThrow('.id must be a string');
    expect(() => validateMenuSpec({ items: [{ role: 123 }] })).toThrow('.role must be a string');
    expect(() => validateMenuSpec({ items: [{ accelerator: 123 }] })).toThrow('.accelerator must be a string');
    expect(() => validateMenuSpec({ items: [{ enabled: 'yes' }] })).toThrow('.enabled must be a boolean');
    expect(() => validateMenuSpec({ items: [{ visible: 'yes' }] })).toThrow('.visible must be a boolean');
    expect(() => validateMenuSpec({ items: [{ checked: 'yes' }] })).toThrow('.checked must be a boolean');
    expect(() => validateMenuSpec({ items: [{ actionId: 123 }] })).toThrow('.actionId must be a string');
    expect(() => validateMenuSpec({ items: [{ submenu: 'nope' }] })).toThrow('.submenu must be an array');
  });
});

describe('parseMenuSpec', () => {
  it('parses JSON content', () => {
    const spec = parseMenuSpec(
      JSON.stringify({ items: [{ label: 'Help', actionId: 'help.open' }] }),
      'json',
    );

    expect(spec.items[0]?.label).toBe('Help');
  });

  it('parses YAML content', () => {
    const spec = parseMenuSpec(
      'items:\n  - label: File\n    submenu:\n      - label: Exit\n        role: quit\n',
      'yaml',
    );

    expect(spec.items[0]?.submenu?.[0]?.role).toBe('quit');
  });
});

describe('loadMenuSpecFromFile', () => {
  it('loads JSON by file extension', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ipc-helper-menu-'));

    try {
      const filePath = path.join(tempDir, 'menu.json');
      await writeFile(filePath, '{"items":[{"label":"View"}]}', 'utf8');

      const spec = await loadMenuSpecFromFile(filePath);
      expect(spec.items[0]?.label).toBe('View');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('loads YAML by file extension', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ipc-helper-menu-'));

    try {
      const filePath = path.join(tempDir, 'menu.yaml');
      await writeFile(filePath, 'items:\n  - label: Window\n', 'utf8');

      const spec = await loadMenuSpecFromFile(filePath);
      expect(spec.items[0]?.label).toBe('Window');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('throws for unsupported file extension', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ipc-helper-menu-'));

    try {
      const filePath = path.join(tempDir, 'menu.txt');
      await writeFile(filePath, '{}', 'utf8');

      await expect(loadMenuSpecFromFile(filePath)).rejects.toThrow('Unsupported menu file extension');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('buildMenuTemplate', () => {
  it('creates click handlers from actionId', () => {
    const onActionCalls: string[] = [];

    const template = buildMenuTemplate(
      [
        { label: 'File', submenu: [{ label: 'Open', actionId: 'file.open' }] },
        { type: 'separator' },
      ],
      { onAction: (actionId: string) => onActionCalls.push(actionId) },
    );

    const openItem = (template[0]?.submenu as unknown[])?.[0] as { click?: () => void };
    openItem.click?.();

    expect(onActionCalls).toEqual(['file.open']);
    expect(template[1]).toEqual({ type: 'separator' });
  });
});

describe('applyApplicationMenuFromFile', () => {
  it('loads, builds and applies the application menu', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ipc-helper-menu-'));

    try {
      const filePath = path.join(tempDir, 'menu.yml');
      await writeFile(filePath, 'items:\n  - label: Help\n    actionId: help.open\n', 'utf8');

      const spec = await applyApplicationMenuFromFile(filePath);

      expect(spec.items[0]?.label).toBe('Help');
      expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
      expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
