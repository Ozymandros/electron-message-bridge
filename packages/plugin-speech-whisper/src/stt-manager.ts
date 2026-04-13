import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import { app, systemPreferences } from 'electron';
import type { SpeechWhisperOptions, SttResultPayload, SttState, SttStatus } from './types.js';

type RecordFn = (options?: Record<string, unknown>) => {
  stream(): NodeJS.ReadableStream;
  stop(): void;
  pause(): void;
  resume(): void;
};

async function loadRecorderModule(): Promise<RecordFn> {
  try {
    const ns = (await import('node-record-lpcm16')) as RecordFn | {
      default?: RecordFn | { record?: RecordFn };
      record?: RecordFn;
    };
    if (typeof ns === 'function') {
      return ns;
    }
    const root =
      ns && typeof ns === 'object' && 'default' in ns && ns.default !== undefined
        ? ns.default
        : ns;
    if (typeof root === 'function') {
      return root;
    }
    if (root && typeof root === 'object') {
      if ('record' in root && typeof (root as { record: unknown }).record === 'function') {
        return (root as { record: RecordFn }).record;
      }
      if ('default' in root && typeof (root as { default: unknown }).default === 'function') {
        return (root as { default: RecordFn }).default;
      }
    }
    if (ns && typeof ns === 'object' && typeof ns.record === 'function') {
      return ns.record;
    }
  } catch {
    /* module missing or import failed */
  }
  throw new Error('node-record-lpcm16 failed to load (install dependency and SoX).');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function getTempBase(options: SpeechWhisperOptions): string {
  if (options.tempDir) return options.tempDir;
  try {
    return app.getPath('temp');
  } catch {
    return tmpdir();
  }
}

/**
 * Opinionated local STT: 16 kHz mono WAV via `node-record-lpcm16`, transcription via Whisper.cpp CLI subprocess.
 */
export class STTManager {
  readonly options: SpeechWhisperOptions;

  private state: SttState = 'IDLE';
  private lastError: string | undefined;
  private recordModule: RecordFn | null = null;

  private recordingSession: {
    recording: ReturnType<RecordFn>;
    outPath: string;
    fileStream: ReturnType<typeof createWriteStream>;
    starter: WebContents;
  } | null = null;

  private whisperChild: ReturnType<typeof spawn> | null = null;

  constructor(options: SpeechWhisperOptions) {
    this.options = options;
  }

  getState(): SttState {
    return this.state;
  }

  /**
   * Snapshot for IPC — never throws; missing deps surface as `canRecord` / `hasModel` / `error`.
   */
  async getStatus(): Promise<SttStatus> {
    const hasModel = await fileExists(this.options.modelPath);
    const hasBinary = await fileExists(this.options.whisperBin);

    let error: string | undefined = this.lastError;

    if (!hasModel) {
      error = 'Whisper model file not found.';
    } else if (!hasBinary) {
      error = 'Whisper CLI binary not found.';
    }
    let canRecord = hasModel && hasBinary;

    try {
      if (canRecord) {
        await this.ensureRecorder();
      }
    } catch (e) {
      canRecord = false;
      error = e instanceof Error ? e.message : String(e);
    }

    const mic = this.evaluateMicrophoneAccess();
    if (!mic.ok) {
      canRecord = false;
      error = mic.reason ?? error;
    }

    const uiState: SttState =
      this.state === 'IDLE' && !canRecord ? 'UNSUPPORTED' : this.state;

    return {
      canRecord,
      hasModel,
      hasBinary,
      state: uiState,
      ...(error !== undefined ? { error } : {}),
    };
  }

  /**
   * macOS: prompt for microphone if needed. Safe to call once at app startup.
   */
  async ensureMicrophonePermission(): Promise<boolean> {
    if (process.platform !== 'darwin') return true;
    if (this.options.askMicrophonePermission === false) return true;
    return systemPreferences.askForMediaAccess('microphone');
  }

  private async ensureRecorder(): Promise<RecordFn> {
    if (this.recordModule) {
      return this.recordModule;
    }
    const fn = await loadRecorderModule();
    this.recordModule = fn;
    return fn;
  }

  private evaluateMicrophoneAccess(): { ok: boolean; reason?: string } {
    if (process.platform === 'linux') {
      return { ok: true };
    }
    try {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      if (status === 'granted') return { ok: true };
      if (status === 'denied') {
        return { ok: false, reason: 'Microphone access denied in system settings.' };
      }
      if (status === 'restricted') {
        return { ok: false, reason: 'Microphone access restricted by policy.' };
      }
      return { ok: true };
    } catch {
      return { ok: true };
    }
  }

  /**
   * Start recording to a temp WAV file. Associates the session with `starter` for result delivery.
   */
  async start(starter: WebContents): Promise<void> {
    if (this.state === 'LISTENING' || this.state === 'PROCESSING') {
      throw new Error('STT session already active.');
    }
    const status = await this.getStatus();
    if (!status.canRecord || !status.hasModel || !status.hasBinary) {
      throw new Error(status.error ?? 'STT is not available (check model, binary, microphone).');
    }

    const record = await this.ensureRecorder();

    const outPath = join(
      getTempBase(this.options),
      `eiph-stt-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`,
    );
    const fileStream = createWriteStream(outPath, { encoding: 'binary' });
    const recording = record({
      sampleRate: 16000,
      channels: 1,
      audioType: 'wav',
      ...(this.options.recorder !== undefined ? { recorder: this.options.recorder } : {}),
    });

    const stream = recording.stream();
    stream.on('error', (err: Error) => {
      this.lastError = err.message;
      this.state = 'ERROR';
      void this.safeUnlink(outPath);
    });
    fileStream.on('error', (err: Error) => {
      this.lastError = err.message;
      this.state = 'ERROR';
      void this.safeUnlink(outPath);
    });
    stream.pipe(fileStream);

    this.recordingSession = { recording, outPath, fileStream, starter };
    this.state = 'LISTENING';
    this.lastError = undefined;
  }

  /**
   * Stop recording, run Whisper.cpp, send transcript to the window that started recording, delete temp WAV.
   */
  async stop(
    stopInvoker: WebContents,
    send: (wc: WebContents, payload: SttResultPayload) => void,
  ): Promise<void> {
    if (this.state !== 'LISTENING' || !this.recordingSession) {
      throw new Error('No active recording (call stt:start first).');
    }

    const { recording, outPath, fileStream, starter } = this.recordingSession;
    if (stopInvoker.id !== starter.id) {
      throw new Error('stt:stop must be invoked from the same window that called stt:start.');
    }
    this.recordingSession = null;
    this.state = 'PROCESSING';

    await new Promise<void>((resolve, reject) => {
      fileStream.once('finish', () => resolve());
      fileStream.once('error', reject);
      try {
        recording.stop();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });

    try {
      const text = await this.runWhisper(outPath);
      send(starter, { text: text.trim(), kind: 'final' });
      this.state = 'IDLE';
      this.lastError = undefined;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.lastError = msg;
      this.state = 'ERROR';
      throw e;
    } finally {
      await this.safeUnlink(outPath);
    }
  }

  private async runWhisper(wavPath: string): Promise<string> {
    const prefix = this.options.whisperArgsPrefix ?? [];
    const args = [...prefix, '-m', this.options.modelPath, '-f', wavPath, '-nt'];

    const child = spawn(this.options.whisperBin, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.whisperChild = child;

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => {
      stdout += c;
    });
    child.stderr?.on('data', (c: string) => {
      stderr += c;
    });

    const code = await new Promise<number>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (c) => resolve(c ?? -1));
    });
    this.whisperChild = null;

    if (code !== 0) {
      throw new Error(
        `Whisper exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
      );
    }
    if (stdout.trim().length === 0 && stderr.trim().length > 0) {
      return stderr.trim();
    }
    return stdout;
  }

  private async safeUnlink(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      /* ignore */
    }
  }

  /** Kill recorder subprocess and whisper child; remove temp file if known. */
  abort(): void {
    try {
      this.recordingSession?.recording.stop();
    } catch {
      /* ignore */
    }
    try {
      this.recordingSession?.fileStream.destroy();
    } catch {
      /* ignore */
    }
    const path = this.recordingSession?.outPath;
    this.recordingSession = null;

    if (this.whisperChild && !this.whisperChild.killed) {
      this.whisperChild.kill('SIGKILL');
    }
    this.whisperChild = null;

    if (path) {
      void this.safeUnlink(path);
    }
    if (this.state === 'LISTENING' || this.state === 'PROCESSING') {
      this.state = 'IDLE';
    }
  }
}
