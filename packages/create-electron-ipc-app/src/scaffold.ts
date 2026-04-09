/**
 * Core scaffolding logic for create-electron-ipc-app.
 *
 * This module is pure Node.js (no CLI framework dependency) so it can be
 * unit-tested and called programmatically from scripts.
 */

import { mkdirSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TemplateDefinition } from './templates.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export interface ScaffoldOptions {
  /** Absolute path to the output directory. Must not already exist, or must be empty. */
  outputDir: string;
  /** Template definition to use. */
  template: TemplateDefinition;
  /** Project name (used in package.json and README). */
  projectName: string;
  /** Skip interactive prompts and use defaults. */
  nonInteractive?: boolean;
}

export interface ScaffoldResult {
  outputDir: string;
  files: string[];
}

// ─── Template source location ─────────────────────────────────────────────────

function templateDir(slug: string): string {
  // When installed: templates/ lives next to the dist/ folder
  const installed = resolve(__dirname, '..', 'templates', slug);
  if (existsSync(installed)) return installed;
  // Dev fallback: resolve from src/
  return resolve(__dirname, '..', '..', 'templates', slug);
}

// ─── Generated file content ───────────────────────────────────────────────────

function packageJsonContent(projectName: string, template: TemplateDefinition): string {
  const deps: Record<string, string> = {
    'electron-ipc-helper': '^0.1.0',
  };

  if (template.modules.menus) {
    deps['js-yaml'] = '^4.1.0';
  }

  return JSON.stringify(
    {
      name: projectName,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        build: 'tsc',
        start: 'electron dist/main.js',
        dev: 'tsc --watch',
        test: 'vitest run',
        'test:coverage': 'vitest run --coverage',
        typecheck: 'tsc --noEmit',
        lint: 'eslint src/',
      },
      dependencies: deps,
      devDependencies: {
        '@types/node': '^20.0.0',
        electron: '^32.0.0',
        typescript: '^5.4.0',
        vitest: '^1.6.0',
        '@vitest/coverage-v8': '^1.6.0',
        eslint: '^9.0.0',
      },
      engines: { node: '>=18' },
    },
    null,
    2,
  );
}

function tsconfigContent(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        outDir: 'dist',
        rootDir: 'src',
        strict: true,
        skipLibCheck: true,
        declaration: true,
        declarationMap: true,
        sourceMap: true,
      },
      include: ['src'],
      exclude: ['node_modules', 'dist'],
    },
    null,
    2,
  );
}

function readmeContent(projectName: string, template: TemplateDefinition): string {
  return `# ${projectName}

Scaffolded with [create-electron-ipc-app](https://github.com/your-org/electron-ipc-helper) using the **${template.label}** template.

## Getting started

\`\`\`bash
npm install
npm run build
npm start
\`\`\`

## Scripts

| Command | Description |
|---|---|
| \`npm run build\` | Compile TypeScript |
| \`npm start\` | Launch the Electron app |
| \`npm run dev\` | Watch mode (compile on change) |
| \`npm test\` | Run tests |
| \`npm run typecheck\` | Type-check without emitting |

## Template: ${template.label}

${template.description}

## Learn more

- [electron-ipc-helper docs](https://github.com/your-org/electron-ipc-helper/docs)
- [Electron docs](https://www.electronjs.org/docs)
`;
}

function vitestConfigContent(): string {
  return `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
`;
}

// ─── Minimal template source files ───────────────────────────────────────────

const MINIMAL_SOURCES: Record<string, string> = {
  'src/api.ts': `/**
 * IPC API definition — runs in the main process.
 */
import { defineIpcApi } from 'electron-ipc-helper';

export const api = defineIpcApi({
  ping: async () => 'pong',
  greet: async (name: string) => \`Hello, \${name}!\`,
});
`,

  'src/events.ts': `/**
 * Push events definition — runs in the main process.
 */
import { defineIpcEvents } from 'electron-ipc-helper';

export const events = defineIpcEvents({
  // (_message: string) => void   means: push a string message to the renderer
  notification: (_message: string) => {},
});
`,

  'src/preload.ts': `/**
 * Preload script — runs in an isolated context before the renderer.
 * THIS FILE MUST BE COMPILED AND REFERENCED IN BrowserWindow.webPreferences.preload.
 */
import { exposeApiToRenderer, exposeEventsToRenderer } from 'electron-ipc-helper/preload';
import { api } from './api.js';
import { events } from './events.js';

exposeApiToRenderer(api);
exposeEventsToRenderer(events);
`,

  'src/main.ts': `/**
 * Main process entry point.
 */
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { api } from './api.js';   // registers IPC handlers
import { events } from './events.js'; // declares push events

void api;   // suppress unused warning — handlers are registered on import
void events;

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');

  // HMR teardown (optional):
  // if (import.meta.hot) import.meta.hot.on('vite:beforeFullReload', () => api.dispose());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`,

  'src/renderer.d.ts': `/**
 * Renderer-side type augmentation.
 * Import this file in your renderer TypeScript config to get window.api types.
 */
import type { api } from './api.js';
import type { events } from './events.js';
import type { ExtractRendererApi, ExtractRendererEvents } from 'electron-ipc-helper';

declare global {
  interface Window {
    api: ExtractRendererApi<typeof api>;
    events: ExtractRendererEvents<typeof events>;
  }
}
`,
};

// ─── Full template additional source files ───────────────────────────────────

const FULL_EXTRA_SOURCES: Record<string, string> = {
  'src/lifecycle.ts': `/**
 * Child process lifecycle example.
 */
import { ChildProcessLifecycle } from 'electron-ipc-helper/lifecycle';

export const workerLifecycle = new ChildProcessLifecycle({
  command: 'node',
  args: ['worker.js'],
  readyCheck: async () => {
    // Poll or probe until the worker is ready
  },
  autoRestart: true,
  maxRestarts: 5,
  restartDelayMs: 1_000,
});

workerLifecycle.on('ready',   ()    => console.log('[worker] ready'));
workerLifecycle.on('crashed', (info) => console.error('[worker] crashed', info));
workerLifecycle.on('failed',  (err)  => console.error('[worker] failed:', err));
`,

  'src/plugins.ts': `/**
 * Plugin host setup.
 */
import { PluginHost } from 'electron-ipc-helper/plugins';
import { DiagnosticsPlugin } from 'electron-ipc-helper/plugins/diagnostics';
import { WindowStatePlugin } from 'electron-ipc-helper/plugins/window-state';

export const diagnostics = new DiagnosticsPlugin({ logIntervalMs: 60_000 });

export const windowState = new WindowStatePlugin({ key: 'mainWindow' });

export const host = new PluginHost({ logger: console });
host.register(diagnostics);
host.register(windowState);
`,

  'src/menu.yaml': `# Declarative application menu spec
# See electron-ipc-helper/menus for full options

- label: File
  submenu:
    - label: Open...
      actionId: file.open
      accelerator: CmdOrCtrl+O
    - type: separator
    - label: Quit
      role: quit

- label: Edit
  submenu:
    - label: Undo
      role: undo
    - label: Redo
      role: redo

- label: View
  submenu:
    - label: Toggle DevTools
      role: toggleDevTools
`,
};

// ─── Core scaffold logic ──────────────────────────────────────────────────────

/**
 * Scaffolds a new project from a template into `outputDir`.
 *
 * @throws {Error} If the output directory already exists and is non-empty.
 */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const { outputDir, template, projectName } = options;
  const absOut = resolve(outputDir);

  if (existsSync(absOut)) {
    const { readdirSync } = await import('node:fs');
    if (readdirSync(absOut).length > 0) {
      throw new Error(`Output directory "${absOut}" already exists and is not empty.`);
    }
  }

  mkdirSync(absOut, { recursive: true });

  const generatedFiles: string[] = [];

  // Write generated config files
  const configFiles: Record<string, string> = {
    'package.json': packageJsonContent(projectName, template),
    'tsconfig.json': tsconfigContent(),
    'README.md': readmeContent(projectName, template),
    'vitest.config.ts': vitestConfigContent(),
  };

  for (const [filename, content] of Object.entries(configFiles)) {
    const filePath = join(absOut, filename);
    writeFileSync(filePath, content, 'utf-8');
    generatedFiles.push(filename);
  }

  // Write source files for this template
  const sources =
    template.slug === 'full'
      ? { ...MINIMAL_SOURCES, ...FULL_EXTRA_SOURCES }
      : MINIMAL_SOURCES;

  for (const [relPath, content] of Object.entries(sources)) {
    const filePath = join(absOut, relPath);
    mkdirSync(join(absOut, relPath.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
    generatedFiles.push(relPath);
  }

  // Copy any extra static assets from the template directory (if present)
  const tmplDir = templateDir(template.slug);
  if (existsSync(tmplDir)) {
    cpSync(tmplDir, absOut, { recursive: true, force: false });
  }

  return { outputDir: absOut, files: generatedFiles };
}
