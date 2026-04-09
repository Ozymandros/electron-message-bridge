import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/vitest-ssr-shim.ts'],
    // Inline local workspace packages to avoid problematic CJS->ESM SSR helper
    // wrappers in the test runtime.
    server: {
      deps: {
        inline: ['electron-message-bridge', 'electron-message-bridge-adapter-assemblyscript'],
      },
    },
    // Maps bare 'electron' imports to our mock during tests.
    // Also maps the adapter package and peer dep references to their workspace
    // sources so both core shim tests and adapter package tests resolve correctly.
    alias: {
      electron: fileURLToPath(new URL('./tests/__mocks__/electron.ts', import.meta.url)),
      'electron-message-bridge-adapter-assemblyscript': fileURLToPath(
        new URL('./packages/adapter-assemblyscript/src/index.ts', import.meta.url),
      ),
      // When the adapter package tests import peer deps (electron-message-bridge,
      // electron-message-bridge/plugins) resolve to workspace source directly.
      'electron-message-bridge/plugins': fileURLToPath(new URL('./src/plugins.ts', import.meta.url)),
      'electron-message-bridge': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
    typecheck: {
      tsconfig: './tsconfig.typecheck.json',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts'],
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
