/**
 * Unit tests for optional appkit composition helpers.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Menu, contextBridge, ipcMain, resetMocks } from './__mocks__/electron.js';
import { setupMainAppKit, setupPreloadAppKit } from '../src/appkit.js';

describe('setupMainAppKit', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('registers api handlers and integrations', async () => {
    const kit = await setupMainAppKit({
      apiHandlers: {
        ping: async () => 'pong',
      },
      dialogs: true,
      shell: true,
    });

    expect(ipcMain._handlers.has('ping')).toBe(true);
    expect(ipcMain._handlers.has('dialog:open-file')).toBe(true);
    expect(ipcMain._handlers.has('dialog:open-directory')).toBe(true);
    expect(ipcMain._handlers.has('dialog:save-file')).toBe(true);
    expect(ipcMain._handlers.has('dialog:message-box')).toBe(true);
    expect(ipcMain._handlers.has('shell:open-external')).toBe(true);
    expect(ipcMain._handlers.has('shell:open-path')).toBe(true);

    kit.dispose();
  });

  it('dispose removes registered handlers', async () => {
    const kit = await setupMainAppKit({
      apiHandlers: {
        ping: async () => 'pong',
      },
      dialogs: true,
      shell: true,
    });

    kit.dispose();

    expect(ipcMain.removeHandler).toHaveBeenCalledWith('ping');
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('dialog:open-file');
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('dialog:open-directory');
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('dialog:save-file');
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('dialog:message-box');
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('shell:open-external');
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('shell:open-path');
  });

  it('applies menu from yaml file', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ipc-helper-appkit-'));

    try {
      const filePath = path.join(tempDir, 'menu.yaml');
      await writeFile(filePath, 'items:\n  - label: Help\n    actionId: help.open\n', 'utf8');

      const kit = await setupMainAppKit({
        menu: {
          filePath,
          onAction: () => {},
        },
      });

      expect(kit.menuSpec?.items[0]?.label).toBe('Help');
      expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
      expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1);

      kit.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('supports object-form integration prefixes and menu options', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ipc-helper-appkit-'));

    try {
      const filePath = path.join(tempDir, 'menu.json');
      await writeFile(filePath, '{"items":[{"label":"App","actionId":"app.open"}]}', 'utf8');

      const kit = await setupMainAppKit({
        dialogs: { channelPrefix: 'native-dialog' },
        shell: { channelPrefix: 'native-shell' },
        menu: {
          filePath,
          format: 'json',
          encoding: 'utf8',
          onAction: () => {},
        },
      });

      expect(ipcMain._handlers.has('native-dialog:open-file')).toBe(true);
      expect(ipcMain._handlers.has('native-shell:open-external')).toBe(true);
      expect(kit.menuSpec?.items[0]?.label).toBe('App');

      kit.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('setupPreloadAppKit', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('exposes api/events/values/dialogs/shell', async () => {
    const mainKit = await setupMainAppKit({
      apiHandlers: {
        ping: async () => 'pong',
      },
      eventSchema: {
        ready: (_code: number) => {},
      },
    });

    if (!mainKit.api || !mainKit.events) {
      throw new Error('Expected appkit API and events to be defined.');
    }

    setupPreloadAppKit({
      api: mainKit.api,
      events: mainKit.events,
      values: { version: '1.0.0' },
      dialogs: true,
      shell: true,
    });

    expect(contextBridge._exposed.has('api')).toBe(true);
    expect(contextBridge._exposed.has('events')).toBe(true);
    expect(contextBridge._exposed.has('meta')).toBe(true);
    expect(contextBridge._exposed.has('dialogs')).toBe(true);
    expect(contextBridge._exposed.has('shell')).toBe(true);

    mainKit.dispose();
  });

  it('supports object-form preload options with custom keys/prefixes', () => {
    setupPreloadAppKit({
      values: { env: 'test' },
      valuesKey: 'cfg',
      dialogs: { key: 'nativeDialogs', channelPrefix: 'native-dialog' },
      shell: { key: 'nativeShell', channelPrefix: 'native-shell' },
    });

    expect(contextBridge._exposed.has('cfg')).toBe(true);
    expect(contextBridge._exposed.has('nativeDialogs')).toBe(true);
    expect(contextBridge._exposed.has('nativeShell')).toBe(true);
  });
});
