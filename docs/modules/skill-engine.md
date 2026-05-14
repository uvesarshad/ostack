# Skill Engine

> **Scope:** Manages the loading, parsing, and execution of AI skills. **Rendering context:** Isomorphic **Last updated:** 2026-05-14

## Overview

The Skill Engine is responsible for bridging the gap between raw SKILL.md files and the LLM execution pipeline. It handles both built-in skills and user-defined custom skills.

## Key Components

### SkillLoader (src/skill-loader.ts)
- Purpose: Discovers and parses SKILL.md files from the vault.
- Responsibilities:
    - Watches the .gstack/skills/ directory for changes.
    - Parses YAML frontmatter to extract skill names and output modes.
    - Registers/unregisters Obsidian commands dynamically based on file presence.
- AGENT NOTE: Hot-reloading has a 300ms debounce to prevent multiple reloads during quick saves.

### SkillRunner (src/skill-runner.ts)
- Purpose: Orchestrates the end-to-end execution of a single skill.
- Responsibilities:
    - Fetches context from the ContextBuilder.
    - Sends context to the ContextScout for re-ranking.
    - Calls the appropriate LLMProvider.
    - Passes resulting tokens to the OutputRouter.

### Built-in Skills (src/builtin-skills.ts)
- Purpose: Defines the set of skills that ship with the plugin by default.
- Examples: Research, Campaign, Plan, Outline, Review.
- AGENT AVOID: Users cannot modify these files directly within the plugin folder; they must create a custom skill with a different name to override behavior.

## Skill Configuration (SKILL.md)

Skills are defined as markdown files with the following structure:
- Frontmatter: name, description, output mode (inline or new-note).
- Body: The system prompt for the LLM, containing the {{VAULT_CONTEXT}} placeholder.

## Related Docs

- docs/modules/context-engine.md — How the {{VAULT_CONTEXT}} placeholder is populated.
- docs/api/llm-providers.md — How the SkillRunner interacts with external APIs.
