import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
  },
  systemPreferences: {
    getMediaAccessStatus: vi.fn(() => 'denied'),
    askForMediaAccess: vi.fn(async () => false),
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

describe('STTManager microphone policy', () => {
  beforeEach(() => {
    accessMock.mockReset();
    vi.resetModules();
  });

  it('marks canRecord false when mic access is denied (non-Linux)', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    accessMock.mockResolvedValue(undefined);

    try {
      const { STTManager } = await import('../src/stt-manager.js');
      const m = new STTManager({ whisperBin: '/w', modelPath: '/m.bin' });
      const s = await m.getStatus();

      expect(s.hasModel).toBe(true);
      expect(s.hasBinary).toBe(true);
      expect(s.canRecord).toBe(false);
      expect(s.error).toMatch(/Microphone access denied/);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});
