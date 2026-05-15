# Context Engine

> **Scope:** Handles vault traversal, note scoring, and semantic re-ranking. **Rendering context:** Isomorphic **Last updated:** 2026-05-15

## Overview

The Context Engine turns a flat list of notes into a structured, semantically relevant knowledge base for the LLM. It runs in two stages — fast metadata scoring (no I/O) followed by an optional semantic pass — and finishes by assembling the result into a defanged XML-tagged block.

## Key Components

### ContextBuilder (`src/context-builder.ts`)
- Performs BFS traversal from the active note via `app.metadataCache.resolvedLinks` (no file reads in the traversal step).
- Scores each candidate: `(1/depth) × 0.6 + exp(-daysSince / contextDecayDays) × 0.4`.
- Hard caps:
  - `MAX_DEPTH_CEILING = 5` (skill's `max_depth` is clamped here)
  - `BFS_NODE_CAP = 200`
- Sorts candidates by score descending, then reads file contents in parallel via `Promise.allSettled(cachedRead(...))`.
- Token budget enforcement: notes are accumulated whole until the budget is exhausted. Files are dropped, never truncated.
- AGENT NOTE: The active note is **always** included in full, regardless of budget.

### ContextScout (`src/context-scout.ts`)
- Optional semantic re-rank pass (toggle via `scoutEnabled` setting; recommended on).
- Reads title + first 200 chars of top 50 candidates, sends as a single prompt to a cheap scout model.
- Returns `[{path, score, annotation}]`. Notes scoring ≥ 0.5 are kept in full; lower-scored notes are represented by the scout's one-line annotation only (`summary-only="true"`).
- 8s timeout race — on timeout/error, falls back silently to metadata-only scoring.
- Scout can run on a **different provider** than the main one via `scoutProvider` setting. Common pattern: main = `claude-cli` (subscription), scout = Gemini API (cheap, fast).

### Mention Resolver (`src/mention-resolver.ts`)
- Per-turn helper. Scans the user's message for `[[Wiki Link]]` references (and `[[Note|alias]]`), dedupes, reads each referenced note, and wraps in `<mentioned-note title="…">…</mentioned-note>` blocks appended to the system prompt.
- Used by both bar (`bar-chat.ts`) and sidebar (`chat-runner.ts`) so behavior is identical across surfaces.

## VaultContext Format

The assembled string is wrapped in XML-like tags inside the skill's system prompt:

```xml
<active-note title="Q3 Plan">
[full content of the active note]
</active-note>

<context title="Customer Interviews" score="0.91" depth="1" annotation="Scout: highly relevant — contains ICP data">
[full content]
</context>

<context title="Old Notes" score="0.23" depth="2" annotation="Scout: low relevance — outdated 2023 data" summary-only="true">
Scout: low relevance — outdated 2023 data
</context>
```

### Framing-tag defang

Note content is passed through `escapeForFraming(content)` before interpolation. This replaces literal opening/closing instances of `<context>`, `<active-note>`, `<mentioned-note>` (and their close tags) with `&lt;context>` etc. — preventing a crafted linked note from breaking out of its block to inject instructions.

Legitimate HTML embeds (`<details>`, `<br>`, `<summary>`) are **not** escaped; only the four framing tag names are defanged.

## Token Estimation

`estimateTokens(text) = Math.ceil(text.length / 4)` — a cheap heuristic, no tokenizer dependency. The 80% budget rule (`tokenBudget = floor(maxTokens * 0.8)`) reserves headroom for the system prompt and conversation history.

## Related Docs

- docs/architecture/data-flow.md — End-to-end pipeline.
- docs/modules/skill-engine.md — How `{{VAULT_CONTEXT}}` substitution happens at skill-run time.
- docs/api/llm-providers.md — Scout vs main provider configuration.
