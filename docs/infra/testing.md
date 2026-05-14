# Testing Strategy

> **Scope:** Describes the unit and integration testing approach. **Rendering context:** N/A **Last updated:** 2026-05-14

## Overview

The project uses Vitest for unit and integration testing. Since the code depends heavily on the Obsidian API, which is not available in a standard Node.js environment, the tests use extensive mocking.

## Test Structure

### Unit Tests (src/__tests__/)
- Files are named [module].test.ts and cover the logic of individual components like the ContextBuilder and SkillLoader.
- Provider tests (src/__tests__/providers/) verify that request bodies are formatted correctly and that stream parsing handles edge cases.

### Mocks (src/__mocks__/)
- obsidian.ts: A mock implementation of the Obsidian API, including Workspace, Vault, and MetadataCache classes.
- Native fetch: Mocked to simulate LLM provider responses and streaming behavior.

## Running Tests

- npm run test: Runs all tests once.
- npm run test:watch: Starts the Vitest watcher for TDD.

## AGENT AVOID
Do not use the actual Obsidian API in tests; always use the provided mocks to ensure tests can run in a CI/CD environment without an Electron instance.

## Related Docs

- docs/infra/deployment.md — For the build steps that happen after testing.
- docs/architecture/folder-structure.md — For the location of test files.
