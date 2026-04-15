import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STTManager } from '../src/stt-manager';
import type { SpeechWhisperOptions } from '../src/types';

// ─── Hoist mocks so they're available before any imports ─────────────────────

const { mockSpawn, mockSystemPreferences, recordThrow } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockSystemPreferences: {
    getMediaAccessStatus: vi.fn(() => 'granted'),
    askForMediaAccess: vi.fn(() => Promise.resolve(true)),
  },
  // Shared flag: when true, node-record-lpcm16 import throws
  recordThrow: { value: false },
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('node:fs/promises', async () => ({
  access: vi.fn((path: string) => {
    if (path === 'whisper' || path.endsWith('.bin')) return Promise.resolve();
    return Promise.reject(new Error('not found'));
  }),
  unlink: vi.fn(() => Promise.resolve()),
}));

vi.mock('node-record-lpcm16', async () => {
  if (recordThrow.value) {
    throw new Error('node-record-lpcm16 failed to load (install dependency and SoX).');
  }
  return {
    default: () => ({
      stream: () => ({ on: vi.fn(), pipe: vi.fn() }),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    }),
  };
});

vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  systemPreferences: mockSystemPreferences,
}));

// Import the mocked access function so we can override per-test
import { access } from 'node:fs/promises';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockWebContents = { id: 1 } as Electron.WebContents;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('STTManager - coverage', () => {
  let options: SpeechWhisperOptions;

  beforeEach(() => {
    options = { whisperBin: 'whisper', modelPath: '/some/path/ggml-base.bin' };
    mockSpawn.mockReset();
    mockSystemPreferences.getMediaAccessStatus.mockReset();
    mockSystemPreferences.getMediaAccessStatus.mockReturnValue('granted');
    mockSystemPreferences.askForMediaAccess.mockReset();
    mockSystemPreferences.askForMediaAccess.mockResolvedValue(true);
    recordThrow.value = false;
    vi.mocked(access).mockReset();
    vi.mocked(access).mockImplementation((path: unknown) => {
      const p = path as string;
      if (p === 'whisper' || p.endsWith('.bin')) return Promise.resolve();
      return Promise.reject(new Error('not found'));
    });
  });

  // ── getStatus: missing model ──────────────────────────────────────────────

  it('should handle missing model', async () => {
    // Only whisperBin resolves; model (.bin) rejects
    vi.mocked(access).mockImplementation((path: unknown) => {
      const p = path as string;
      if (p === 'whisper') return Promise.resolve();
      return Promise.reject(new Error('not found'));
    });
    const stt = new STTManager(options);
    const status = await stt.getStatus();
    expect(status.hasModel).toBe(false);
    expect(status.error).toMatch(/model file not found/i);
  });

  // ── getStatus: missing binary ─────────────────────────────────────────────

  it('should handle missing binary', async () => {
    // Only model (.bin) resolves; whisperBin rejects
    vi.mocked(access).mockImplementation((path: unknown) => {
      const p = path as string;
      if (p.endsWith('.bin')) return Promise.resolve();
      return Promise.reject(new Error('not found'));
    });
    const stt = new STTManager(options);
    const status = await stt.getStatus();
    expect(status.hasBinary).toBe(false);
    expect(status.error).toMatch(/CLI binary not found/i);
  });

  // ── getStatus: recorder unavailable ──────────────────────────────────────

  it('should handle recorder load failure in canRecord check', async () => {
    // node-record-lpcm16 is already mocked; simulate the recorder throwing
    // inside ensureRecorder() by making the mock module raise during load.
    // We do this by resetting the module registry and re-importing with the
    // throw flag set.
    vi.resetModules();
    recordThrow.value = true;

    const { STTManager: FreshSTT } = await import('../src/stt-manager.js');
    const stt = new FreshSTT(options);
    const status = await stt.getStatus();
    expect(status.canRecord).toBe(false);
    expect(status.error).toMatch(/node-record-lpcm16 failed to load/i);

    recordThrow.value = false;
  });

  // ── getStatus: microphone denied (non-Linux platform) ────────────────────

  it('should handle microphone denied', async () => {
    const originalPlatform = process.platform;
    // Force a platform where mic permission is checked
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    mockSystemPreferences.getMediaAccessStatus.mockReturnValue('denied');

    try {
      const stt = new STTManager(options);
      const status = await stt.getStatus();
      expect(status.canRecord).toBe(false);
      expect(status.error).toMatch(/microphone access denied/i);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  // ── start() guard ─────────────────────────────────────────────────────────

  it('should throw if start called while LISTENING', async () => {
    const stt = new STTManager(options);
    (stt as unknown as { state: string }).state = 'LISTENING';
    await expect(stt.start(mockWebContents)).rejects.toThrow(/already active/i);
  });

  // ── stop() guard ──────────────────────────────────────────────────────────

  it('should no-op if stop called when not LISTENING', async () => {
    const stt = new STTManager(options);
    (stt as unknown as { state: string }).state = 'IDLE';
    await expect(stt.stop(mockWebContents, vi.fn())).resolves.toBeUndefined();
  });

  // ── abort() ───────────────────────────────────────────────────────────────

  it('should abort and cleanup safely', () => {
    const stt = new STTManager(options);
    (stt as unknown as { recordingSession: unknown }).recordingSession = {
      recording: { stop: vi.fn() },
      fileStream: { destroy: vi.fn() },
      outPath: '/tmp/file.wav',
      starter: mockWebContents,
    };
    (stt as unknown as { whisperChild: unknown }).whisperChild = {
      killed: false,
      kill: vi.fn(),
    };
    stt.abort();
    expect((stt as unknown as { recordingSession: unknown }).recordingSession).toBeNull();
    expect((stt as unknown as { whisperChild: unknown }).whisperChild).toBeNull();
    expect((stt as unknown as { state: string }).state).toBe('IDLE');
  });
});
