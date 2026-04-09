/**
 * @deprecated
 *
 * The AssemblyScript adapter has been extracted into a standalone package:
 * **`@electron-ipc-helper/adapter-assemblyscript`**
 *
 * Install the new package:
 * ```bash
 * npm install @electron-ipc-helper/adapter-assemblyscript
 * ```
 *
 * Then update your imports:
 * ```ts
 * // ❌ Old (deprecated — will be removed in the next major release)
 * import { createAssemblyScriptAdapter } from 'electron-ipc-helper/adapters/assemblyscript';
 *
 * // ✅ New (static import — package must be installed)
 * import { createAssemblyScriptAdapter } from '@electron-ipc-helper/adapter-assemblyscript';
 *
 * // ✅ New (dynamic import — throws AdapterMissingError if not installed)
 * import { loadAssemblyScriptAdapter } from 'electron-ipc-helper/adapters/assemblyscript';
 * const { createAssemblyScriptAdapter } = await loadAssemblyScriptAdapter();
 * ```
 *
 * @see https://github.com/your-org/electron-ipc-helper/blob/main/docs/migration.md
 * @module adapters/assemblyscript
 */

import type * as AscAdapterModule from '@electron-ipc-helper/adapter-assemblyscript';
import { requireAdapter } from './loader.js';

const PACKAGE = '@electron-ipc-helper/adapter-assemblyscript';

// ─── Type-only re-exports ─────────────────────────────────────────────────────
// These are erased at runtime (zero cost). They allow consumers who import
// from this shim to keep their TypeScript types working during the migration
// window, without needing to install the standalone package first.
export type * from '@electron-ipc-helper/adapter-assemblyscript';

// ─── Lazy dynamic loader ──────────────────────────────────────────────────────

/**
 * Dynamically loads `@electron-ipc-helper/adapter-assemblyscript`.
 *
 * Use this when you want a graceful, typed error if the optional package is
 * not installed — rather than a cryptic `ERR_MODULE_NOT_FOUND` at import time.
 *
 * The returned object exposes every export from the package with full type
 * inference. Call it once and cache the result if you need it in multiple
 * places.
 *
 * @throws {AdapterMissingError} if `@electron-ipc-helper/adapter-assemblyscript`
 *   is not installed.
 *
 * @example
 * ```ts
 * import { loadAssemblyScriptAdapter } from 'electron-ipc-helper/adapters/assemblyscript';
 * import { AdapterMissingError }       from 'electron-ipc-helper';
 *
 * try {
 *   const { createAssemblyScriptAdapter, asc } = await loadAssemblyScriptAdapter();
 *
 *   const adapter = await createAssemblyScriptAdapter('./math.wasm', {
 *     add: asc.fn(['i32', 'i32'], 'i32'),
 *   });
 * } catch (err) {
 *   if (err instanceof AdapterMissingError) {
 *     console.error(`Missing: ${err.adapterName}`);
 *     console.error('Run: npm install @electron-ipc-helper/adapter-assemblyscript');
 *   }
 * }
 * ```
 */
export function loadAssemblyScriptAdapter(): Promise<typeof AscAdapterModule> {
  return requireAdapter(PACKAGE, () => import(PACKAGE));
}

// ─── Static compat re-exports ─────────────────────────────────────────────────
// These static re-exports preserve the original import surface for consumers
// who already have the package installed. They will fail at module-load time
// with ERR_MODULE_NOT_FOUND if the package is absent — use loadAssemblyScriptAdapter()
// for the graceful path.
export {
  createAssemblyScriptAdapter,
  wrapLoaderInstance,
  AssemblyScriptPlugin,
  asc,
} from '@electron-ipc-helper/adapter-assemblyscript';
