import { beforeAll, describe, expect, it } from 'vitest';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://127.0.0.1:4010';
const HEALTH_URL = `${BASE_URL}/health`;
const isExplicitIntegrationRun = process.argv.some((arg) =>
  arg.includes('mock-backend.integration.test'),
);
const runIntegration = process.env.RUN_INTEGRATION === '1' || isExplicitIntegrationRun;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url: string, attempts = 20, delayMs = 500): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(delayMs);
  }

  throw new Error(
    `Integration backend is not reachable at ${url}. ` +
      `Start it with: pnpm run docker:mock:up. Last error: ${String(lastError)}`,
  );
}

describe.runIf(runIntegration)('integration: mock backend', () => {
  beforeAll(async () => {
    await waitForHealth(HEALTH_URL);
  }, 15_000);

  it('GET /health returns ok', async () => {
    const response = await fetch(HEALTH_URL);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as { ok: boolean; service: string };
    expect(payload.ok).toBe(true);
    expect(payload.service).toBe('mock-backend');
  });

  it('GET /api/ping returns pong payload', async () => {
    const response = await fetch(`${BASE_URL}/api/ping`);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as { ok: boolean; pong: boolean; at: string };
    expect(payload.ok).toBe(true);
    expect(payload.pong).toBe(true);
    expect(typeof payload.at).toBe('string');
  });

  it('POST /api/echo returns the same JSON payload', async () => {
    const body = { feature: 'integration-test', value: 42, nested: { ok: true } };

    const response = await fetch(`${BASE_URL}/api/echo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      ok: boolean;
      echo: { feature: string; value: number; nested: { ok: boolean } };
    };

    expect(payload.ok).toBe(true);
    expect(payload.echo).toEqual(body);
  });

  it('POST /api/echo with invalid JSON returns 400', async () => {
    const response = await fetch(`${BASE_URL}/api/echo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{ invalid',
    });

    expect(response.status).toBe(400);

    const payload = (await response.json()) as { ok: boolean; error: string };
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain('Invalid JSON');
  });
});
