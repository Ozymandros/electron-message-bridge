import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Maps bare 'electron' imports to our mock during tests.
    // Also maps the adapter package and peer dep references to their workspace
    // sources so both core shim tests and adapter package tests resolve correctly.
    alias: {
      electron: new URL('./tests/__mocks__/electron.ts', import.meta.url).pathname,
      '@electron-ipc-helper/adapter-assemblyscript': new URL(
        './packages/adapter-assemblyscript/src/index.ts',
        import.meta.url,
      ).pathname,
      // When the adapter package tests import peer deps (electron-ipc-helper,
      // electron-ipc-helper/plugins) resolve to workspace source directly.
      'electron-ipc-helper/plugins': new URL('./src/plugins.ts', import.meta.url).pathname,
      'electron-ipc-helper': new URL('./src/index.ts', import.meta.url).pathname,
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
