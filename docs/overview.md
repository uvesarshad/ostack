# Project Overview: ogstack

> **Scope:** High-level entry point for the ogstack project. **Rendering context:** Client (Obsidian Plugin) **Last updated:** 2026-05-14

## Overview

ogstack is a vault-aware skill system for Obsidian that allows users to run AI-powered "skills" directly on their local notes. It leverages the Obsidian metadata graph to build context for LLMs, supporting multiple providers like Claude, OpenAI, Gemini, and Ollama. The project is built with TypeScript and follows a modular architecture for context assembly, skill execution, and streaming output.

## Tech Stack

- Core: TypeScript
- Platform: Obsidian Plugin API
- Build: esbuild
- Testing: Vitest
- LLM Integration: Native fetch API with Server-Sent Events (SSE) for streaming
- State Management: Simple store patterns for settings and chat history

## Directory Map

### ARCHITECTURE
- docs/architecture/execution-model.md — Describes the plugin lifecycle and command registration within Obsidian.
- docs/architecture/data-flow.md — Maps the journey from vault traversal to LLM response streaming.
- docs/architecture/folder-structure.md — Explains the purpose of each top-level directory and naming conventions.

### MODULES / FEATURES
- docs/modules/skill-engine.md — Covers the skill loader, built-in skills, and custom SKILL.md parsing.
- docs/modules/context-engine.md — Details BFS traversal, metadata scoring, and the Context Scout semantic re-ranker.
- docs/modules/ui-system.md — Describes the sidebar, floating input, and various Obsidian modals.

### API & DATA
- docs/api/llm-providers.md — Lists supported LLM providers and their specific implementation details.
- docs/api/storage.md — Explains how settings and metadata are handled using Obsidian's internal storage.

### INFRASTRUCTURE & CONFIG
- docs/infra/environment.md — Lists required settings and API key handling.
- docs/infra/deployment.md — Describes the build process and plugin distribution format.
- docs/infra/testing.md — Outlines the Vitest-based testing strategy and mock environment.

## Key Architectural Decisions

- Vault-Aware BFS Traversal: The system uses Obsidian's resolvedLinks to find context instead of a vector database, prioritizing depth and recency.
- Context Scout Optimization: A secondary, cheaper model (e.g., gemini-2.0-flash-lite) is used to prune the context before the primary model runs.
- Stream-to-Editor: Output is streamed directly into the Obsidian editor via per-note mutexes to prevent concurrent write collisions.
- No-Dependency Streaming: Uses native fetch and TextDecoder to handle SSE, avoiding heavy external SDKs.

## Cross-Cutting Concerns

- Auth Strategy: API keys are stored in plaintext in the plugin's data.json within the vault (Obsidian standard).
- Error Handling: Uses Obsidian Notices for user-facing errors and console logging for debugging.
- Styling: Leverages Obsidian's internal CSS variables for native look-and-feel.

## Glossary

- Skill: A markdown-based prompt template (SKILL.md) that defines a specific AI task.
- Context Scout: A model used to semantically score notes before they are included in the final LLM prompt.
- Vault Context: The assembled XML-like block containing the content of relevant notes.
- Per-Note Mutex: A locking mechanism that prevents multiple skills from writing to the same note simultaneously.

## Related Docs

- docs/how-to-update-docs.md — Rules for maintaining this documentation.
