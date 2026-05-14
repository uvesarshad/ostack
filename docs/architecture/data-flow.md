# Data Flow

> **Scope:** Describes how data enters, transforms, and exits the system. **Rendering context:** Isomorphic **Last updated:** 2026-05-14

## Overview

Data in ogstack flows from the local Obsidian vault through a series of filters and scoring mechanisms before being sent to an external LLM and finally streamed back into the user's document.

## The Skill Execution Pipeline

### 1. Trigger
- The flow begins when a user invokes a slash command or selects a skill from the command palette.
- AGENT OWNER: src/main.ts (Command registration)

### 2. Context Discovery (BFS)
- The ContextBuilder performs a Breadth-First Search starting from the active note.
- It uses the Obsidian metadataCache to identify linked notes without reading file contents at this stage.
- AGENT OWNER: src/context-builder.ts

### 3. Metadata Scoring
- Notes are scored based on depth (distance from active note) and recency (time since last modification).
- A hard cap of 200 nodes is applied to the candidate list.

### 4. Semantic Re-ranking (Context Scout)
- If enabled, the top 50 candidates are sent to the Context Scout.
- The scout model (gemini-2.0-flash-lite) reads the title and a snippet of each note to provide a relevance score (0.0 to 1.0).
- AGENT OWNER: src/context-scout.ts

### 5. Final Assembly
- The SkillRunner combines the system prompt from the SKILL.md file with the high-scoring notes (formatted in XML-like tags).
- Notes with low scores may only include their scout annotation rather than full content to save tokens.

### 6. LLM Request
- The assembled prompt is sent to the chosen LLMProvider (Claude, OpenAI, etc.).
- The request uses native fetch with streaming enabled.
- AGENT SEE: docs/api/llm-providers.md

### 7. Output Routing
- Tokens are received from the stream and passed to the OutputRouter.
- If the mode is "inline", tokens are inserted into the editor at the cursor position.
- If the mode is "new-note", a new file is created and populated.
- AGENT OWNER: src/output-router.ts

## Serialization Boundaries

- Vault Metadata to Score Object: Happens in src/context-builder.ts.
- Score Object to Scout Prompt: Happens in src/context-scout.ts.
- Assembled Context to LLM Request Body: Happens in src/skill-runner.ts.
- LLM Stream to Editor Buffer: Happens in src/output-router.ts.

## Related Docs

- docs/architecture/execution-model.md — For more on the plugin's lifecycle.
- docs/modules/context-engine.md — For details on the BFS and scoring logic.
