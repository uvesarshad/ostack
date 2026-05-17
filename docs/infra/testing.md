# Testing Strategy

> Scope: Test organization, frameworks, and verification commands.
> Rendering context: N/A
> Project tier: 3
> Last updated: 2026-05-17

## Overview
ogstack has a comprehensive test suite of 225 unit and integration tests driven by the Vitest testing framework. Because the plugin runs inside Obsidian's closed Electron environment, testing uses a mocked DOM container (JSDOM) and mock interfaces to validate core logic, state shifts, and parsing rules without opening a physical editor.

## Test Commands
- Run all tests once: npm run test
- Run tests in watch mode: npm run test:watch
These scripts are defined in package.json and execute the Vitest test runner.

## Frameworks and Setup
- Test Runner: Vitest
- DOM Mocking: JSDOM via jsdom and types package
- Configurations: vitest.config.ts registers JSDOM and handles TypeScript compiling

## Test Layout and Mocks
Tests live in the src/__tests__ folder.
- src/__tests__/__mocks__: Contains mock objects and implementations for Obsidian API classes. This includes mock Obsidian App, Vault, Workspace, Leaf, and Component implementations to isolate test logic from runtime internals.
- Logic Test Boundaries: Full visual operations (such as actual editor layouts in bar-chat.ts or sidebar-view.ts) are deferred from active unit testing as they require a browser-driven Playwright harness. Mocks focus instead on pure logic helpers, string extractors, prompts builders, and model parsing.

## Coverage Areas
- Providers: src/__tests__/providers contains dedicated unit tests covering Claude, OpenAI, Gemini, Grok, Ollama, CLI, retry handlers, and interfaces.
- Core Utilities: Test files like yaml-mini.test.ts and mention-resolver.test.ts cover specific parsing functions.
- State: chat-store.test.ts validates sidecar loading, migrations, additions, updates, and deletes.
- Context and Agent: context-builder.test.ts and agent-loop.test.ts assert correct scoring, caps, timeouts, and sequential rounds.

## Update Triggers
- When the testing framework changes from Vitest to another library.
- When new mock objects are added to src/__tests__/__mocks__.
- When directories or test filenames are restructured.

AGENT UPDATE: update docs/infra/testing.md when test configurations or test structures change.

## Related Docs
- docs/overview.md — General tech stack.
- docs/infra/environment.md — Environments and variables.
