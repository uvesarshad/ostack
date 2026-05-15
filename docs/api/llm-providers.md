# LLM Providers

> **Scope:** Details the integration with external AI services. **Rendering context:** Isomorphic **Last updated:** 2026-05-15

## Overview

ogstack supports five HTTP API providers and three subscription CLIs. Every provider implements the `LLMProvider` interface (`stream(request) → AsyncGenerator<string>`); the Claude API provider additionally implements `streamWithTools` for the agent loop. All HTTP providers share a retry helper that handles 429/503 transparently.

## HTTP API Providers

| Provider | Endpoint | Default model | Auth |
|---|---|---|---|
| Claude | `api.anthropic.com/v1/messages` | `claude-sonnet-4-6` | `x-api-key` header |
| OpenAI | `api.openai.com/v1/chat/completions` | `gpt-4o` | Bearer token |
| Gemini | `generativelanguage.googleapis.com/v1beta/models/<model>:streamGenerateContent` | `gemini-2.0-flash` | `?key=` query string |
| Grok / xAI | `api.x.ai/v1/chat/completions` | `grok-2-latest` | Bearer token |
| Ollama | `${host}/api/chat` | `llama3.2` | none (local) |

### Streaming format
- Claude / OpenAI / Gemini / Grok — SSE (`data: {...}\n\n` lines). Each provider parses its own delta shape.
- Ollama — NDJSON (one JSON object per line, no `data:` prefix).

### Timeout / cancellation
- Every API provider wraps its fetch in a 120s `AbortController`. The bar's stop button signal is composed with this internal timeout.
- Claude's `streamWithTools` (used by the agent loop) installs its own 120s timeout AND accepts a caller signal; either source cancels.
- On timeout, `new Error("timeout")` is thrown; on user abort, an `AbortError` propagates so callers can distinguish.

### Retry / backoff (`src/providers/retry.ts`)
- Shared `fetchWithRetry(url, init, options)` helper.
- Retries **once** on HTTP 429 or 503. Other failures propagate immediately.
- Honors `Retry-After: <seconds>` header (capped at 10s); falls back to a 1s default backoff.
- Composable with the caller's `AbortSignal`.

## CLI Providers (`src/providers/cli.ts`)

Three CLI subscriptions are supported. They're spawned as child processes — agents in their own right with native tool access — so ogstack's agent loop short-circuits and the CLI handles tools internally.

| Kind | Binary | Streaming format |
|---|---|---|
| `claude-cli` | `claude` | plain text stdout |
| `codex-cli` | `codex exec --json …` | JSONL events (we extract `item.delta` from `agent_message` items) |
| `gemini-cli` | `gemini` | plain text stdout |

### Hardening
- **`shell: false`** — subprocess args never pass through cmd.exe / sh. PATHEXT resolution (`.cmd` / `.bat` / `.exe`) is performed in-process via `resolveBinary`.
- Settings validation:
  - `cliPath` rejects whitespace and shell metachars (`& | ; ` `` ` `` ` $ < > ( ) { } [ ] \ `).
  - `model` restricted to `[a-zA-Z0-9._:\-/]{1,80}`.
- `cwd` is set to the vault's root so the CLI sees the user's notes, not Obsidian's install dir.

## Provider Interface

```ts
interface LLMRequest {
  systemPrompt: string;
  userMessage?: string;          // single-turn
  messages?: LLMMessage[];       // multi-turn (overrides userMessage)
  model?: string;
}

interface LLMProvider {
  stream(request: LLMRequest): AsyncGenerator<string, void, unknown>;
}
```

Construction is handled by two factories in `provider-interface.ts`:

- `getProvider(settings, cwd?)` — returns the configured main provider.
- `getScoutProvider(settings, cwd?)` — returns the scout provider. If `scoutProvider === "inherit"`, reuses the main provider's credentials with the scout model.

## Manifest Allow-List

`manifest.json` declares `requestUrls` for Obsidian's network sandbox:

```json
"requestUrls": [
  "https://api.anthropic.com",
  "https://api.openai.com",
  "https://generativelanguage.googleapis.com",
  "https://api.x.ai",
  "https://api.github.com",
  "https://raw.githubusercontent.com",
  "http://localhost:11434"
]
```

GitHub URLs cover the skill import command. Localhost covers Ollama.

## Related Docs

- docs/architecture/data-flow.md — How the SkillRunner / AgentLoop picks and drives a provider.
- docs/architecture/execution-model.md — Cancellation semantics and the agent loop.
- docs/auth/security.md — CLI provider hardening details.
- docs/infra/environment.md — Settings shape and key handling.
