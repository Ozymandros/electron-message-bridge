/** Lifecycle state for local STT (Whisper.cpp + mic). */
export type SttState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'ERROR' | 'UNSUPPORTED';

/** Payload pushed on channel `stt:result` (and variants with prefix). */
export interface SttResultPayload {
  text: string;
  kind: 'final';
}

/** Returned by `stt:getStatus` — drives UI degradation. */
export interface SttStatus {
  canRecord: boolean;
  hasModel: boolean;
  hasBinary: boolean;
  state: SttState;
  error?: string;
}

/** Options for {@link STTManager} and {@link registerSpeechWhisperMain}. */
export interface SpeechWhisperOptions {
  /** Absolute path to Whisper.cpp CLI (e.g. `main`, `whisper-cli`, or `whisper.exe`). */
  whisperBin: string;
  /** Absolute path to a GGML `.bin` model file. */
  modelPath: string;
  /**
   * Extra CLI args inserted after the executable, before `-m` / `-f`.
   * Default whisper.cpp build: no extra args needed.
   */
  whisperArgsPrefix?: string[];
  /**
   * Override temp directory for recorded WAV files (default: `app.getPath('temp')` or `os.tmpdir()`).
   */
  tempDir?: string;
  /**
   * If false, {@link STTManager.ensureMicrophonePermission} does not prompt (macOS only).
   * @default true on macOS when that API is used.
   */
  askMicrophonePermission?: boolean;
  /**
   * Optional `node-record-lpcm16` recorder backend (`sox`, `rec`, `arecord`).
   */
  recorder?: string;
}

export interface SpeechWhisperChannelNames {
  getStatus: string;
  start: string;
  stop: string;
  result: string;
}

export const DEFAULT_STT_CHANNELS: SpeechWhisperChannelNames = {
  getStatus: 'stt:getStatus',
  start: 'stt:start',
  stop: 'stt:stop',
  result: 'stt:result',
};
