import { describe, expect, it } from 'vitest';
import { STTManager } from '../src/stt-manager.js';

const RUN_INTEGRATION_LITE = process.env.RUN_INTEGRATION_LITE === '1';
const ALLOW_LOCAL_MIC = process.env.STT_ALLOW_LOCAL_MIC === '1';
const MODEL_PATH = process.env.STT_MODEL_PATH;
const WHISPER_BIN = process.env.STT_WHISPER_BIN ?? 'whisper';

// Integration-lite is opt-in only:
// - explicit manual command
// - local environment
// - explicit mic permission flag
const describeIntegration = RUN_INTEGRATION_LITE && ALLOW_LOCAL_MIC ? describe : describe.skip;

describeIntegration('STTManager integration-lite (manual only)', () => {
  it('reports runtime availability with local dependencies', async () => {
    expect(MODEL_PATH, 'Set STT_MODEL_PATH to a local GGML model path').toBeTruthy();

    const manager = new STTManager({
      whisperBin: WHISPER_BIN,
      modelPath: MODEL_PATH as string,
    });

    const status = await manager.getStatus();

    expect(status.hasModel).toBe(true);
    expect(status.hasBinary).toBe(true);
    expect(status.canRecord).toBe(true);
  });
});

