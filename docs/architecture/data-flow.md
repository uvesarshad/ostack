# Data Flow

> Scope: Full lifecycle of an AI execution turn from command invocation to final output.
> Rendering context: Client
> Project tier: 3
> Last updated: 2026-05-17

## Overview
ogstack features a highly structured data pipeline that coordinates local vault files, a two-stage LLM context assembly, remote Server-Sent Event (SSE) network streams, and local DOM output updates. The execution flows sequentially from a user request, through the context scoring engine, out to the LLM, and back into the editor.

## The Data Pipeline Stages

### Stage 1: User Request Invocation
The pipeline begins when a user runs a gs: command from the Obsidian Command Palette or enters a message (e.g. /skill-name or general chat) into the floating BarChat or Sidebar textarea.
- Symbol: BarChat or OgstackSidebarView captures the text buffer.
- Mention Resolution: If the text contains at-mentions like @[[Note Name]], the mention-resolver.ts reads note files and appends their content blocks into the prompt stream.

### Stage 2: Vault Context Assembly
Before the main LLM executes, the skill-runner.ts requests a context payload from context-builder.ts.
- BFS Traversal: The context engine queries app.metadataCache.resolvedLinks to perform a Breadth-First Search on the note graph, starting at the active file. It caps candidate discovery at 200 nodes.
- Metadata scoring: Each node is assigned a numerical score computed from its link depth and modified by an exponential time decay.
- Context Scout: The scout-context.ts passes the titles and first 200 characters of the top 50 candidates to a cheaper model (default: gemini-2.0-flash-lite).
- Semantic Filtering: The scout returns a JSON array of relevance scores (0.0 to 1.0) and annotations. Candidates with scores greater than or equal to 0.5 are included in full. Candidates scoring under 0.5 are converted to single-line annotations, saving tokens.
- Budgeting: Notes are accumulated in score-descending order until the token budget (default: 6000) is reached. Exceeding notes are discarded entirely to keep context complete.

### Stage 3: Payload Construction and Dispatch
- XML Formatting: The builder formats note contents into clean XML structures, wrapping the active note in active-note tags and linked notes in context tags.
- Framing Protection: Note contents are run through escapeForFraming, replacing framing tags like active-note or context with HTML entities, preventing prompt injection attacks.
- Placeholder Replacement: The prompt loader replaces the double-curly VAULT_CONTEXT placeholder inside the skill prompt with the final XML string.
- Provider Stream: The provider-interface.ts instantiates the appropriate LLMProvider (e.g. ClaudeProvider) and opens a connection, streaming SSE chunks in real time.

### Stage 4: Output Routing
- Output Router: As SSE tokens arrive, the output-router.ts redirects content.
- Inline Output: Inserts streamed text directly at the active cursor position inside the editor.
- New Note Output: Creates a new markdown note in the vault and splits the leaf layout to display it alongside the active note.
- Chat UI Output: appends message blocks into the ChatStore database, notifying the UI to run incremental DOM additions.

## Error Propagation
If the scout model fails or times out (8 seconds ceiling), the pipeline falls back seamlessly to metadata-only scoring without blocking the query. If the main model fails or drops mid-stream, retry.ts initiates a single retry, and if still unsuccessful, propagates a formatted error message to the UI.

## Update Triggers
- When the BFS traversal logic or scoring equation changes in context-builder.ts.
- When the XML context formatting layout is changed.
- When new output targets are added to output-router.ts.

AGENT UPDATE: update docs/architecture/data-flow.md when context builder, providers, or output routing steps are modified.

## Related Docs
- docs/overview.md — Glossary and tech stack.
- docs/modules/context-engine.md — Deep context logic.
- docs/modules/skill-system.md — Custom skills and agent loops.
