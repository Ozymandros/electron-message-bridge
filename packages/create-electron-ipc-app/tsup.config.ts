import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  dts: false,
  clean: true,
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
  external: ['commander', 'picocolors'],
});
