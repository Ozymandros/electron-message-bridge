# electron-message-bridge-adapter-assemblyscript

Optional AssemblyScript / WebAssembly adapter for [`electron-message-bridge`](https://github.com/your-org/electron-message-bridge).

Bridges AssemblyScript WASM module exports into typed IPC handlers that slot directly into the existing `defineIpcApi` / `exposeApiToRenderer` pipeline — with **zero mandatory runtime dependencies**.

---

## Why a separate package?

The core `electron-message-bridge` is intentionally lean. AssemblyScript support is an advanced, optional use-case; keeping it separate:

- Keeps the core bundle small for users who don't need WASM.
- Allows the adapter to evolve independently.
- Makes the optional dependency on `@assemblyscript/loader` explicit.

This package depends on `electron-message-bridge` as a peer dependency, so your
application owns the core version and can keep `core` and `adapter` aligned.

---

## Installation

```bash
npm install electron-message-bridge-adapter-assemblyscript
# peer deps (if not already installed)
npm install electron-message-bridge electron
```

---

## Quick start

```ts
// main.ts
import { createAssemblyScriptAdapter, asc } from 'electron-message-bridge-adapter-assemblyscript';
import { defineIpcApi } from 'electron-message-bridge';
import { exposeApiToRenderer } from 'electron-message-bridge/preload';

// 1. Define the schema (mirrors your AssemblyScript exports)
const schema = {
  add:   asc.fn(['i32', 'i32'], 'i32'),
  greet: asc.fn(['string'], 'string'),
};

// 2. Load the WASM module and create typed handlers
const adapter = await createAssemblyScriptAdapter('./math.wasm', schema);

// 3. Register IPC handlers on ipcMain
const api = defineIpcApi(adapter.handlers);

// 4. Expose to renderer via contextBridge (in preload.ts)
exposeApiToRenderer(api);
```

```ts
// renderer.ts
const result = await window.api.add(3, 4);        // => 7
const msg   = await window.api.greet('World');    // => 'Hello, World!'
```

---

## API reference

### `createAssemblyScriptAdapter(source, schema, options?)`

Loads a WASM module and returns typed async handlers.

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `string \| Buffer \| ArrayBuffer \| WebAssembly.Module \| WebAssembly.Instance` | Path to `.wasm` file, raw bytes, pre-compiled module, or existing instance |
| `schema` | `AscSchema` | Descriptor map of function signatures |
| `options` | `AssemblyScriptAdapterOptions` | Optional: imports, logger, `warnOnMissingRuntime` |

Returns `Promise<AssemblyScriptAdapter<S>>`:

```ts
interface AssemblyScriptAdapter<S> {
  handlers: InferAscHandlers<S>;   // Pass to defineIpcApi()
  instance: WebAssembly.Instance;  // The raw WASM instance
  runtime: AscRuntimeExports | null;
  dispose(): void;
}
```

---

### `AssemblyScriptPlugin`

Lifecycle-managed plugin for use with `PluginHost`:

```ts
import { PluginHost } from 'electron-message-bridge/plugins';
import { AssemblyScriptPlugin } from 'electron-message-bridge-adapter-assemblyscript';

const host = new PluginHost();
host.register(new AssemblyScriptPlugin({
  name: 'math',
  source: './math.wasm',
  schema: { add: asc.fn(['i32', 'i32'], 'i32') },
  onReady: (api) => { /* store api reference */ },
}));

await host.init();   // loads WASM, registers IPC handlers
await host.start();
// on shutdown:
await host.stop();
await host.dispose();
```

---

### `wrapLoaderInstance(loaderExports)`

Compatibility shim for [`@assemblyscript/loader`](https://www.assemblyscript.org/loader.html):

```ts
import { instantiate } from '@assemblyscript/loader';
import { wrapLoaderInstance, createAssemblyScriptAdapter } from 'electron-message-bridge-adapter-assemblyscript';

const { exports } = await instantiate(fs.readFileSync('./math.wasm'));
const adapter = await createAssemblyScriptAdapter(
  wrapLoaderInstance(exports),
  schema,
  { warnOnMissingRuntime: false },
);
```

---

### Supported types

| Schema type | JS type | Notes |
|-------------|---------|-------|
| `i32`, `u32`, `f32`, `f64` | `number` | Direct numeric mapping |
| `i64`, `u64` | `bigint` | Requires BigInt support |
| `bool` | `boolean` | Encoded as 0/1 on the WASM side |
| `string` | `string` | Requires AssemblyScript runtime (`--runtime full`) |
| `bytes` | `Uint8Array` | Requires AssemblyScript runtime |
| `void` | `undefined` | Return-only |

---

## Migrating from the old import path

In `electron-message-bridge@0.1.x` a compatibility shim re-exports this package from `electron-message-bridge/adapters/assemblyscript`. That shim is **deprecated** and will be removed in the next major release.

**Update your imports:**

```ts
// ❌ Old (deprecated)
import { createAssemblyScriptAdapter } from 'electron-message-bridge/adapters/assemblyscript';

// ✅ New
import { createAssemblyScriptAdapter } from '@electron-message-bridge/adapter-assemblyscript';
```

---

## License

MIT
