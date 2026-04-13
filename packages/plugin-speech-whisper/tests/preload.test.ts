import { afterEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const invoke = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke,
    on,
    removeListener,
  },
}));

describe('exposeSpeechWhisperToRenderer', () => {
  afterEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockReset();
    invoke.mockReset();
    on.mockReset();
    removeListener.mockReset();
  });

  it('exposes speech API with default channels', async () => {
    const { exposeSpeechWhisperToRenderer } = await import('../src/preload.js');

    exposeSpeechWhisperToRenderer('speech');

    expect(exposeInMainWorld).toHaveBeenCalledWith('speech', expect.any(Object));
    const api = exposeInMainWorld.mock.calls[0][1] as {
      start: () => unknown;
      stop: () => unknown;
      status: () => unknown;
      onTranscript: (cb: (t: string) => void) => () => void;
    };

    void api.start();
    expect(invoke).toHaveBeenCalledWith('stt:start');

    void api.stop();
    expect(invoke).toHaveBeenCalledWith('stt:stop');

    void api.status();
    expect(invoke).toHaveBeenCalledWith('stt:getStatus');

    const unsub = api.onTranscript(() => {});
    expect(on).toHaveBeenCalledWith('stt:result', expect.any(Function));
    unsub();
    expect(removeListener).toHaveBeenCalledWith('stt:result', expect.any(Function));
  });

  it('uses custom channel names when provided', async () => {
    const { exposeSpeechWhisperToRenderer } = await import('../src/preload.js');

    const channels = {
      getStatus: 'my:stt:getStatus',
      start: 'my:stt:start',
      stop: 'my:stt:stop',
      result: 'my:stt:result',
    };

    exposeSpeechWhisperToRenderer('speech', channels);

    const api = exposeInMainWorld.mock.calls[0][1] as {
      start: () => unknown;
      onTranscript: (cb: (t: string) => void) => () => void;
    };

    void api.start();
    expect(invoke).toHaveBeenCalledWith('my:stt:start');

    api.onTranscript(() => {});
    expect(on).toHaveBeenCalledWith('my:stt:result', expect.any(Function));
  });
});
