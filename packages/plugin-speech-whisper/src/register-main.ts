import { app, ipcMain } from 'electron';
import { STTManager } from './stt-manager.js';
import type { SpeechWhisperChannelNames, SpeechWhisperOptions } from './types.js';
import { DEFAULT_STT_CHANNELS } from './types.js';

export interface SpeechWhisperRegistration {
  /** Stops recording, removes IPC handlers, detaches app quit hook. */
  dispose(): void;
  /** Live manager instance (e.g. to call `ensureMicrophonePermission()`). */
  manager: STTManager;
}

/**
 * Registers `ipcMain.handle` for STT channels and wires teardown on app quit.
 *
 * Channels (defaults):
 * - `stt:getStatus` → {@link STTManager.getStatus}
 * - `stt:start` → begin capture (same window must call `stt:stop`)
 * - `stt:stop` → finalize WAV, run Whisper, `webContents.send` on `stt:result`
 */
export function registerSpeechWhisperMain(
  options: SpeechWhisperOptions,
  channels: SpeechWhisperChannelNames = DEFAULT_STT_CHANNELS,
): SpeechWhisperRegistration {
  const manager = new STTManager(options);

  const onGetStatus = async () => manager.getStatus();

  const onStart = async (event: Electron.IpcMainInvokeEvent) => {
    await manager.start(event.sender);
  };

  const onStop = async (event: Electron.IpcMainInvokeEvent) => {
    await manager.stop(event.sender, (wc, payload) => {
      wc.send(channels.result, payload);
    });
  };

  ipcMain.handle(channels.getStatus, onGetStatus);
  ipcMain.handle(channels.start, onStart);
  ipcMain.handle(channels.stop, onStop);

  const onBeforeQuit = () => {
    manager.abort();
  };
  app.on('before-quit', onBeforeQuit);

  return {
    dispose(): void {
      app.removeListener('before-quit', onBeforeQuit);
      ipcMain.removeHandler(channels.getStatus);
      ipcMain.removeHandler(channels.start);
      ipcMain.removeHandler(channels.stop);
      manager.abort();
    },
    manager,
  };
}
