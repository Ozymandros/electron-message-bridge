import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let testDir: string;
let modelPath: string;
let binPath: string;

const spawnMock = vi.fn();
const unlinkMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    unlink: (...args: Parameters<typeof actual.unlink>) => unlinkMock(...args),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tmpdir()),
  },
  systemPreferences: {
    getMediaAccessStatus: vi.fn(() => 'granted'),
    askForMediaAccess: vi.fn(async () => true),
  },
}));

vi.mock('node-record-lpcm16', () => ({
  record: () => {
    const pt = new PassThrough();
    return {
      stream: () => pt,
      stop: () => {
        pt.end();
      },
      pause: vi.fn(),
      resume: vi.fn(),
    };
  },
}));

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

describe('STTManager Whisper + temp file cleanup', () => {
  beforeAll(() => {
    testDir = join(tmpdir(), `eiph-stt-cln-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    modelPath = join(testDir, 'm.bin');
    binPath = join(testDir, 'whisper');
    writeFileSync(modelPath, 'x');
    writeFileSync(binPath, 'x');
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    unlinkMock.mockReset();
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => {
      const c = new EventEmitter();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      Object.assign(c, {
        stdout,
        stderr,
        killed: false,
        kill: vi.fn(),
      });
      queueMicrotask(() => {
        stdout.emit('data', Buffer.from('hello from whisper', 'utf8'));
        c.emit('close', 0);
      });
      return c;
    });
  });

  it('deletes temp wav after successful transcription', async () => {
    const { STTManager } = await import('../src/stt-manager.js');
    const m = new STTManager({
      whisperBin: binPath,
      modelPath,
      tempDir: testDir,
    });

    const starter = { id: 7 } as Electron.WebContents;
    let sent: { text: string; kind: string } | undefined;
    await m.start(starter);
    await m.stop(starter, (_wc, p) => {
      sent = p;
    });

    expect(sent?.text).toContain('hello from whisper');
    expect(spawnMock).toHaveBeenCalled();
    expect(unlinkMock).toHaveBeenCalled();
    const unlinkedPath = unlinkMock.mock.calls.find((c) =>
      String(c[0]).includes('eiph-stt-'),
    )?.[0];
    expect(unlinkedPath).toBeDefined();
  });
});
