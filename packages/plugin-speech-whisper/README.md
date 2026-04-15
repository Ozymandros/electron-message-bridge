# @ozymandros/electron-message-bridge-plugin-speech-whisper

## Whisper Model Download & Setup

**This package does not include the Whisper GGML model file.** You must download it manually and configure the `modelPath` option.

See [MODEL_SETUP.md](./MODEL_SETUP.md) for step-by-step instructions on downloading the model and setting the correct path in your project.

Optional **local speech-to-text** for [@ozymandros/electron-message-bridge](https://www.npmjs.com/package/@ozymandros/electron-message-bridge): captures **16 kHz mono 16-bit WAV** via [`node-record-lpcm16`](https://www.npmjs.com/package/node-record-lpcm16) (SoX-backed) and runs **[Whisper.cpp](https://github.com/ggerganov/whisper.cpp)** as a **subprocess** (no .NET, no bundled binaries).

## Install

```bash
pnpm add @ozymandros/electron-message-bridge-plugin-speech-whisper
```


**Peer dependencies:** `electron` (≥20) and `@ozymandros/electron-message-bridge` (same major as your app). This package does not ship Whisper or SoX.

---

**Important:**

- You must have [SoX](https://sourceforge.net/projects/sox/) installed on your system and its executable directory added to your `PATH` environment variable.
  - Download: https://sourceforge.net/projects/sox/
  - On Windows, ensure the folder containing `sox.exe` is in your `PATH`.
  - On macOS: `brew install sox`
  - On Linux: `apt-get install sox libsox-fmt-all`
- The [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) CLI must also be built and available (either by absolute path or in your `PATH`).

---

The main-process `STTManager` loads [`node-record-lpcm16`](https://www.npmjs.com/package/node-record-lpcm16) with a dynamic `import()` and calls its **`record()`** export (the package ships `module.exports = { record }`; ESM interop is handled for you).

## Prerequisites (opinionated)

1. **SoX** on `PATH` (required by `node-record-lpcm16`).
   - macOS: `brew install sox`
   - Windows: e.g. [SoX 14.4.1](https://sourceforge.net/projects/sox/files/sox/14.4.1/) or `choco install sox.portable`
   - Linux: `apt-get install sox libsox-fmt-all` (or your distro equivalent)
2. A **Whisper.cpp CLI** you built locally — path passed as `whisperBin` (e.g. `main`, `whisper-cli`, or `whisper.exe`).
3. A **GGML `.bin` model** on disk — path passed as `modelPath`.

Microphone permission:

- **macOS / Windows**: `getStatus()` uses `systemPreferences.getMediaAccessStatus('microphone')`. Call `stt.manager.ensureMicrophonePermission()` once after `app.whenReady` if you need the system prompt on macOS.
- **Linux**: mic access is not gated the same way; ensure PulseAudio/ALSA and SoX can open the default device.

## Main process

```ts
import { app } from 'electron';
import { registerSpeechWhisperMain } from '@ozymandros/electron-message-bridge-plugin-speech-whisper';

const stt = registerSpeechWhisperMain({
  whisperBin: '/absolute/path/to/whisper.cpp/build/bin/whisper-cli',
  modelPath: '/absolute/path/to/ggml-base.bin',
});

app.on('before-quit', () => {
  stt.dispose();
});
```

- **`registerSpeechWhisperMain(options, channels?)`** — registers `ipcMain.handle` for `stt:*` (or your custom channel map) and attaches `app.on('before-quit', …)` to call `manager.abort()` (stops recorder / Whisper child, deletes temp WAV).
- **`stt.dispose()`** — removes IPC handlers, detaches the `before-quit` listener, and calls `abort()`. Call from `before-quit` or your own shutdown path.
- **`stt.manager`** — use for `ensureMicrophonePermission()` or advanced inspection.

## Preload

```ts
import { exposeSpeechWhisperToRenderer } from '@ozymandros/electron-message-bridge-plugin-speech-whisper/preload';

exposeSpeechWhisperToRenderer('speech');
```

Optional second argument: custom channel names (must match main). Defaults are in `DEFAULT_STT_CHANNELS` from the main entry export.

## Renderer usage

`window.speech` (or your chosen key):

| Method | Description |
|--------|-------------|
| `speech.status()` | Promise → `{ canRecord, hasModel, hasBinary, state, error? }` |
| `speech.start()` | Start capture (same `BrowserWindow` must call `stop`) |
| `speech.stop()` | Stop capture, run Whisper, receive transcript via `onTranscript` |
| `speech.onTranscript(cb)` | Subscribe to **`stt:result`**; callback receives **plain string** (final text only in v1). Returns **unsubscribe** function. |

**v1 behavior:** only **final** transcripts after `stop` (no streaming partials).

### Status object (`stt:getStatus`)

| Field | Meaning |
|-------|---------|
| `hasModel` | Model file exists and is readable |
| `hasBinary` | Whisper CLI path exists and is readable |
| `canRecord` | Model + binary + mic policy OK + recorder module loadable |
| `state` | Internal machine state, or `UNSUPPORTED` when idle and `canRecord` is false (UI can dim controls) |
| `error?` | Human-readable reason when degraded (missing file, mic denied, recorder load failure, etc.) |

## IPC channels (defaults)

Export **`DEFAULT_STT_CHANNELS`** from `@ozymandros/electron-message-bridge-plugin-speech-whisper` if you need the same keys in main and preload.

| Channel | Direction | Payload |
|---------|------------|---------|
| `stt:getStatus` | invoke → main | _(none)_ → `SttStatus` |
| `stt:start` | invoke → main | _(none)_ |
| `stt:stop` | invoke → main | _(none)_ — must be same `WebContents` as `start` |
| `stt:result` | main → renderer | `{ text: string, kind: 'final' }` |

Custom prefix example (both sides must agree):

```ts
import { registerSpeechWhisperMain, DEFAULT_STT_CHANNELS } from '@ozymandros/electron-message-bridge-plugin-speech-whisper';

const channels = {
  ...DEFAULT_STT_CHANNELS,
  getStatus: 'myApp:stt:getStatus',
  start: 'myApp:stt:start',
  stop: 'myApp:stt:stop',
  result: 'myApp:stt:result',
};

registerSpeechWhisperMain({ whisperBin: '...', modelPath: '...' }, channels);
```

```ts
// preload
exposeSpeechWhisperToRenderer('speech', channels);
```

## Whisper CLI args

Default invocation (Whisper.cpp–style CLI):

```txt
<whisperBin> [...whisperArgsPrefix] -m <modelPath> -f <temp.wav> -nt
```

Optional extra args **before** `-m`:

```ts
registerSpeechWhisperMain({
  whisperBin: '...',
  modelPath: '...',
  whisperArgsPrefix: ['--no-gpu'],
});
```

If your build uses different flags, adjust `whisperArgsPrefix` or fork `STTManager` in this package.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `canRecord: false`, error about model/binary | Wrong path, or file not readable from the Electron process |
| `canRecord: false`, mic message | macOS/Windows: denied in privacy settings — open System Settings → Microphone |
| Recorder errors / SoX not found | SoX not on `PATH`, or Windows SoX version mismatch (see node-record-lpcm16 docs) |
| Whisper exits non-zero | Wrong CLI for your build, GPU flags, or invalid WAV — check stderr in thrown error |
| `stt:stop` throws “same window” | `stop` was invoked from a different `BrowserWindow` than `start` |

## Development

From the repo root:

```bash
pnpm --filter @ozymandros/electron-message-bridge-plugin-speech-whisper run build
pnpm --filter @ozymandros/electron-message-bridge-plugin-speech-whisper run test
```

Manual, opt-in integration-lite (local only, skipped by default):

```powershell
$env:RUN_INTEGRATION_LITE="1"
$env:STT_ALLOW_LOCAL_MIC="1"
$env:STT_MODEL_PATH="C:\path\to\ggml-base.bin"
$env:STT_WHISPER_BIN="whisper" # optional, defaults to whisper on PATH
pnpm --filter @ozymandros/electron-message-bridge-plugin-speech-whisper run test:integration-lite
```

This suite never runs in the standard `test` command and requires explicit flags to avoid accidental microphone usage.

## License

MIT
