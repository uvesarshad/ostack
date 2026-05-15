# Data Flow

> **Scope:** Describes how data enters, transforms, and exits the system. **Rendering context:** Isomorphic **Last updated:** 2026-05-15

## Overview

Data in ogstack flows from the local Obsidian vault through a series of filters and scoring mechanisms before being sent to an external LLM and finally streamed back into the user's document or chat surface. There are two parallel pipelines: the **oneshot skill** pipeline (system prompt + assembled vault context → streamed completion) and the **agent skill** pipeline (Anthropic tool-use loop with vault tools).

## Pipeline 1 — Oneshot Skill Execution

### 1. Trigger
- User invokes a `gs:` command, types `/<skill>` in the bar, or sends a free-text message in the bar/sidebar.
- AGENT OWNER: `src/main.ts` (command registration), `src/bar-chat.ts` (`handleSend`), `src/sidebar-view.ts` (`buildInputArea.send`).

### 2. Context Discovery (BFS)
- `buildVaultContext()` BFS-walks forward links from the active note up to `max_depth` (default 3, ceiling 5).
- Uses `app.metadataCache.resolvedLinks` — no file reads at this stage.
- AGENT OWNER: `src/context-builder.ts`

### 3. Metadata Scoring
- Each candidate scored as `(1/depth) × 0.6 + recencyDecay × 0.4` where `recencyDecay = exp(-daysSince / contextDecayDays)`.
- Hard cap of 200 nodes on the candidate list (`BFS_NODE_CAP`).

### 4. Semantic Re-ranking (Context Scout, optional)
- If `scoutEnabled`, top 50 candidates' title + first 200 chars are sent to the scout model (default `gemini-2.0-flash-lite`) which returns `{path, score, annotation}` per note.
- 8s timeout race — on timeout/failure execution continues with metadata-only scoring.
- Scout can run on a **different provider** than the main one via `scoutProvider` setting (e.g., main = `claude-cli`, scout = Gemini API).
- AGENT OWNER: `src/context-scout.ts`

### 5. Final Assembly
- High-scored notes (≥ 0.5) included in full; low-scored notes appear as their scout annotation only (`summary-only="true"`).
- Notes are wrapped in `<context title="…" score="…" depth="…" annotation="…">…</context>` blocks. The active note gets `<active-note>`.
- **Framing-tag defang:** Note content has literal `</context>`, `<active-note>`, `<mentioned-note>` opens/closes escaped to `&lt;…` to prevent crafted notes from breaking out of their block.
- The skill's system prompt `{{VAULT_CONTEXT}}` placeholder is replaced with the assembled block.
- AGENT OWNER: `src/context-builder.ts` (`formatVaultContext`, `escapeForFraming`).

### 6. Mention Resolution
- `[[Wiki Link]]` references in the user message are resolved to their note content and appended to the system prompt as `<mentioned-note>` blocks for that turn only.
- Same defang applies. Shared between bar and sidebar via `src/mention-resolver.ts`.

### 7. LLM Request
- Provider chosen by `getProvider(settings, cwd)`. The CLI providers receive the vault's basepath as `cwd` so they see the user's notes rather than Obsidian's install dir.
- All API providers go through `fetchWithRetry` which retries once on 429/503 with `Retry-After` honored (10s cap).
- AGENT SEE: docs/api/llm-providers.md

### 8. Output Routing
- For oneshot skills run via `runSkill`: tokens stream into the editor (`inline`) or a newly-created note (`new-note`) via `src/output-router.ts`.
- For chat surfaces: tokens append to an assistant bubble in the bar/sidebar; the final content is persisted via `ChatStore.addMessage`.

## Pipeline 2 — Agent Skill Execution

### 1. Trigger
- User runs a skill with `agent: true` from the bar or command palette. Currently routes only through Claude API (CLI providers run their own native agent loops; other API providers reject with a clear message).

### 2. Vault context assembled the same way as oneshot (steps 2–5 above) and inserted into the system prompt.

### 3. Tool grant resolved from `skill.allowedTools` against `VAULT_TOOLS`. Defaults to all six tools if no allow-list.

### 4. Streaming tool-use round
- `runClaudeAgent` opens a streaming request with `tools` parameter populated.
- Yields `text_delta` events live + buffers `tool_use` blocks.
- On `stop_reason: tool_use`, executes each tool via `executeVaultTool(app, name, input, { allowWrites })`. Write tools refuse if the setting is off.
- Tool results appended as `tool_result` content blocks for the next round.
- Bounded by `max_rounds` (default 10, per-skill override, hard ceiling 40).

### 5. Persistence
- Agent assistant turn persisted with its `toolCalls[]` (`{id, name, input, output, isError}`) alongside the text content in the chat sidecar.
- Session marked sticky with `agentSkillName`; subsequent user messages re-enter the agent loop with the new text as the kickoff message.

## Serialization Boundaries

- **Vault metadata → ScoredFile[]:** `src/context-builder.ts`
- **ScoredFile[] → Scout prompt:** `src/context-scout.ts`
- **VaultContext → XML string:** `src/context-builder.ts` (`formatVaultContext` + `escapeForFraming`)
- **ChatMessage[] → LLMMessage[]:** `src/bar-chat.ts` (`buildLLMHistory`), `src/chat-runner.ts`
- **ChatMessage[] → Markdown sidecar:** `src/chat-store.ts` (`serializeChat`)
- **LLM SSE stream → token strings:** each `src/providers/*.ts`
- **LLM token stream → Editor buffer:** `src/output-router.ts`

## Related Docs

- docs/architecture/execution-model.md — Plugin lifecycle and concurrency model.
- docs/modules/context-engine.md — BFS, scoring, and scout details.
- docs/modules/skill-engine.md — Skill loading, parsing, and tool-use loop.
- docs/api/llm-providers.md — Per-provider streaming and retry behavior.
