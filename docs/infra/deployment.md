# Deployment and Build Process

> **Scope:** Build pipeline, distribution format, release workflow. **Rendering context:** N/A **Last updated:** 2026-05-15

## Overview

esbuild bundles all TypeScript source into a single `main.js`. Obsidian loads `main.js`, `manifest.json`, and `styles.css` from `<vault>/.obsidian/plugins/ogstack/`. There are no transitive runtime dependencies — `obsidian`, `electron`, `@codemirror/*`, and Node builtins are externalized.

## Build Pipeline

### Scripts
| Command | Purpose |
|---|---|
| `npm run dev` | esbuild watch mode. Rebuilds on save; syncs to `VAULT_PATH/.obsidian/plugins/ogstack/` if `.env` is set. |
| `npm run build` | Production bundle. No sourcemap. |

### Configuration (`esbuild.config.mjs`)
- `entryPoints: ["src/main.ts"]`
- `bundle: true`, `format: "cjs"`, `target: "es2018"`
- **External:** `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`, Node builtins (via `builtin-modules`).
- **Tree-shaking:** on.
- **Sourcemap:** inline for dev, off for production.
- **VAULT_PATH integration:** reads `.env`, parses `VAULT_PATH=…`, ensures the plugin folder exists, points `outfile` directly at it, and copies `manifest.json` + `styles.css` after each build via an `onEnd` hook (`syncStatics`).

### Build sizes (production)
- `main.js` ≈ 92 KB
- `styles.css` ≈ 29 KB
- Well under Obsidian's 500 KB community-plugin guideline.

## Distribution Format

An Obsidian plugin folder contains exactly three files:

```
.obsidian/plugins/ogstack/
├── main.js          # bundled code (esbuild output)
├── manifest.json    # id, name, version, requestUrls, minAppVersion, isDesktopOnly
└── styles.css       # single stylesheet (Obsidian loads one CSS per plugin)
```

`manifest.json` declares `requestUrls` for every domain the plugin contacts:

- `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`, `api.x.ai` — main providers
- `api.github.com`, `raw.githubusercontent.com` — skill imports
- `http://localhost:11434` — Ollama

The plugin is `"isDesktopOnly": true` because the CLI providers use `child_process.spawn` (unavailable on mobile).

## Local Dev Loop

```bash
# 1. Copy .env.example → .env and set VAULT_PATH
cp .env.example .env
# 2. Start watcher
npm run dev
# 3. In Obsidian: Ctrl+P → "Reload app without saving" after each rebuild
```

The build script auto-creates the plugin folder under your vault if it doesn't exist.

## Release Workflow

1. Bump `version` in `manifest.json` AND `package.json`.
2. Update `temp/AUDIT_TASKS.md` if any tasks shipped.
3. `npm test` — must be 161/161 green.
4. `npx tsc --noEmit` — must be clean.
5. `npm run build` — produces `main.js`.
6. `git tag v<version>`, `git push --tags`.
7. Create GitHub release with `main.js`, `manifest.json`, `styles.css` as assets.

BRAT users will pick up the release automatically.

## Related Docs

- docs/architecture/folder-structure.md — Root file responsibilities.
- docs/infra/testing.md — Pre-deploy verification.
- docs/infra/environment.md — `.env` and settings overview.
