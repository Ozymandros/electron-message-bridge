/**
 * Unit tests for the scaffold core logic.
 *
 * Tests run in a temporary directory created per-test and cleaned up after.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from '../src/scaffold.js';
import { TEMPLATES } from '../src/templates.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'create-electron-ipc-app-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Minimal template ─────────────────────────────────────────────────────────

describe('scaffold: minimal template', () => {
  it('creates output directory with expected files', async () => {
    const outputDir = join(tmpDir, 'my-app');
    const result = await scaffold({
      outputDir,
      template: TEMPLATES.minimal,
      projectName: 'my-app',
    });

    expect(result.outputDir).toBe(outputDir);
    expect(existsSync(outputDir)).toBe(true);

    for (const f of result.files) {
      expect(existsSync(join(outputDir, f)), `${f} should exist`).toBe(true);
    }
  });

  it('generates valid package.json with correct name', async () => {
    const outputDir = join(tmpDir, 'my-minimal');
    await scaffold({
      outputDir,
      template: TEMPLATES.minimal,
      projectName: 'my-minimal',
    });

    const pkg = JSON.parse(readFileSync(join(outputDir, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('my-minimal');
    expect(pkg.dependencies?.['electron-ipc-helper']).toBeDefined();
    expect(pkg.scripts?.test).toBeDefined();
    expect(pkg.scripts?.build).toBeDefined();
  });

  it('generates tsconfig.json with strict mode', async () => {
    const outputDir = join(tmpDir, 'my-strict');
    await scaffold({
      outputDir,
      template: TEMPLATES.minimal,
      projectName: 'my-strict',
    });

    const tsconfig = JSON.parse(readFileSync(join(outputDir, 'tsconfig.json'), 'utf-8'));
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  it('generates README.md with project name', async () => {
    const outputDir = join(tmpDir, 'readme-test');
    await scaffold({
      outputDir,
      template: TEMPLATES.minimal,
      projectName: 'readme-test',
    });

    const readme = readFileSync(join(outputDir, 'README.md'), 'utf-8');
    expect(readme).toContain('readme-test');
    expect(readme).toContain('Minimal');
  });

  it('creates api.ts in src/', async () => {
    const outputDir = join(tmpDir, 'api-test');
    await scaffold({
      outputDir,
      template: TEMPLATES.minimal,
      projectName: 'api-test',
    });

    const api = readFileSync(join(outputDir, 'src', 'api.ts'), 'utf-8');
    expect(api).toContain('defineIpcApi');
    expect(api).toContain('electron-ipc-helper');
  });

  it('creates preload.ts in src/', async () => {
    const outputDir = join(tmpDir, 'preload-test');
    await scaffold({
      outputDir,
      template: TEMPLATES.minimal,
      projectName: 'preload-test',
    });

    const preload = readFileSync(join(outputDir, 'src', 'preload.ts'), 'utf-8');
    expect(preload).toContain('exposeApiToRenderer');
    expect(preload).toContain('electron-ipc-helper/preload');
  });

  it('creates renderer.d.ts with Window augmentation', async () => {
    const outputDir = join(tmpDir, 'renderer-types-test');
    await scaffold({
      outputDir,
      template: TEMPLATES.minimal,
      projectName: 'renderer-types-test',
    });

    const dts = readFileSync(join(outputDir, 'src', 'renderer.d.ts'), 'utf-8');
    expect(dts).toContain('ExtractRendererApi');
    expect(dts).toContain('interface Window');
  });
});

// ─── Full template ────────────────────────────────────────────────────────────

describe('scaffold: full template', () => {
  it('includes lifecycle, plugins, and menu.yaml sources', async () => {
    const outputDir = join(tmpDir, 'my-full-app');
    const result = await scaffold({
      outputDir,
      template: TEMPLATES.full,
      projectName: 'my-full-app',
    });

    const fileNames = result.files;
    expect(fileNames.some(f => f.includes('lifecycle'))).toBe(true);
    expect(fileNames.some(f => f.includes('plugins'))).toBe(true);
    expect(fileNames.some(f => f.includes('menu.yaml'))).toBe(true);
  });

  it('lifecycle.ts uses ChildProcessLifecycle', async () => {
    const outputDir = join(tmpDir, 'full-lc');
    await scaffold({
      outputDir,
      template: TEMPLATES.full,
      projectName: 'full-lc',
    });

    const lc = readFileSync(join(outputDir, 'src', 'lifecycle.ts'), 'utf-8');
    expect(lc).toContain('ChildProcessLifecycle');
    expect(lc).toContain('electron-ipc-helper/lifecycle');
  });

  it('plugins.ts uses PluginHost', async () => {
    const outputDir = join(tmpDir, 'full-plugins');
    await scaffold({
      outputDir,
      template: TEMPLATES.full,
      projectName: 'full-plugins',
    });

    const plugins = readFileSync(join(outputDir, 'src', 'plugins.ts'), 'utf-8');
    expect(plugins).toContain('PluginHost');
    expect(plugins).toContain('DiagnosticsPlugin');
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe('scaffold: error handling', () => {
  it('throws when output directory already exists and is non-empty', async () => {
    const outputDir = join(tmpDir, 'existing');
    // First scaffold creates the dir
    await scaffold({
      outputDir,
      template: TEMPLATES.minimal,
      projectName: 'existing',
    });

    // Second scaffold into the same non-empty dir should throw
    await expect(
      scaffold({ outputDir, template: TEMPLATES.minimal, projectName: 'existing' }),
    ).rejects.toThrow('already exists and is not empty');
  });

  it('allows scaffolding into a pre-existing empty directory', async () => {
    const { mkdirSync } = await import('node:fs');
    const outputDir = join(tmpDir, 'empty-dir');
    mkdirSync(outputDir, { recursive: true });

    // Should succeed: dir exists but is empty
    await expect(
      scaffold({ outputDir, template: TEMPLATES.minimal, projectName: 'empty-dir' }),
    ).resolves.toBeDefined();
  });
});

// ─── Templates catalog ────────────────────────────────────────────────────────

describe('templates catalog', () => {
  it('minimal template does not include lifecycle/plugins', () => {
    expect(TEMPLATES.minimal.modules.lifecycle).toBe(false);
    expect(TEMPLATES.minimal.modules.plugins).toBe(false);
  });

  it('full template includes all modules', () => {
    expect(TEMPLATES.full.modules.menus).toBe(true);
    expect(TEMPLATES.full.modules.lifecycle).toBe(true);
    expect(TEMPLATES.full.modules.plugins).toBe(true);
  });
});
