/**
 * @deprecated
 *
 * The AssemblyScript adapter has been extracted into a standalone package:
 * **`electron-message-bridge-adapter-assemblyscript`**
 *
 * Install the new package:
 * ```bash
 * npm install electron-message-bridge-adapter-assemblyscript
 * ```
 *
 * Then update your imports:
 * ```ts
 * // ❌ Old (deprecated — will be removed in the next major release)
 * import { createAssemblyScriptAdapter } from 'electron-message-bridge/adapters/assemblyscript';
 *
 * // ✅ New (static import — package must be installed)
 * import { createAssemblyScriptAdapter } from 'electron-message-bridge-adapter-assemblyscript';
 *
 * // ✅ New (dynamic import — throws AdapterMissingError if not installed)
 * import { loadAssemblyScriptAdapter } from 'electron-message-bridge/adapters/assemblyscript';
 * const { createAssemblyScriptAdapter } = await loadAssemblyScriptAdapter();
 * ```
 *
 * @see https://github.com/your-org/electron-message-bridge/blob/main/docs/migration.md
 * @module adapters/assemblyscript
 */

import type * as AscAdapterModule from 'electron-message-bridge-adapter-assemblyscript';
import { requireAdapter } from './loader.js';

const PACKAGE = 'electron-message-bridge-adapter-assemblyscript';

// ─── Type-only re-exports ─────────────────────────────────────────────────────
// These are erased at runtime (zero cost). They allow consumers who already
// have the package installed to get full type inference from this shim.
// NOTE: TypeScript still resolves this module at type-check time, so
// electron-message-bridge-adapter-assemblyscript must be installed for types to
// work. Use `loadAssemblyScriptAdapter()` below for the graceful runtime path
// when the package may be absent.
export type * from 'electron-message-bridge-adapter-assemblyscript';

// ─── Lazy dynamic loader ──────────────────────────────────────────────────────

/**
 * Dynamically loads `electron-message-bridge-adapter-assemblyscript`.
 *
 * Use this when you want a graceful, typed error if the optional package is
 * not installed — rather than a cryptic `ERR_MODULE_NOT_FOUND` at import time.
 *
 * The returned object exposes every export from the package with full type
 * inference. Call it once and cache the result if you need it in multiple
 * places.
 *
 * @throws {AdapterMissingError} if `electron-message-bridge-adapter-assemblyscript`
 *   is not installed.
 *
 * @example
 * ```ts
 * import { loadAssemblyScriptAdapter } from 'electron-message-bridge/adapters/assemblyscript';
 * import { AdapterMissingError }       from 'electron-message-bridge';
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
 *     console.error('Run: npm install electron-message-bridge-adapter-assemblyscript');
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
} from 'electron-message-bridge-adapter-assemblyscript';
