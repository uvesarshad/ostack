# Releasing ogstack

This is the mechanical checklist for cutting a release. The first release
(v1.0.0) is the BRAT-distributed beta. The plan is to submit to the official
Obsidian community plugins directory after a feedback round.

## Per-release checklist

1. **Bump versions** — keep these three in sync:
   - [`manifest.json`](manifest.json) — `version` field
   - [`package.json`](package.json) — `version` field
   - [`versions.json`](versions.json) — add `"X.Y.Z": "<minAppVersion>"`
     (re-using `manifest.json`'s `minAppVersion` unless you're moving the floor)
2. **Update [`CHANGELOG.md`](CHANGELOG.md)** — new section at the top with the
   release date and the user-visible diff since the previous tag.
3. **Verify**:
   ```
   npx tsc --noEmit
   npx vitest run
   ```
   All 240+ tests should pass clean.
4. **Build for release** — emits `main.js`, `manifest.json`, `styles.css` to
   the repo root (these are the three files BRAT and the community store
   look for):
   ```
   node esbuild.config.mjs production
   ```
5. **Commit + tag**:
   ```
   git add -A
   git commit -m "release: vX.Y.Z"
   git tag -a X.Y.Z -m "vX.Y.Z"
   git push origin main --tags
   ```
   The tag must NOT have a `v` prefix — Obsidian's plugin updater matches the
   exact version string from `manifest.json`.
6. **Create a GitHub Release** for the tag:
   - Title: `X.Y.Z`
   - Body: paste the CHANGELOG section for this version
   - Attach as binary assets (NOT inside a zip):
     - `main.js`
     - `manifest.json`
     - `styles.css`
   - BRAT pulls these three files directly from the release — don't bundle.

## Distribution channels

### BRAT (active)

Users install via the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat):

> BRAT → Add Beta Plugin → paste `https://github.com/<owner>/ostack`

BRAT auto-updates from the latest GitHub Release on each Obsidian launch.

### Obsidian community plugins (planned)

When ready, submit a PR to
[`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases)
adding `ogstack` to `community-plugins.json`. Review typically takes 1–4
weeks. Once accepted, the plugin appears in Settings → Community plugins
for everyone.

Pre-submission checklist (Obsidian's [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)):

- [ ] `manifest.json` `id` doesn't include "obsidian" or "plugin"
- [ ] No mobile-incompatible features OR `isDesktopOnly: true` is set (✓ we set it)
- [ ] No telemetry / analytics
- [ ] No automatic updates outside Obsidian's mechanism
- [ ] No bundled fonts / theme overrides
- [ ] `funding_url` field added to manifest if accepting support
- [ ] README has a clear screenshot or GIF (add one before submitting)
