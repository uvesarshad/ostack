# Changelog

All notable changes to ogstack will be documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-05-20

First public release.

### Conversation surfaces

- Floating bar (Ctrl/Cmd+Shift+Space) for ad-hoc chat with vault context
- Right-sidebar view with full session history, sharing the exact same chat
  engine as the floating bar — agents, ASK widgets, compaction, and the
  Insert / Append / Copy / Save-to-note actions are available in both
- Resizable floating bar, drag-to-reposition from the toolbar, geometry
  persisted across sessions
- Per-note chat sessions stored under `_agent/chats/`, durable across
  reloads, with cross-surface sync

### Skills

- Built-in gstack skills plus a `_agent/` folder for custom SKILL.md files
- Flat (`_agent/name.md`) and folder (`_agent/name/SKILL.md`) layouts both
  supported
- `/<skill-name>` slash invocation in the chat input with live suggestions
- Agent skills run the Claude API tool loop with vault read/write tools
  (write-access opt-in via Settings)
- Interactive `<ASK>` protocol — questions render as textareas, radio
  buttons, or checkboxes with an automatic "Other" row. Markdown rendered
  in question text. Enter submits.
- Import from GitHub: paste a repo URL to scan + pick, or a `/blob/` URL
  for a single file
- Import from disk: file picker accepts one or many local SKILL.md files
- Hyphenated frontmatter aliases (`allowed-tools`, `max-rounds`, …) so
  community SKILL.md files work without rewriting

### Providers

- Hosted APIs: Anthropic Claude, OpenAI, Google Gemini, xAI Grok
- Local / CLI: Ollama, Claude Code CLI, Codex CLI, Gemini CLI
- Per-skill provider override via frontmatter
- Pre-flight check for CLI providers with a clear error when the binary
  isn't on PATH (the #1 source of "works in terminal but not Obsidian")

### Context

- Vault-aware system prompt assembled from the active note's linked notes
  out to a configurable depth
- Token-budget aware: drops the least-relevant candidates first
- Optional context scout (separate provider call to rank candidate notes
  for relevance before they reach the main prompt)
- `@[[Note]]` mentions resolve to the actual note content per turn

### Long-conversation handling

- Token-estimate banner prompts to compact when the chat passes the
  configured threshold (default 8k tokens)
- Compaction preserves the last two turns verbatim, summarizes everything
  before via the active provider, and stores the summary as a leading
  assistant message so the next turn picks up coherently
- Agent tool calls survive compaction as inline `[tool: …]` lines so the
  agent doesn't re-discover the same notes

### Security

- CLI provider arguments and binary paths validated against shell
  metacharacters, never passed through a shell
- Skill names validated against a tight charset before becoming file paths
  (no traversal via frontmatter)
- API keys stored in Obsidian plugin data (encrypted by the user's vault
  setup, never logged)
- Optional opt-in for agent write access to the vault

### Documentation

- README with story, features, quickstart, and skill format reference
- AGENTS.md / SECURITY.md alongside in-repo CLAUDE.md technical docs
