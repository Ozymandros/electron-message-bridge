import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    alias: {
      // Maps bare 'electron' imports to our mock during tests
      electron: new URL('./tests/__mocks__/electron.ts', import.meta.url).pathname,
      // Maps the peer dep to the workspace root's source during tests
      'electron-ipc-helper': new URL('../../src/index.ts', import.meta.url).pathname,
      'electron-ipc-helper/plugins': new URL('../../src/plugins.ts', import.meta.url).pathname,
    },
    typecheck: {
      tsconfig: './tsconfig.json',
    },
  },
});
