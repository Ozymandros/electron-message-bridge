import { contextBridge, ipcRenderer } from 'electron';
import type { SttResultPayload, SttStatus } from './types.js';
import type { SpeechWhisperChannelNames } from './types.js';
import { DEFAULT_STT_CHANNELS } from './types.js';

/**
 * Renderer-safe STT bridge (no raw `ipcRenderer` leak).
 *
 * @param key - `window` property name (default `speech`).
 * @param channels - override channel names if main used a custom prefix.
 */
export function exposeSpeechWhisperToRenderer(
  key = 'speech',
  channels: SpeechWhisperChannelNames = DEFAULT_STT_CHANNELS,
): void {
  const api = {
    start: () => ipcRenderer.invoke(channels.start) as Promise<void>,
    stop: () => ipcRenderer.invoke(channels.stop) as Promise<void>,
    status: () => ipcRenderer.invoke(channels.getStatus) as Promise<SttStatus>,
    onTranscript: (callback: (text: string) => void): (() => void) => {
      const listener = (_event: unknown, payload: SttResultPayload) => {
        callback(payload.text);
      };
      ipcRenderer.on(channels.result, listener);
      return () => {
        ipcRenderer.removeListener(channels.result, listener);
      };
    },
  };

  contextBridge.exposeInMainWorld(key, api);
}
