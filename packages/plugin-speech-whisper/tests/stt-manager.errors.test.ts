import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
  },
  systemPreferences: {
    getMediaAccessStatus: vi.fn(() => 'granted'),
    askForMediaAccess: vi.fn(async () => true),
  },
}));

const accessMock = vi.fn();

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    access: (...args: Parameters<typeof actual.access>) => accessMock(...args),
  };
});

describe('STTManager error paths', () => {
  beforeEach(() => {
    accessMock.mockReset();
    vi.resetModules();
  });

  it('stop() without start throws a clear error', async () => {
    accessMock.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    const { STTManager } = await import('../src/stt-manager.js');
    const m = new STTManager({ whisperBin: '/w', modelPath: '/m.bin' });
    const starter = { id: 1 } as Electron.WebContents;
    await expect(
      m.stop(starter, () => {
        /* noop */
      }),
    ).rejects.toThrow(/No active recording/);
  });

  it('start() throws when model/binary unavailable', async () => {
    accessMock.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    const { STTManager } = await import('../src/stt-manager.js');
    const m = new STTManager({ whisperBin: '/w', modelPath: '/m.bin' });
    const starter = { id: 1 } as Electron.WebContents;
    await expect(m.start(starter)).rejects.toThrow(/Whisper model file not found/);
  });
});
