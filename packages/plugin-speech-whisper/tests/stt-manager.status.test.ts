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

describe('STTManager.getStatus', () => {
  beforeEach(() => {
    accessMock.mockReset();
    vi.resetModules();
  });

  it('reports missing model and binary', async () => {
    accessMock.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    const { STTManager } = await import('../src/stt-manager.js');
    const m = new STTManager({
      whisperBin: '/w',
      modelPath: '/m.bin',
    });
    const s = await m.getStatus();
    expect(s.hasModel).toBe(false);
    expect(s.hasBinary).toBe(false);
    expect(s.canRecord).toBe(false);
    expect(s.state).toBe('UNSUPPORTED');
    expect(s.error).toBeDefined();
  });
});
