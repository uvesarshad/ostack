# Context Engine

> **Scope:** Handles vault traversal, note scoring, and semantic re-ranking. **Rendering context:** Isomorphic **Last updated:** 2026-05-14

## Overview

The Context Engine is the core differentiator of ogstack. It turns a flat list of notes into a structured, semantically relevant knowledge base for the LLM.

## Key Components

### ContextBuilder (src/context-builder.ts)
- Purpose: Performs the initial BFS traversal and metadata-based scoring.
- Responsibilities:
    - Uses app.metadataCache.resolvedLinks to expand the search graph.
    - Applies a scoring formula based on depth and recency (mtime).
    - Prevents cycles using a Visited set.
    - Limits traversal to a hard cap of 200 nodes.
- AGENT NOTE: This component does not read file contents; it only uses metadata to keep the initial pass fast.

### ContextScout (src/context-scout.ts)
- Purpose: Provides a secondary, semantic pass over the top 50 candidates.
- Responsibilities:
    - Reads the title and the first 200 characters of each candidate note.
    - Sends this "catalog" to a cheap LLM model (e.g., gemini-2.0-flash-lite).
    - Receives a relevance score (0.0 to 1.0) and a one-line annotation per note.
- AGENT AVOID: If the scout times out (default 8s), the system falls back to the metadata scores alone to ensure the user isn't stuck waiting.

## Context Formatting (VaultContext)

The final context is assembled into an XML-like format:
- <active-note>: Full content of the currently open note.
- <context>: Full content of high-scoring notes (score >= 0.5).
- <context summary-only="true">: Scout annotations only for lower-scoring notes to conserve tokens.

## Related Docs

- docs/architecture/data-flow.md — High-level overview of the pipeline.
- docs/api/llm-providers.md — Details on the models used for scouting.
