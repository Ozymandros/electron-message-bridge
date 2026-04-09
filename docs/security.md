# Security Guide

electron-ipc-helper is designed to be **secure by default**. This guide explains the security model, what protections are built in, and what you must configure correctly in your application.

---

## Built-in protections

### 1. `ipcRenderer` is never exposed

`exposeApiToRenderer` and `exposeEventsToRenderer` never pass `ipcRenderer` itself to the renderer. Only the specific invocation/subscription closures for declared channels cross the boundary.

```ts
// What the renderer sees — only the declared functions:
window.api = {
  getUser: (id) => ipcRenderer.invoke('getUser', id), // closure, not ipcRenderer
};
```

### 2. Channel whitelist enforcement

Only channels explicitly declared in `defineIpcApi` or `defineIpcEvents` can be called from the renderer. Arbitrary channel names cannot be constructed at runtime by renderer code.

### 3. `contextBridge` serialisation

All values crossing the process boundary are serialised and cloned by Electron's structured clone algorithm. Prototype chains, functions (other than the whitelisted closures), and references to Node.js objects do not cross.

### 4. No dynamic evaluation

The library never uses `eval`, `new Function`, or `require` with dynamic paths.

---

## Required BrowserWindow configuration

These settings are **mandatory** for the security model to hold:

```ts
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,   // REQUIRED — isolates preload from renderer
    sandbox: true,            // STRONGLY RECOMMENDED — limits Node.js in renderer
    nodeIntegration: false,   // REQUIRED (default in modern Electron)
    preload: join(__dirname, 'preload.js'),
  },
});
```

If you set `contextIsolation: false`, the security guarantees of this library **do not apply**. The library will still function, but `ipcRenderer` leaks into the renderer's global scope.

---

## Preload script hardening checklist

- [ ] Import only from `electron-ipc-helper/preload` (not the root package) in preload scripts.
- [ ] Do not import `ipcRenderer` directly in preload — use `exposeApiToRenderer` and `exposeEventsToRenderer`.
- [ ] Do not expose Node.js built-in modules (`fs`, `path`, etc.) via `exposeValues` unless absolutely necessary. If you must, expose the minimum surface needed.
- [ ] Validate all inputs in `defineIpcApi` handlers before acting on them. The renderer is a potential attacker surface.
- [ ] Do not pass renderer-supplied values directly to `exec`, `spawn`, `eval`, or shell commands.

---

## Input validation in handlers

Handlers receive arguments directly from the renderer. Always validate:

```ts
const api = defineIpcApi({
  openFile: async (pathArg: unknown) => {
    // Validate the argument before using it
    if (typeof pathArg !== 'string' || pathArg.includes('..')) {
      throw new Error('Invalid path argument');
    }
    return fs.readFile(pathArg, 'utf-8');
  },
});
```

Use a schema validation library (e.g., `zod`) for complex argument shapes:

```ts
import { z } from 'zod';

const SaveSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const api = defineIpcApi({
  saveFile: async (rawArgs: unknown) => {
    const { path, content } = SaveSchema.parse(rawArgs);
    await fs.writeFile(path, content, 'utf-8');
  },
});
```

---

## Content Security Policy

Set a strict Content Security Policy in your renderer HTML to prevent XSS:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'">
```

Or via `session.defaultSession.webRequest.onHeadersReceived` for more control.

---

## Remote content

- Never load remote URLs in a `BrowserWindow` with `nodeIntegration: true`.
- If loading remote content is required, use `webview` with `nodeintegration="false"` and handle all IPC from the webview via the `ipc-message` event, not by exposing your API directly to the webview.

---

## Dependency security

Run dependency audits regularly:

```bash
npm audit
# or
pnpm audit
```

GitHub Dependabot is configured in this repository (`.github/dependabot.yml`) to automatically open PRs for dependency updates.

---

## Release security

- All releases are built in CI with GitHub Actions.
- The release workflow publishes with npm provenance attestations (`--provenance`).
- CodeQL analysis runs on every push to `main` (`.github/workflows/codeql.yml`).
- Secret scanning is enabled at the repository level.

---

## Reporting a vulnerability

Do **not** open a public GitHub issue for security vulnerabilities. Email the maintainers privately. We follow a responsible disclosure policy:

1. Report received and acknowledged within 24 hours.
2. Patch developed and tested within 7 days (critical) or 30 days (non-critical).
3. CVE and public disclosure coordinated with the reporter.
