import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let testDir: string;
let modelPath: string;
let binPath: string;

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
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

describe('STTManager stop() window guard', () => {
  beforeAll(() => {
    testDir = join(tmpdir(), `eiph-stt-wm-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    modelPath = join(testDir, 'm.bin');
    binPath = join(testDir, 'whisper');
    writeFileSync(modelPath, 'x');
    writeFileSync(binPath, 'x');
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('rejects stop from a different WebContents than start', async () => {
    const { STTManager } = await import('../src/stt-manager.js');
    const m = new STTManager({
      whisperBin: binPath,
      modelPath,
      tempDir: testDir,
    });

    const starter = { id: 1 } as Electron.WebContents;
    const other = { id: 2 } as Electron.WebContents;

    await m.start(starter);

    await expect(
      m.stop(other, () => {
        /* noop */
      }),
    ).rejects.toThrow(/same window/);

    m.abort();
  });
});
