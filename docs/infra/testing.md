# Testing Strategy

> **Scope:** Unit + integration testing approach. **Rendering context:** N/A **Last updated:** 2026-05-15

## Overview

The project uses Vitest for unit and integration testing. Tests run in a JSDOM-backed Node environment with a hand-rolled Obsidian API mock — no Electron, no real vault, no network. Current count: **225 tests across 21 files**.

## Test Structure

### Unit tests (`src/__tests__/`)
| File | Surface |
|---|---|
| `agent-loop.test.ts` | Streaming tool-use loop, round limits, write-gate refusal, abort. |
| `bar-chat.test.ts` | Pure-logic helpers: `extractAsks`, `stripAsks`, `formatToolInput`, truncation, `isLocalOrCliProvider`, `formatProviderError`. |
| `chat-store.test.ts` | Sidecar markdown serialization, round-trip, legacy `data.json` migration, sticky agent. |
| `context-builder.test.ts` | BFS, scoring, token budget, framing-tag defang. |
| `context-scout.test.ts` | Scout result parsing, threshold-based summary-only mode. |
| `import-skill-modal.test.ts` | `isSafeSkillName` path-traversal validator. |
| `main.test.ts` | Plugin lifecycle and command registration. |
| `mention-resolver.test.ts` | `[[Wiki Link]]` resolution + dedupe + framing defang. |
| `output-router.test.ts` | Inline vs new-note routing. |
| `sidebar-view.test.ts` | `relativeTime` formatter. |
| `skill-loader.test.ts` | YAML parsing, `max_rounds` clamping, frontmatter edge cases. |
| `vault-tools.test.ts` | Each tool's behavior plus the write-gate. |
| `yaml-mini.test.ts` | Frontmatter parser (quotes, comments, duplicate keys, etc.). |

### Provider tests (`src/__tests__/providers/`)
| File | Surface |
|---|---|
| `claude.test.ts` | SSE parsing, `streamWithTools`, timeout, caller-abort. |
| `cli.test.ts` | `isSafeCliPath`, `isSafeModelName`, `buildPrompt`, `buildArgs`. |
| `gemini.test.ts`, `openai.test.ts`, `ollama.test.ts`, `grok.test.ts` | SSE / NDJSON parsing, error shapes, auth headers. |
| `provider-interface.test.ts` | `getProvider` + `getScoutProvider` factories, including `scoutProvider: "inherit"` semantics. |
| `retry.test.ts` | `fetchWithRetry` honoring `Retry-After`, 429/503 only, max-retries cap. |

### Mocks (`src/__mocks__/obsidian.ts`)
- Provides `App`, `Vault`, `MetadataCache`, `Plugin`, `PluginSettingTab`, `Setting`, `Notice`, `Modal`, `TFile`, `TFolder`, `MarkdownView`, `WorkspaceLeaf`, `ItemView`, `requestUrl`, etc.
- Each setter / button / dropdown returns a chainable stub. Components return a minimal `HTMLElement`-like object.

## Patterns

### Mocking fetch
```ts
vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
```

For SSE streams, use a `ReadableStream` controller:
```ts
function makeSSEStream(events: string[]): Response {
  const body = events.join("\n") + "\n";
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}
```

### Testing AsyncGenerators
```ts
async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
```

### Fake timers for retry / timeout tests
```ts
vi.useFakeTimers();
// kick off the async operation
const p = fn();
// register the assertion BEFORE advancing time (avoids PromiseRejectionHandled warnings)
const assertion = expect(p).rejects.toThrow("timeout");
await vi.advanceTimersByTimeAsync(120_001);
await assertion;
```

## Running Tests

```bash
npm test                       # 161 tests
npm run test:watch             # vitest watcher for TDD
npx vitest run --reporter=basic # quieter output
```

## What's NOT Tested

- **DOM flows in `bar-chat.ts` and `sidebar-view.ts`** — class methods that touch the DOM, suggest popups, scroll behavior. Pure-logic helpers from both are unit-tested; full DOM flows would need Playwright.
- **`floating-input.ts`, `welcome-modal.ts`, `manage-skills-modal.ts`** — visual-only modals.
- **`cli.ts` subprocess spawning** — validators, `buildPrompt`, `buildArgs` are unit-tested. End-to-end CLI testing requires the actual binaries installed.
- **`chat-runner.ts`** — exercised indirectly via integration paths; no direct unit tests.

## AGENT AVOID

Do NOT use the actual Obsidian API in tests; always use `src/__mocks__/obsidian.ts`. Tests must be hermetic so they run in CI without an Electron instance.

## Related Docs

- docs/infra/deployment.md — Build steps after testing.
- docs/architecture/folder-structure.md — Test file locations.
