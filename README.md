# ogstack

Use AI skills directly in Obsidian — brainstorm ideas, build plans, do market research, write content, and more. Your linked notes become the context automatically.

Built by [Uves Arshad](https://x.com/uvesarshad) · [X](https://x.com/uvesarshad) · [LinkedIn](https://linkedin.com/in/uvesarshad)

---

## Screenshots

<p>
  <img src="public/ogstack-screenshot-1.jpg" width="33%">
  <img src="public/ogstack-screenshot-2.jpg" width="33%">
  <img src="public/ogstack-screenshot-3.jpg" width="33%">
</p>

<p>
  <img src="public/ogstack-screenshot-4.jpg" width="49%">
  <img src="public/ogstack-screenshot-5.jpg" width="49%">
</p>

---

## The story

I wanted to use gstack and other AI skills for brainstorming sessions, research, and writing directly inside Obsidian. The problem: skills only worked in the CLI or inside an IDE — not in a note-taking app where the thinking actually happens.

I posted about it to see if others felt the same way.

<p>
  <img src="public/original-tweet-x-post-by-uves-arshad-about-gstack.jpg" width="45%" alt="Original tweet">
  <img src="public/garry-tan-repost.jpg" width="45%" alt="Garry Tan repost">
</p>

So I built and shipped v1 in the next 48 hours.

---

## Roadmap

- [x] Skills system with all built-in gstack skills
- [x] Custom skills — drop a `SKILL.md` in your vault, get a command
- [x] Multi-provider support — Claude, OpenAI, Gemini, Grok, Ollama
- [x] CLI provider access — run via Claude Code, Codex, or Gemini CLI subscription
- [x] Agent skills with vault read/write tools
- [x] Interactive skills with `<ASK>` protocol
- [x] Import skills from GitHub or local disk
- [x] Floating bar + sidebar chat surfaces
- [x] Published to Obsidian community plugins
- [ ] Plugin name finalisation
- [ ] Mobile support (iOS & Android)
- [ ] Skill marketplace / community hub
- [ ] Voice input

---

## What is gstack

[gstack](https://github.com/garrytan/gstack) is an open-source project by [Garry Tan](https://github.com/garrytan) — 23+ specialist AI skills for developer workflows, defined as simple `SKILL.md` files and run from the command line via Claude Code.

Each skill is a markdown file with a YAML frontmatter header and a system prompt. The format is human-readable, version-controllable, and composable. ogstack takes that same format and brings it natively into Obsidian — no CLI, no terminal, no copy-paste. Your vault notes replace the codebase as the context source.

---

## What it does

Open any note, hit `Cmd/Ctrl+P`, type `gs:` — and run a skill. The plugin walks your note graph, scores linked notes by relevance and recency, assembles them into a context window, and streams the output back into your note.

No copy-paste. No context switching. The AI already knows what you know.

**Built-in skills**

| Command | What it does |
|---|---|
| `gs: Research` | Synthesizes linked notes into a structured research brief |
| `gs: Campaign` | Turns product and audience notes into a full campaign plan |
| `gs: Plan` | Drafts a project or sprint plan from goals and context notes |
| `gs: Plan Interactive` | Same as `/plan` but asks clarifying questions if scope is ambiguous |
| `gs: Outline` | Builds a document outline from linked research |
| `gs: Review` | Editorial critique and improvement suggestions for the active note |
| `gs: Summarize` | One-paragraph distillation of the active note |
| `gs: Vault Agent` | Tool-using agent that explores and (opt-in) edits the vault |

**Custom skills** — drop a `SKILL.md` file into `_agent/your-skill/` inside your vault (or use the flat form `_agent/your-skill.md`) and it registers as a live `gs:` command within 2 seconds. No restart, no code, no CLI required. You can also import skills from any GitHub repo via Command Palette → **ogstack: Import skill from GitHub**.

---

## How the models work

ogstack uses a **two-model pipeline** on every skill run.

### Main model

The main model is your primary LLM — Claude, GPT-4o, Gemini, a local Ollama model, or a CLI subscription (Claude Code, Codex, Gemini CLI). It receives the full assembled vault context and your skill's system prompt, then streams the response directly into your note.

API providers (Claude, OpenAI, Gemini, Grok, Ollama) stream token-by-token so output appears in real time. CLI providers (`claude-cli`, `codex-cli`, `gemini-cli`) spawn a subprocess and stream from stdout — useful if you already have a Claude Code or Codex subscription and don't want to manage API keys separately.

You configure which model in Settings → ogstack → Provider.

### Context Scout

Before the main model runs, a fast cheap model (default: `gemini-2.0-flash-lite`) reads just the **title + first 200 characters** of the top 50 linked note candidates and scores each one for relevance to your active note (0.0 – 1.0). This takes ~2–5 seconds and costs fractions of a cent.

Notes scoring **≥ 0.5** are included in full in the context window. Notes scoring **< 0.5** are represented by the scout's one-line annotation only — preserving their signal without burning tokens on content that doesn't matter.

If the scout times out (8s hard limit) or fails, execution continues with metadata-only scoring. It never blocks the skill.

You can disable the Scout or change the scout model in Settings → ogstack → Context section.

---

## Architecture

```mermaid
flowchart TD
    User([User: Cmd+P → gs: Research]) --> CMD[Command Palette]
    CMD --> SR[skill-runner.ts\nOrchestrator]

    SR --> CB[context-builder.ts\nbuildVaultContext]
    CB -->|BFS via resolvedLinks| MC[(metadataCache\ngraph)]
    CB -->|cachedRead per level| VF[(Vault files)]
    CB -->|score = depth × 0.6 +\nrecency × 0.4| SC[Scored candidates]
    SC --> CS[context-scout.ts\nSemantic re-ranking]
    CS -->|title + 200 chars\nof top 50 candidates| SP[Scout model\ngemini-flash-lite]
    SP -->|scores 0.0–1.0\n+ annotations| CS
    CS -->|high score → full body\nlow score → annotation only| CTX[VaultContext\nXML-tagged]

    SR --> CTX
    CTX --> SKL[skill-loader.ts\nSKILL.md → systemPrompt\nwith VAULT_CONTEXT replaced]
    SKL --> PRV[providers/]
    PRV --> CL[claude.ts\nfetch + SSE]
    PRV --> OA[openai.ts\nfetch + SSE]
    PRV --> GM[gemini.ts\nfetch + SSE]
    PRV --> OL[ollama.ts\nrequestUrl\nnon-streaming]

    CL -->|token stream| OR[output-router.ts]
    OA -->|token stream| OR
    GM -->|token stream| OR
    OL -->|single chunk| OR

    OR -->|inline| ED[editor.replaceRange\nat cursor]
    OR -->|new-note| NN[vault.create\n+ split leaf]

    style User fill:#7c3aed,color:#fff
    style CTX fill:#0f766e,color:#fff
    style OR fill:#b45309,color:#fff
```

### Key design decisions

**No external LLM SDKs.** All provider calls use Obsidian's built-in `requestUrl()` (Ollama) or native `fetch()` (Claude, OpenAI, Gemini). `main.js` stays under 500 KB.

**Two-stage context pipeline.** BFS metadata scoring runs first (fast, no I/O). The scout model then re-ranks the top 50 candidates semantically. If the scout times out or fails, execution continues with metadata scoring only — it never blocks the skill.

**Per-note mutex.** Inline output to the same note is serialized. New-note output can run in parallel — separate targets, no conflict.

**SKILL.md format.** Each skill is a folder with one file. The folder name becomes the command. `{{VAULT_CONTEXT}}` is the only required placeholder. Custom skills hot-reload on save.

---

## Install

### Option 1: Community Plugin (recommended)

1. Open Obsidian → Settings → Community plugins → Browse
2. Search for **ogstack**
3. Click Install, then Enable

### Option 2: Via BRAT (beta)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the community plugins
2. In BRAT settings → Add Beta Plugin → paste `https://github.com/uvesarshad/ostack`
3. Enable **ogstack** in Settings → Community Plugins

### Option 3: Manual install

1. Download `main.js`, `manifest.json`, `styles.css` from the latest [GitHub Release](../../releases)
2. Copy them into `.obsidian/plugins/ogstack/` in your vault (create the folder if it doesn't exist)
3. Enable the plugin in Settings → Community Plugins

---

## Setup

1. Go to **Settings → ogstack**
2. Choose your AI provider (Claude, OpenAI, Gemini, Grok, Ollama, or a CLI subscription)
3. Paste your API key (or set the CLI binary path for CLI providers)
4. Open a note with linked notes and run `gs: Research`

Supported providers:

| Provider | Default model | Key required |
|---|---|---|
| Claude | claude-sonnet-4-6 | Yes — [anthropic.com/api](https://anthropic.com/api) |
| OpenAI | gpt-4o | Yes — [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Gemini | gemini-2.0-flash | Yes — [aistudio.google.com](https://aistudio.google.com) |
| Grok (xAI) | grok-2 | Yes — [console.x.ai](https://console.x.ai) |
| Ollama | llama3.2 | No — runs locally |
| Claude CLI | (via claude-code) | No — uses your Claude Code subscription |
| Codex CLI | (via codex) | No — uses your OpenAI subscription |
| Gemini CLI | (via gemini) | No — uses your Google subscription |

> **Security notice:** API keys are stored in plaintext at `.obsidian/plugins/ogstack/data.json` inside your vault. Obsidian Sync excludes plugin data by default, but third-party sync (Git, Dropbox, iCloud, etc.) will carry the key — exclude this file if you share the vault.
>
> **Agent writes are disabled by default.** Skills with `mode: agent` get read tools (`read_note`, `list_notes`, `search_vault`, `get_active_note`) but their `write_note` and `append_note` calls return an error unless you opt in via Settings → ogstack → Agent safety → "Allow agent file writes". A prompt-injected agent should not silently modify your vault.
>
> **CLI provider hardening.** When using `claude-cli` / `codex-cli` / `gemini-cli`, the spawned subprocess runs with `shell: false`. Spaces and shell metacharacters in the CLI path or model name are rejected at the settings layer.

---

## Writing skills in your vault

Skills live inside your vault — no CLI, no code editor required. The plugin watches the `_agent/` folder and registers every valid `SKILL.md` as a `gs:` command automatically.

### Folder structure

```
YourVault/
└── _agent/
    ├── competitor-analysis/
    │   └── SKILL.md
    ├── weekly-review/
    │   └── SKILL.md
    ├── pitch-deck/
    │   └── SKILL.md
    └── quick-summary.md          ← flat form also supported
```

Each subfolder becomes one command, named after its folder. You can also drop a single `_agent/your-skill.md` file (flat form) — the file's `name:` frontmatter field is the command slug.

### SKILL.md format

```markdown
---
name: competitor-analysis
description: Summarise competitor notes into a structured comparison
output: inline
max_depth: 3
max_tokens: 6000
---

You are a senior product strategist. The user's competitor research notes are below.

{{VAULT_CONTEXT}}

Produce a structured competitor analysis with:
- A comparison table (player, positioning, pricing, strengths, weaknesses)
- Key strategic gaps you can exploit
- One-paragraph recommendation

Only use facts from the notes. Do not invent data.
```

Save the file. The command `gs: Competitor Analysis` appears in the palette within 2 seconds.

### SKILL.md fields

| Field | Required | Default | Description |
|---|---|---|---|
| `name` | yes | — | Command slug — lowercase, hyphen-separated. Must be unique. |
| `description` | yes | — | Shown below the command name in the palette |
| `output` | no | global setting | `inline` inserts at cursor · `new-note` creates a linked note |
| `max_depth` | no | `3` | How many link-hops to walk from the active note (max 5) |
| `max_tokens` | no | global setting | Token budget for linked notes (active note always included in full) |
| `mode` | no | `oneshot` | `oneshot` or `interactive` (latter can pause with `<ASK>…</ASK>` tags to ask clarifying questions) |
| `agent` | no | `false` | When `true`, runs through Claude's tool-use loop with vault tools |
| `allowed_tools` | no | all tools | Allow-list for agent skills: `[read_note, search_vault, …]` |
| `max_rounds` | no | `10` | Agent tool-call ceiling (hard cap 40). Higher = more tool rounds before bail. |

### The `{{VAULT_CONTEXT}}` placeholder

This is where your vault notes are injected. The plugin replaces it with an XML-structured block:

```xml
<active-note title="Q3 Product Launch">
[full content of the note you're in]
</active-note>

<context title="Customer Interviews" score="0.91" depth="1" annotation="Scout: highly relevant — contains ICP data">
[full content]
</context>

<context title="Old Competitor Notes" score="0.23" depth="2" annotation="Scout: low relevance — outdated 2023 data" summary-only="true">
Scout: low relevance — outdated 2023 data
</context>
```

High-scored notes (≥ 0.5) are included in full. Low-scored notes appear as their scout annotation only.

### Output modes

**`output: inline`** — tokens stream into the active note at your cursor position in real time.

**`output: new-note`** — a new note is created in the same folder as the active note, named `[Active Note] — [Skill Name].md`, and opened in a split pane.

The `output:` field in `SKILL.md` overrides the global default in Settings → ogstack → Default output mode.

### Name collisions

If a custom skill has the same `name` as a built-in skill (`research`, `campaign`, `plan`, `outline`, `review`), the custom skill is skipped and a notice is shown. Rename the custom skill's `name` field to resolve it.

### Agent skills (tool-using)

In addition to the one-shot prompt-stuffing skills above, ogstack ships an experimental **agent** skill: `/vault-agent`. Agent skills run on Claude's tool-use API and can call vault tools in a loop until they reach an answer:

- `list_notes(folder?)` — list markdown files in a folder
- `read_note(path)` — full contents of a single note
- `search_vault(query)` — case-insensitive substring search across notes
- `get_active_note()` — path + contents of the currently open note
- `append_note(path, content)` — append (gated by **Agent safety** setting)
- `write_note(path, content)` — create/overwrite (gated by **Agent safety** setting)

Define an agent skill in your own `_agent/<name>/SKILL.md` by adding `agent: true` and (optionally) an `allowed_tools` allow-list and `max_rounds` ceiling:

```markdown
---
name: brief-from-tag
description: Read all notes tagged with the given tag and summarise
agent: true
allowed_tools: [list_notes, read_note, search_vault]
max_rounds: 20
---

You are a research assistant. Use the tools to find every note that mentions
the tag the user gives, read them, and synthesise a one-page brief…
```

`max_rounds` caps how many tool-use turns the agent can take before the loop bails (default 10, hard ceiling 40). Use a higher value for skills that fan out across many notes.

**Agent skills are conversational.** Once you run an agent skill in a chat, follow-up messages in that same chat continue the agent loop — the agent keeps its system prompt and tools across turns and can refer back to what it already explored. The title bar shows `· agent: /skill-name` while a session is sticky-agent. Click **+ New chat** to leave agent mode.

Agent skills require the Claude API provider (or claude-cli / codex-cli which run their own tools natively). Other API providers will refuse to run the skill with a clear error.

**File-write safety.** `write_note` and `append_note` return an error string ("agent file writes are disabled") unless you opt in via Settings → ogstack → Agent safety → **Allow agent file writes**. The agent surfaces the refusal back to you and offers the proposed change as a markdown block you can paste.

**Tool output caps.** `read_note` caps at 12,000 chars per call; `search_vault` results cap at 4,000 chars. Truncated output ends with `[truncated: …]` so the agent knows there's more if it needs to ask.

---

## Context assembly

When you run a skill, the plugin:

1. **BFS traversal** — walks forward links from the active note up to `max_depth` hops, capping at 200 nodes
2. **Metadata scoring** — scores each candidate: `(1/depth) × 0.6 + recency_decay × 0.4`
3. **Context Scout** *(optional, default on)* — a fast model reads the title + first 200 characters of the top 50 candidates and returns relevance scores and annotations
4. **Budget enforcement** — notes are accumulated in score order until the token budget is exhausted; whole files are dropped, never truncated
5. **Context format** — assembled as XML-tagged blocks, high-scored notes in full, low-scored notes as annotation only

The active note is always included in full regardless of budget.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| Provider | claude | AI service |
| Model | (provider default) | Leave blank to use the provider default. Letters, digits and `._:-/` only. |
| CLI binary path | (auto from PATH) | Only shown for CLI providers. Spaces and shell metacharacters rejected. |
| Ollama host | http://localhost:11434 | Only shown when Ollama is selected |
| Token budget | 6000 | Tokens of linked notes to include (1000–16000) |
| Context Scout | on | Semantic re-ranking before main model runs |
| Scout model | gemini-2.0-flash-lite | Model used for relevance scoring |
| Context decay | 14 days | Notes older than this are down-scored |
| Default output | inline | `inline` (at cursor) or `new-note` (split leaf) |
| Allow agent file writes | off | When off, agent skills can't run `write_note` / `append_note`. |

---

## Development

```bash
npm install
npm run dev        # watch mode — rebuilds on save
npm test           # 225 unit tests
npm run build      # production bundle → main.js
```

**Stack:** TypeScript · esbuild · Vitest · Obsidian Plugin SDK

To test against a real vault: copy or symlink the repo into `.obsidian/plugins/ogstack/` and enable the plugin. `npm run dev` rebuilds on save; reload with `Ctrl+R` in Obsidian.

---

## Security

See [SECURITY.md](SECURITY.md) for the full threat model and reporting guidance. TL;DR:

- Imported skill names are sanitized before being used as file paths.
- CLI provider subprocesses run with `shell: false`; settings inputs are validated against shell metacharacters.
- Agent file writes are opt-in (Settings → Agent safety).
- Agent tool outputs are size-capped to prevent context blow-out.
- Note content interpolated into the vault context has its framing tags defanged to mitigate prompt-injection via crafted linked notes.

## License

MIT

---

## Documentation

Full project documentation lives in /docs and is written for both
humans and AI coding agents.

Start here: [docs/overview.md](docs/overview.md)

The overview contains the project's tech stack, architecture decisions,
directory map of all doc files, and a glossary of domain terms.
All other doc files are linked from there.

AI agents (Claude Code, Gemini CLI, Codex, Cursor, etc.) should read
docs/overview.md before making any changes to this codebase.

---

*Built by [Uves Arshad](https://x.com/uvesarshad) — follow on [X](https://x.com/uvesarshad) for updates.*
