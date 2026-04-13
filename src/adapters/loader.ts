/**
 * @module adapters/loader
 *
 * Dynamic adapter loading utility for electron-message-bridge.
 *
 * Optional adapter packages (e.g. `@ozymandros/electron-message-bridge-adapter-assemblyscript`)
 * are declared as `optionalDependencies`. If a consumer has not installed one,
 * a static `import` fails at module-load time with a cryptic `MODULE_NOT_FOUND`
 * error that carries no actionable install hint.
 *
 * `requireAdapter` wraps a dynamic `import()` call, catches that error class,
 * and re-throws it as a typed {@link AdapterMissingError} with a clear message.
 *
 * ## For adapter authors
 *
 * Wrap your adapter's dynamic entry with `requireAdapter` to give consumers a
 * typed, actionable error when the package is absent:
 *
 * ```ts
 * // packages/adapter-my-runtime/src/loader.ts
 * import { requireAdapter } from 'electron-message-bridge/adapters/loader';
 *
 * const PACKAGE = '@electron-message-bridge/adapter-my-runtime';
 *
 * export function loadMyRuntimeAdapter() {
 *   return requireAdapter(PACKAGE, () => import(PACKAGE));
 * }
 * ```
 *
 * ## For consumers
 *
 * Use the loader when you want to conditionally load an adapter at runtime:
 *
 * ```ts
 * import { loadAssemblyScriptAdapter } from 'electron-message-bridge/adapters/assemblyscript';
 *
 * try {
 *   const { createAssemblyScriptAdapter } = await loadAssemblyScriptAdapter();
 *   const adapter = await createAssemblyScriptAdapter('./math.wasm', schema);
 * } catch (err) {
 *   if (err instanceof AdapterMissingError) {
 *     console.error('Install:', err.adapterName);
 *   }
 * }
 * ```
 */

import { AdapterMissingError } from '../errors.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Attempts to dynamically load an optional adapter package.
 *
 * Converts `MODULE_NOT_FOUND` / `ERR_MODULE_NOT_FOUND` errors into a typed
 * {@link AdapterMissingError}. All other errors (runtime errors inside the
 * adapter, syntax errors, etc.) are re-thrown unchanged.
 *
 * The `importFn` parameter **must** be written as an inline arrow that calls
 * `import()` so that bundlers (Webpack, Vite, tsup) can statically analyse
 * the import expression and produce a proper dynamic chunk or externalize it:
 *
 * ```ts
 * // ✓ bundler can see the specifier
 * requireAdapter('my-pkg', () => import('my-pkg'));
 *
 * // ✗ bundler cannot analyse a variable
 * const fn = () => import(someVar);
 * requireAdapter('my-pkg', fn);
 * ```
 *
 * @param packageName - The npm package name, used in the {@link AdapterMissingError} message.
 * @param importFn    - A zero-argument async thunk wrapping the `import()` call.
 * @returns The resolved module namespace.
 * @throws {AdapterMissingError} If the package is not installed.
 *
 * @example
 * ```ts
 * const mod = await requireAdapter(
 *   '@ozymandros/electron-message-bridge-adapter-assemblyscript',
 *   () => import('@ozymandros/electron-message-bridge-adapter-assemblyscript'),
 * );
 * return mod.createAssemblyScriptAdapter(source, schema);
 * ```
 */
export async function requireAdapter<T>(
  packageName: string,
  importFn: () => Promise<T>,
): Promise<T> {
  try {
    return await importFn();
  } catch (err: unknown) {
    if (isModuleNotFoundError(err, packageName)) {
      throw new AdapterMissingError(packageName);
    }
    throw err;
  }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Returns `true` when `err` is a module-resolution failure for `packageName`.
 *
 * Handles three distinct cases:
 * - Node.js CJS / `require()` — `error.code === 'MODULE_NOT_FOUND'`
 * - Node.js ESM / `import()`  — `error.code === 'ERR_MODULE_NOT_FOUND'`
 * - Vite / webpack HMR / Jest — plain `Error` with "Cannot find module" message
 *
 * @internal
 */
function isModuleNotFoundError(err: unknown, packageName: string): boolean {
  if (!(err instanceof Error)) return false;

  // Node.js native error code (CJS: MODULE_NOT_FOUND, ESM: ERR_MODULE_NOT_FOUND)
  const code = (err as NodeJS.ErrnoException).code ?? '';
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
    return err.message.includes(packageName);
  }

  // Vite, webpack, or Jest message pattern
  return (
    err.message.includes(`Cannot find module '${packageName}'`) ||
    err.message.includes(`Cannot find module "${packageName}"`)
  );
}
