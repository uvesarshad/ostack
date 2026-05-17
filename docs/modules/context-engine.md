# Context Engine

> Scope: Vault note graph Breadth-First Search, modification time decay equations, semantic re-ranking, and XML security.
> Rendering context: Client
> Project tier: 3
> Last updated: 2026-05-17

## Overview
The Context Engine is the core retrieval component of ogstack. It gathers knowledge from the user's vault relative to their active note, scores and ranks notes using topological distance and temporal relevance, semantically scores note previews via a cheap LLM, and formats the output into secure XML payloads.

## Key Modules and Functions
- buildVaultContext: The orchestrator function defined in context-builder.ts. It executes BFS traversals, calculates relative metadata decay scores, manages file reads, and enforces token budgets.
- scoutContext: Defined in context-scout.ts. Coordinates semantic ranking, compiles scout prompts, and parses JSON output from the scout LLM.
- formatVaultContext: Renders the final XML-formatted string, combining notes into active-note and context blocks.
- escapeForFraming: Defangs framing tags inside note bodies to protect the system from prompt injection attacks.

## Note Graph BFS Traversal
- Discovery: Starting at the active note's path, the engine reads resolved link connections from app.metadataCache.resolvedLinks.
- Graph depth: Traverses forward links up to the skill's max_depth frontmatter override (hard ceiling: 5 hops).
- Node capping: Keeps total queue traversal bounded at 200 notes (BFS_NODE_CAP) to protect memory on large vaults.

## Metadata Decay scoring
For discovered candidates, the engine calculates a priority score using:
- Link depth: Expressed as 1 / depth. Makes up 60 percent of the metadata weight.
- Recency: calculated from file.stat.mtime (epoch timestamp). Compiles a decay factor: exp(-daysSince / decayDays), representing 40 percent of the metadata weight.
- Sorting: Discovered files are sorted in descending order based on this score.

## Context Scout Semantic Re-ranking
If the scout model is enabled:
- Candidate Limit: Takes the top 50 metadata-scored candidate notes.
- Preview compile: Reads the note titles and the first 200 characters of each note body.
- Scout model prompt: Packages previews and prompt rules, asking a cheap LLM (default: gemini-2.0-flash-lite) to return a JSON array containing relevance scores (0.0 to 1.0) and one-line annotations.
- Time limit: Races the LLM stream collection against an 8-second timeout timer (SCOUT_TIMEOUT_MS). If the scout fails or times out, the system falls back seamlessly to BFS scores.
- Applying Scores: candidates with relevance scores greater than or equal to 0.5 are included in full. Candidates scoring under 0.5 are kept as single-line annotations, omitting the file content.

## Token Budget Enforcement
- Token estimation: Characters are converted to tokens using a fast character count heuristic: characters divided by 4, rounded up.
- Active Note Priority: The active note is always loaded in full.
- File Budgeting: Linked notes are loaded in score-descending order. The budget budget represents 80 percent of the user's configured token budget. If a file's tokens exceed the remaining budget, the file is dropped entirely to maintain note integrity.

## Security Defanging
Before note content is written to the XML output, it is passed through escapeForFraming. A regular expression searches for framing tags (e.g. context, active-note, mentioned-note) and escapes their opening angle brackets. This blocks nested tag injection without mangling legitimate markdown.

## Update Triggers
- When the BFS note graph parser or maximum depth constants are changed.
- When the time decay equation or weighting ratios are refactored.
- When the Context Scout preview character caps or LLM prompts are altered.

AGENT UPDATE: update docs/modules/context-engine.md when BFS, scoring, Context Scout, or security escaping modules change.

## Related Docs
- docs/overview.md — Central index.
- docs/architecture/data-flow.md — High-level pipeline.
- docs/modules/skill-system.md — Loading skills.
