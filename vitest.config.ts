import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const bridgeRoot = import.meta.url;

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test-d.ts',
      'packages/adapter-grpc/tests/**/*.test.ts',
      'packages/adapter-named-pipe/tests/**/*.test.ts',
      'packages/adapter-stdio/tests/**/*.test.ts',
      'packages/adapter-assemblyscript/tests/**/*.test.ts',
      'packages/create-electron-ipc-app/tests/**/*.test.ts',
      'packages/plugin-speech-whisper/tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/__mocks__/**'],
    alias: {
      electron: new URL('./tests/__mocks__/electron.ts', bridgeRoot).pathname,
      '@electron-ipc-helper/adapter-assemblyscript': new URL(
        './packages/adapter-assemblyscript/src/index.ts',
        bridgeRoot,
      ).pathname,
      '@electron-ipc-helper/adapter-named-pipe': new URL(
        './packages/adapter-named-pipe/src/index.ts',
        bridgeRoot,
      ).pathname,
      '@electron-ipc-helper/adapter-grpc': new URL('./packages/adapter-grpc/src/index.ts', bridgeRoot).pathname,
      '@electron-ipc-helper/adapter-stdio': new URL('./packages/adapter-stdio/src/index.ts', bridgeRoot).pathname,
      'electron-ipc-helper/plugins': new URL('./src/plugins.ts', bridgeRoot).pathname,
      'electron-ipc-helper/transport': new URL('./src/transport.ts', bridgeRoot).pathname,
      'electron-ipc-helper/boundary': new URL('./src/boundary.ts', bridgeRoot).pathname,
      'electron-ipc-helper': new URL('./src/index.ts', bridgeRoot).pathname,
      '@ozymandros/electron-message-bridge-adapter-assemblyscript': fileURLToPath(
        new URL('./packages/adapter-assemblyscript/src/index.ts', bridgeRoot),
      ),
      'electron-message-bridge/plugins': fileURLToPath(new URL('./src/plugins.ts', bridgeRoot)),
      'electron-message-bridge/transport': fileURLToPath(new URL('./src/transport.ts', bridgeRoot)),
      'electron-message-bridge/boundary': fileURLToPath(new URL('./src/boundary.ts', bridgeRoot)),
      'electron-message-bridge': fileURLToPath(new URL('./src/index.ts', bridgeRoot)),
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
