import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm', 'cjs'],
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  // electron and electron-ipc-helper are always externals — never bundle them
  external: ['electron', 'electron-ipc-helper'],
});
