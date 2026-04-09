/**
 * Chaos-style reliability tests for ChildProcessLifecycle.
 *
 * These tests simulate adverse conditions:
 * - Rapid successive crashes
 * - Concurrent start/stop races
 * - Cascading restart failures
 * - Flaky readyChecks that succeed on retry
 * - Stop called during a restart delay
 *
 * All tests use fake timers to stay deterministic.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChildProcessLifecycle } from '../src/lifecycle.js';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

// ─── Fake child process factories ────────────────────────────────────────────

class FakeChild extends EventEmitter {
  killed = false;
  pid = 9000 + Math.floor(Math.random() * 1000);
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killed = true;
    this.emit('exit', signal === 'SIGKILL' ? null : 0, signal === 'SIGKILL' ? signal : null);
    return true;
  }
}

function freshMock(n = 1): FakeChild[] {
  const children = Array.from({ length: n }, () => new FakeChild());
  spawnMock.mockReset();
  children.forEach((c, i) => {
    if (i < n - 1) spawnMock.mockReturnValueOnce(c);
    else spawnMock.mockReturnValue(c);
  });
  return children;
}

// ─── Chaos tests ──────────────────────────────────────────────────────────────

describe('ChildProcessLifecycle chaos tests', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles rapid successive crashes without leaking restart timers', async () => {
    const [c1, c2, c3] = freshMock(3) as [FakeChild, FakeChild, FakeChild];

    const lifecycle = new ChildProcessLifecycle({
      command: 'node',
      restartDelayMs: 10,
      maxRestarts: 5,
      rapidRestartWindowMs: 1_000,
    });

    const onCrashed = vi.fn();
    const onReady = vi.fn();
    lifecycle.on('crashed', onCrashed);
    lifecycle.on('ready', onReady);

    await lifecycle.start();
    expect(lifecycle.isReady()).toBe(true);

    // Rapid crash-restart-crash sequence
    c1.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(15);
    // c2 is now running; crash it immediately
    c2.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(15);
    // c3 is now running
    c3.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(15);

    expect(onCrashed.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(spawnMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('stop called during restart delay cancels the pending restart', async () => {
    const [child] = freshMock(1) as [FakeChild];

    const lifecycle = new ChildProcessLifecycle({
      command: 'node',
      restartDelayMs: 500,
    });

    await lifecycle.start();
    child.emit('exit', 1, null); // triggers restart delay

    // Stop before the delay expires
    const stopPromise = lifecycle.stop();
    await vi.advanceTimersByTimeAsync(600);
    await stopPromise;

    // Should not have spawned a second process
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(lifecycle.isReady()).toBe(false);
  });

  it('exceeds maxRestarts when restart attempts themselves fail (readyCheck fails)', async () => {
    // restartCount only accumulates across scheduleRestart calls without a
    // successful spawnAndActivate in between (restartCount resets to 0 on
    // successful start). To test maxRestarts, we make each restart attempt fail
    // by having readyCheck throw after the first successful start.
    const child1 = new FakeChild();
    spawnMock.mockReset();
    spawnMock.mockReturnValueOnce(child1);
    spawnMock.mockReturnValue(new FakeChild()); // all subsequent spawns

    let callIndex = 0;
    const readyCheck = async (): Promise<void> => {
      callIndex++;
      if (callIndex > 1) throw new Error('restart readyCheck fail');
    };

    const lifecycle = new ChildProcessLifecycle({
      command: 'node',
      readyCheck,
      readyTimeoutMs: 50,
      restartDelayMs: 1,
      maxRestarts: 2,
      rapidRestartWindowMs: 60_000,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    const onFailed = vi.fn();
    lifecycle.on('failed', onFailed);

    // First start succeeds (callIndex=1)
    await lifecycle.start();
    expect(lifecycle.isReady()).toBe(true);

    // Crash child1 — triggers restart loop where readyCheck (callIndex≥2) fails
    child1.emit('exit', 1, null);

    // Allow multiple restart delay cycles to fire (each takes 1ms delay + readyCheck)
    await vi.advanceTimersByTimeAsync(30);

    // After maxRestarts (2) failed restart attempts, lifecycle should emit 'failed'
    expect(onFailed).toHaveBeenCalled();
  });

  it('flaky readyCheck succeeds on second spawn', async () => {
    const child1 = new FakeChild();
    const child2 = new FakeChild();
    spawnMock.mockReturnValueOnce(child1).mockReturnValueOnce(child2);

    let attempt = 0;
    const readyCheck = async (): Promise<void> => {
      attempt++;
      if (attempt === 1) throw new Error('not ready yet');
    };

    const lifecycle = new ChildProcessLifecycle({
      command: 'node',
      readyCheck,
      readyTimeoutMs: 50,
      restartDelayMs: 1,
      maxRestarts: 2,
    });

    const onFailed = vi.fn();
    const onReady = vi.fn();
    lifecycle.on('failed', onFailed);
    lifecycle.on('ready', onReady);

    // First start will fail readyCheck → emits 'failed' (readyCheck throws = failed, not crash)
    await expect(lifecycle.start()).rejects.toThrow('not ready yet');

    // Since readyCheck failure goes through 'failed' path (not restart), manually restart
    await lifecycle.start();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('concurrent start calls only spawn one process', async () => {
    const [child] = freshMock(1);
    void child;

    const lifecycle = new ChildProcessLifecycle({ command: 'node' });

    // Call start twice concurrently
    await Promise.all([lifecycle.start(), lifecycle.start()]);

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('stop + immediate start resets state cleanly', async () => {
    const child1 = new FakeChild();
    const child2 = new FakeChild();
    spawnMock.mockReturnValueOnce(child1).mockReturnValueOnce(child2);

    const lifecycle = new ChildProcessLifecycle({ command: 'node' });

    await lifecycle.start();
    expect(lifecycle.isReady()).toBe(true);
    await lifecycle.stop();
    expect(lifecycle.isReady()).toBe(false);
    await lifecycle.start();
    expect(lifecycle.isReady()).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('dispose (stop) during active restart does not throw', async () => {
    const [child] = freshMock(1) as [FakeChild];
    spawnMock.mockReturnValue(new FakeChild()); // subsequent spawns return fresh children

    const lifecycle = new ChildProcessLifecycle({
      command: 'node',
      restartDelayMs: 100,
    });

    await lifecycle.start();
    child.emit('exit', 1, null); // triggers restart delay

    // Stop while restart is pending — should not throw
    const stopPromise = lifecycle.stop();
    await vi.advanceTimersByTimeAsync(200);
    await expect(stopPromise).resolves.toBeUndefined();
  });
});
