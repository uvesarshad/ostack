# Environment and Configuration

> **Scope:** Lists every setting and dev-environment variable. **Rendering context:** N/A **Last updated:** 2026-05-15

## Overview

Configuration in ogstack is handled through the Obsidian settings UI and persisted to `.obsidian/plugins/ogstack/data.json`. There is no `.env` at runtime; the only `.env` is a dev convenience that points the build at a vault for hot-sync.

## Runtime Configuration (GStackSettings)

### Provider
| Field | Type | Default | Notes |
|---|---|---|---|
| `provider` | `"claude" \| "openai" \| "gemini" \| "grok" \| "ollama" \| "claude-cli" \| "codex-cli" \| "gemini-cli"` | `"claude"` | Active LLM backend. |
| `apiKey` | `string` | `""` | For API providers. Plaintext; see disclaimer. |
| `model` | `string` | `""` (provider default) | Allowed chars: `[a-zA-Z0-9._:\-/]{1,80}`. |
| `ollamaHost` | `string` | `"http://localhost:11434"` | Only for Ollama. |
| `cliPath` | `string` | `""` (auto from PATH) | Only for CLI providers. Rejects shell metacharacters. |

### Context
| Field | Type | Default | Notes |
|---|---|---|---|
| `maxTokens` | `number` | `6000` | Token budget for linked notes (1000–16000). Active note always included in full. |
| `scoutEnabled` | `boolean` | `true` | Run the semantic re-rank pass. |
| `scoutModel` | `string` | `"gemini-2.0-flash-lite"` | Model used for scouting. |
| `scoutProvider` | `ProviderId \| "inherit"` | `"inherit"` | Lets you run the main model on a CLI subscription and the scout on a cheap API key. |
| `scoutApiKey` | `string` | `""` | Separate scout credentials when not inheriting. |
| `scoutCliPath` | `string` | `""` | Separate scout CLI path. |
| `scoutOllamaHost` | `string` | `"http://localhost:11434"` | Separate scout Ollama URL. |
| `contextDecayDays` | `number` | `14` | Recency decay constant in days (1–90). |
| `compactionThreshold` | `number` | `8000` | When estimated chat tokens exceed this, the bar offers Compact. |

### Output
| Field | Type | Default | Notes |
|---|---|---|---|
| `outputMode` | `"inline" \| "new-note"` | `"inline"` | Skill `output:` frontmatter overrides this. |

### Agent safety
| Field | Type | Default | Notes |
|---|---|---|---|
| `allowAgentWrites` | `boolean` | `false` | When false, `write_note` / `append_note` agent tools return an error. |

### First-run flag (not in the settings UI)
- `hasSeenWelcome` — boolean toggled by the welcome modal.

## Per-Skill Overrides (SKILL.md frontmatter)

Skills can override several settings on a per-run basis:

| Field | Default | Notes |
|---|---|---|
| `output` | global `outputMode` | `inline` or `new-note`. |
| `max_depth` | `3` | BFS link-walk depth (max 5). |
| `max_tokens` | global `maxTokens` | Token budget for this skill. |
| `mode` | `oneshot` | `interactive` enables `<ASK>` clarifying-questions protocol. |
| `agent` | `false` | Set true for tool-using skills (Claude API only). |
| `allowed_tools` | all six | Allow-list for agent tools. |
| `max_rounds` | `10` | Agent tool-call ceiling (hard cap 40). |
| `auto_insert` | `false` | Legacy: auto-insert into the active note from the command palette. |

## Development Environment

### `.env` (gitignored)
```bash
VAULT_PATH=C:\Users\you\Documents\MyVault
```

The build script (`esbuild.config.mjs`) reads this and writes `main.js` / `manifest.json` / `styles.css` directly into `<VAULT_PATH>/.obsidian/plugins/ogstack/` on every rebuild. Without it, output lands in the repo root.

### Scripts
| Command | Purpose |
|---|---|
| `npm install` | Install dev deps. |
| `npm run dev` | Watch + rebuild on save (syncs to vault if `.env` set). |
| `npm run build` | Production bundle. |
| `npm test` | Vitest run (161 tests). |
| `npm run test:watch` | Vitest in watch mode. |

## Related Docs

- docs/api/storage.md — How settings are persisted to `data.json`.
- docs/modules/context-engine.md — How `maxTokens` and `scoutEnabled` affect traversal.
- docs/auth/security.md — `allowAgentWrites` semantics and CLI validation.
