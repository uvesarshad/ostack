// First-run welcome note. Written verbatim to `Welcome to ogstack.md` at the
// vault root the first time the plugin loads — gives the user a persistent,
// editable starting point instead of just a modal that closes.

export const GETTING_STARTED_NOTE = `# Welcome to ogstack ✦

You just installed **ogstack** — a vault-aware AI skill system for Obsidian. Your linked notes become the context for every conversation. This note is a quick reference. Keep it, edit it, or delete it once you're up and running.

> **Tip:** This note is a regular markdown file. Edit it freely — it won't be recreated unless you uninstall and reinstall the plugin.

---

## 1. Add your API key (60 seconds)

Open **Settings → ogstack** and pick a provider:

| Provider | Free? | Best for |
|---|---|---|
| **Claude** (Anthropic) | Paid API | Default. Best reasoning, agent skills work here. [Get key](https://console.anthropic.com/) |
| **OpenAI** | Paid API | GPT-5, GPT-4o. [Get key](https://platform.openai.com/api-keys) |
| **Gemini** | Free tier | Generous free tier. [Get key](https://aistudio.google.com/apikey) |
| **xAI / Grok** | Paid API | Grok models. [Get key](https://console.x.ai/) |
| **Ollama** | Free, local | Privacy-first. Runs models on your machine. No key needed. |
| **Claude CLI / Codex CLI** | Subscription | Uses your existing Claude Code or Codex CLI login. No API key. |

Paste the key, pick your model (defaults are sensible), and you're done.

---

## 2. Start a conversation

Three ways to open ogstack:

- **Floating bar** — press **Ctrl/Cmd + Shift + Space** anywhere. The bar pops up centered. Drag the header to reposition; drag the corner to resize. Your geometry persists.
- **Sidebar** — click the ✦ wand icon in the left ribbon. Full session history on one screen.
- **Per-note chat** — both surfaces auto-bind to the active note. Switch notes, the chat follows.

In the input row:

- Type a message → chat normally with vault context auto-attached
- Type \`/\` → pick a skill (research, plan, review, …)
- Type \`@\` → mention a specific note to inject its content for this turn

---

## 3. Try a built-in skill

Open any note that has linked notes (\`[[Other Note]]\` references). Then in the chat:

- **\`/research\`** — synthesizes the linked notes into a structured research brief
- **\`/plan\`** — drafts a project plan from your goals
- **\`/outline\`** — builds a document outline from linked research
- **\`/campaign\`** — turns product + audience notes into a marketing campaign
- **\`/review\`** — editorial critique of the active note

The skill reads your linked notes (up to its configured depth), passes them to the model with the right system prompt, and streams the answer. Use **Insert at cursor**, **Append**, or **Copy** on any reply to bring it back into your note.

---

## 4. Add your own skills

Skills live in the \`_agent/\` folder of your vault. Three valid layouts:

\`\`\`
_agent/
├── quick-note.md                       ← flat (single file)
├── competitor-analysis/
│   └── SKILL.md                        ← foldered (with optional resources next to it)
└── gstack-bundle/                      ← bundled (a whole collection)
    ├── research/SKILL.md
    ├── plan/SKILL.md
    └── ship/SKILL.md
\`\`\`

Every \`SKILL.md\` starts with frontmatter:

\`\`\`markdown
---
name: my-skill
description: One-line summary that shows in the / picker
mode: oneshot          # or "interactive" — interactive skills can ask questions via <ASK>
output: inline         # or "new-note"
max_depth: 3
max_tokens: 6000
---

Your system prompt goes here.

The placeholder \`{{VAULT_CONTEXT}}\` gets replaced with the linked-note context.
\`\`\`

Save the file and it appears as \`/my-skill\` within 2 seconds — no restart.

### Import skills

**Command Palette → "ogstack: Import skill from GitHub"** opens the import modal. You can:

- Paste a GitHub **repo URL** (e.g. \`https://github.com/owner/skills\`) → scans the repo, lets you pick which skills to install
- Paste a **single file URL** (e.g. \`…/blob/main/skill.md\`) → imports that one skill
- Click **Import local files** → file picker for SKILL.md files already on disk

---

## 5. Interactive questions

When a skill needs clarification, it asks via the \`<ASK>\` protocol — the question renders as a real form widget instead of inline prose:

- Plain question → textarea
- Multiple-choice → radio buttons
- Multi-select → checkboxes
- Always has an **Other** row that reveals a free-text input

Press **Enter** to submit (Shift+Enter for newlines).

---

## 6. Long conversations

When a chat gets long, ogstack will offer to **Compact** it. The last two turns stay verbatim; everything before is summarized into a leading bullet-list message. Agent tool calls survive compaction so the agent doesn't re-explore notes it already read.

Click **Save to note** in the toolbar to dump the entire transcript into the bound note before compacting if you want to preserve the full record.

---

## Where things live

- \`_agent/\` — your custom skills
- \`_agent/chats/\` — saved chat sessions (one file per session)
- \`.obsidian/plugins/ogstack/data.json\` — your settings + API key

> **Privacy note:** API keys are stored plaintext at \`.obsidian/plugins/ogstack/data.json\`. Obsidian Sync excludes plugin data by default. Third-party sync (Git, Dropbox, iCloud) WILL carry the key — exclude this file if you sync your vault to a public location.

---

## Going further

- **GitHub**: [ogstack repo](https://github.com/uvesarshad/ostack) — issues, PRs, discussion
- **Sponsor**: [GitHub Sponsors](https://github.com/sponsors/uvesarshad) — if this saves you time, consider supporting development
- **Built by** [Uves Arshad](https://x.com/uvesarshad)

Inspired by [gstack](https://github.com/garrytan/gstack) by [Garry Tan](https://x.com/garrytan).

---

*You can delete this note when you no longer need it.*
`;
