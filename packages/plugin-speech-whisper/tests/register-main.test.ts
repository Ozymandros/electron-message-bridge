import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handle = vi.fn();
const removeHandler = vi.fn();
const appOn = vi.fn();
const appRemoveListener = vi.fn();

vi.mock('electron', () => ({
  app: {
    on: appOn,
    removeListener: appRemoveListener,
  },
  ipcMain: {
    handle,
    removeHandler,
  },
}));

describe('registerSpeechWhisperMain', () => {
  beforeEach(() => {
    handle.mockClear();
    removeHandler.mockClear();
    appOn.mockClear();
    appRemoveListener.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
    handle.mockReset();
    removeHandler.mockReset();
    appOn.mockReset();
    appRemoveListener.mockReset();
  });

  it('registers three ipc handlers and before-quit hook', async () => {
    const { registerSpeechWhisperMain } = await import('../src/register-main.js');

    const reg = registerSpeechWhisperMain({
      whisperBin: '/bin/whisper',
      modelPath: '/models/x.bin',
    });

    expect(handle).toHaveBeenCalledTimes(3);
    expect(handle).toHaveBeenCalledWith('stt:getStatus', expect.any(Function));
    expect(handle).toHaveBeenCalledWith('stt:start', expect.any(Function));
    expect(handle).toHaveBeenCalledWith('stt:stop', expect.any(Function));
    expect(appOn).toHaveBeenCalledWith('before-quit', expect.any(Function));

    reg.dispose();

    expect(removeHandler).toHaveBeenCalledWith('stt:getStatus');
    expect(removeHandler).toHaveBeenCalledWith('stt:start');
    expect(removeHandler).toHaveBeenCalledWith('stt:stop');
    expect(appRemoveListener).toHaveBeenCalledWith('before-quit', expect.any(Function));
  });

  it('registers custom channel names when provided', async () => {
    const { registerSpeechWhisperMain } = await import('../src/register-main.js');

    const channels = {
      getStatus: 'my:stt:getStatus',
      start: 'my:stt:start',
      stop: 'my:stt:stop',
      result: 'my:stt:result',
    };

    registerSpeechWhisperMain(
      {
        whisperBin: '/bin/whisper',
        modelPath: '/models/x.bin',
      },
      channels,
    );

    expect(handle).toHaveBeenCalledWith('my:stt:getStatus', expect.any(Function));
    expect(handle).toHaveBeenCalledWith('my:stt:start', expect.any(Function));
    expect(handle).toHaveBeenCalledWith('my:stt:stop', expect.any(Function));
  });
});
