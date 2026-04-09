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
 * // ✅ New
 * import { createAssemblyScriptAdapter } from '@electron-ipc-helper/adapter-assemblyscript';
 * ```
 *
 * This file is a **thin compatibility re-export shim** that forwards all
 * exports from `@electron-ipc-helper/adapter-assemblyscript`. It will be
 * removed in the next major release of `electron-ipc-helper`.
 *
 * @see https://github.com/your-org/electron-ipc-helper/blob/main/docs/MIGRATION.md
 * @module adapters/assemblyscript
 */

// Re-export everything from the standalone package.
// The `@electron-ipc-helper/adapter-assemblyscript` package must be installed
// alongside `electron-ipc-helper` for this import to resolve at runtime.
export * from '@electron-ipc-helper/adapter-assemblyscript';
