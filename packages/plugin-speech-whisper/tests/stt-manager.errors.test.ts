import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { accessMock, streamRef, fileStreamRef, spawnConfig } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  streamRef: { current: null as EventEmitter | null },
  fileStreamRef: { current: null as EventEmitter | null },
  spawnConfig: {
    code: 0,
    stdout: 'mock transcript',
    stderr: '',
  },
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
  },
  systemPreferences: {
    getMediaAccessStatus: vi.fn(() => 'granted'),
    askForMediaAccess: vi.fn(async () => true),
  },
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    access: (...args: Parameters<typeof actual.access>) => accessMock(...args),
    unlink: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('node:fs', () => ({
  createWriteStream: vi.fn(() => {
    const emitter = new EventEmitter() as EventEmitter & {
      destroy: () => void;
    };
    emitter.destroy = vi.fn();
    fileStreamRef.current = emitter;
    return emitter;
  }),
}));

vi.mock('node-record-lpcm16', () => ({
  default: () => ({
    stream: () => {
      const emitter = new EventEmitter() as EventEmitter & {
        pipe: (dest: unknown) => unknown;
      };
      emitter.pipe = vi.fn((dest: unknown) => dest);
      streamRef.current = emitter;
      return emitter;
    },
    stop: vi.fn(() => {
      queueMicrotask(() => {
        fileStreamRef.current?.emit('finish');
      });
    }),
    pause: vi.fn(),
    resume: vi.fn(),
  }),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      killed: boolean;
      kill: () => void;
    };
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    child.stdout = stdout;
    child.stderr = stderr;
    child.killed = false;
    child.kill = vi.fn();

    queueMicrotask(() => {
      if (spawnConfig.stdout) {
        stdout.emit('data', spawnConfig.stdout);
      }
      if (spawnConfig.stderr) {
        stderr.emit('data', spawnConfig.stderr);
      }
      child.emit('close', spawnConfig.code);
    });

    return child;
  }),
}));

describe('STTManager error paths', () => {
  beforeEach(() => {
    accessMock.mockReset();
    accessMock.mockResolvedValue(undefined);
    streamRef.current = null;
    fileStreamRef.current = null;
    spawnConfig.code = 0;
    spawnConfig.stdout = 'mock transcript';
    spawnConfig.stderr = '';
    vi.resetModules();
  });

  it('stop() without start is a no-op', async () => {
    accessMock.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    const { STTManager } = await import('../src/stt-manager.js');
    const m = new STTManager({ whisperBin: '/w', modelPath: '/m.bin' });
    const starter = { id: 1 } as Electron.WebContents;
    await expect(
      m.stop(starter, () => {
        /* noop */
      }),
    ).resolves.toBeUndefined();
  });

  it('start() throws when model/binary unavailable', async () => {
    accessMock.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    const { STTManager } = await import('../src/stt-manager.js');
    const m = new STTManager({ whisperBin: '/w', modelPath: '/m.bin' });
    const starter = { id: 1 } as Electron.WebContents;
    await expect(m.start(starter)).rejects.toThrow(/Whisper model file not found/);
  });

  it('keeps flow stable when recorder stream fails before stop()', async () => {
    const { STTManager } = await import('../src/stt-manager.js');
    const m = new STTManager({ whisperBin: '/w', modelPath: '/m.bin' });
    const starter = { id: 1 } as Electron.WebContents;
    const send = vi.fn();

    await m.start(starter);
    expect(m.getState()).toBe('LISTENING');

    const stream = streamRef.current;
    expect(stream).toBeTruthy();
    stream!.emit('error', new Error('Mic stream failed'));

    expect(m.getState()).toBe('ERROR');
    const status = await m.getStatus();
    expect(status.state).toBe('ERROR');
    expect(status.error).toBe('Mic stream failed');

    await expect(m.stop(starter, send)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not crash if stream emits non-Error payload', async () => {
    const { STTManager } = await import('../src/stt-manager.js');
    const m = new STTManager({ whisperBin: '/w', modelPath: '/m.bin' });
    const starter = { id: 1 } as Electron.WebContents;

    await m.start(starter);
    streamRef.current!.emit('error', { code: 'E_MIC_BROKEN' });

    expect(m.getState()).toBe('ERROR');
    await expect(
      m.stop(starter, () => {
        /* noop */
      }),
    ).resolves.toBeUndefined();
  });

  it('transitions LISTENING -> PROCESSING -> IDLE on successful stop()', async () => {
    const { STTManager } = await import('../src/stt-manager.js');
    const m = new STTManager({ whisperBin: '/w', modelPath: '/m.bin' });
    const starter = { id: 1 } as Electron.WebContents;
    const send = vi.fn();

    await m.start(starter);
    expect(m.getState()).toBe('LISTENING');

    const stopPromise = m.stop(starter, send);
    expect(m.getState()).toBe('PROCESSING');

    await expect(stopPromise).resolves.toBeUndefined();
    expect(m.getState()).toBe('IDLE');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(starter, { text: 'mock transcript', kind: 'final' });
  });

  it('transitions to ERROR when Whisper exits non-zero during stop()', async () => {
    spawnConfig.code = 1;
    spawnConfig.stdout = '';
    spawnConfig.stderr = 'boom';

    const { STTManager } = await import('../src/stt-manager.js');
    const m = new STTManager({ whisperBin: '/w', modelPath: '/m.bin' });
    const starter = { id: 1 } as Electron.WebContents;

    await m.start(starter);
    expect(m.getState()).toBe('LISTENING');

    const stopPromise = m.stop(starter, vi.fn());
    expect(m.getState()).toBe('PROCESSING');
    await expect(stopPromise).rejects.toThrow(/Whisper exited with code 1: boom/);

    expect(m.getState()).toBe('ERROR');
    const status = await m.getStatus();
    expect(status.state).toBe('ERROR');
    expect(status.error).toMatch(/Whisper exited with code 1: boom/);
  });

  it('enters ERROR when file stream emits error', async () => {
    const { STTManager } = await import('../src/stt-manager.js');
    const m = new STTManager({ whisperBin: '/w', modelPath: '/m.bin' });
    const starter = { id: 1 } as Electron.WebContents;

    await m.start(starter);
    fileStreamRef.current!.emit('error', new Error('Disk full'));

    expect(m.getState()).toBe('ERROR');
    const status = await m.getStatus();
    expect(status.state).toBe('ERROR');
    expect(status.error).toBe('Disk full');
  });
});
