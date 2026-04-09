import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    preload: 'src/preload.ts',
    integrations: 'src/integrations.ts',
    menus: 'src/menus.ts',
    appkit: 'src/appkit.ts',
    lifecycle: 'src/lifecycle.ts',
    plugins: 'src/plugins.ts',
    'plugins/window-state': 'src/plugins/window-state.ts',
    'plugins/diagnostics': 'src/plugins/diagnostics.ts',
    'plugins/updater': 'src/plugins/updater.ts',
    boundary: 'src/boundary.ts',
    'adapters/assemblyscript': 'src/adapters/assemblyscript.ts',
    'adapters/loader': 'src/adapters/loader.ts',
  },
  format: ['esm', 'cjs'],
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  // electron and the adapter package are always externals — never bundle them
  external: ['electron', 'electron-message-bridge-adapter-assemblyscript'],
});
