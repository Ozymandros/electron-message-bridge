import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    preload: 'src/preload.ts',
    integrations: 'src/integrations.ts',
    menus: 'src/menus.ts',
    appkit: 'src/appkit.ts',
  },
  format: ['esm', 'cjs'],
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  // electron is always an external peer — never bundle it
  external: ['electron'],
});
