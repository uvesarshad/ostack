import { App, MarkdownRenderer, MarkdownView, Component, Notice, TFile } from "obsidian";
import type { Skill } from "./skill-loader";
import type { GStackSettings } from "./settings";
import type { ProgressReporter } from "./floating-input";
import { getProvider, LLMMessage } from "./providers/provider-interface";
import { buildVaultContext, formatVaultContext } from "./context-builder";
import { applyScoutResults, scoutContext } from "./context-scout";
import type { ChatStore, ChatSession, ChatMessage, ToolCall } from "./chat-store";
import { runClaudeAgent } from "./agent-loop";
import { resolveMentions } from "./mention-resolver";

// ── Types ────────────────────────────────────────────────────────────

type BarState = "idle" | "streaming" | "waiting-ask" | "done" | "error";

export interface BarChatConfig {
  app: App;
  settings: GStackSettings;
  getSkills: () => Map<string, Skill>;
  chatStore: ChatStore;
  onStreamingChange?: (streaming: boolean, label: string) => void;
  // When provided, BarChat mounts into this element instead of document.body
  // and runs in "embedded" mode: always visible, no close button, no floating
  // overlay styling. Used by the sidebar to host the same conversation surface.
  host?: HTMLElement;
  // In embedded mode, the host provides a back/close handler instead of the
  // bar's own × button. E.g. sidebar uses this to return to the sessions list.
  onClose?: () => void;
  // If false, the embedded host owns active-leaf tracking (so it can flip
  // sessions on its own). Defaults to true for the floating bar.
  followActiveLeaf?: boolean;
}

// ── Constants ────────────────────────────────────────────────────────

// Case-insensitive so weaker open-source models (which often lowercase tag
// names) still get their questions rendered as interactive widgets.
const ASK_PATTERN = /<ask>([\s\S]*?)<\/ask>/gi;
const ESTIMATED_TOKENS_PER_CHAR = 0.25;
const SCRATCH_NOTE_PATH = "__ogstack_scratch__";

// The ASK protocol teaches the model two question shapes (plain text and
// JSON-with-options) so user clarifying questions render as proper widgets.
// Injected into every skill run and into free-chat — the prompt explicitly
// tells the model not to fire ASKs when it has enough context, so the cost
// of leaving it always-on is small.
const ASK_PROTOCOL_PROMPT = `

<!-- OGSTACK ASK PROTOCOL — MANDATORY -->
This UI does NOT show plain prose questions as interactive controls. If you need an answer from the user, you MUST wrap the question in <ASK>...</ASK> tags. A question written as ordinary prose will be missed and the user will not see a reply box.

# Format

Two shapes are valid:

A) Plain text — renders as a single textarea:
   <ASK>What is the target launch date?</ASK>

B) JSON with options — renders as radio buttons (single-select) or checkboxes (multi-select), plus an auto-added "Other" row that reveals a textbox:
   <ASK>{"question": "What kind of business is this?", "type": "single", "options": ["SaaS", "Service-based", "Marketplace", "Content / media"]}</ASK>
   <ASK>{"question": "Which channels are you using today?", "type": "multi", "options": ["Email", "Paid ads", "SEO", "Cold outbound", "Referrals"]}</ASK>

# Wrong vs right

WRONG (the user never sees a control — they'll just see prose):
  How will you help ecommerce businesses overcome their pain points?

RIGHT (renders as a textarea):
  <ASK>How will you help ecommerce businesses overcome their pain points related to visibility and conversion rates?</ASK>

RIGHT (renders as buttons):
  <ASK>{"question": "What is the primary metric you want to improve?", "type": "single", "options": ["Revenue", "Conversion rate", "Traffic", "Retention"]}</ASK>

# Rules

- Every interrogative directed at the user must live inside <ASK>...</ASK>. No exceptions.
- Prefer the JSON form whenever 2–6 distinct answers cover the realistic space. Users click faster than they type.
- Use plain text only when the answer is genuinely freeform (numbers, dates, names, descriptions, long opinions).
- Ask at most 3 ASKs per turn. Batch related questions; don't interleave them with explanations.
- Don't restate the question outside the tag — the UI shows the inner text.
- Set "allowOther": false only when "Other" makes no sense (e.g. yes/no). "Other" is on by default.
- If you have enough context to proceed, don't ask anything — just answer.
`;

// ── BarChat: floating conversation surface ───────────────────────────

export class BarChat extends Component implements ProgressReporter {
  // DOM
  private container: HTMLElement;
  private card: HTMLElement;
  private conversationEl: HTMLElement;
  private inputRow: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private suggestPopup: HTMLElement;
  private toolbar: HTMLElement;
  private titleEl: HTMLElement;

  // Session-driven state
  private currentSessionId: string | null = null;

  // Streaming state (transient, not persisted yet)
  private state: BarState = "idle";
  private streamingAssistantEl: HTMLElement | null = null;
  private streamingContent = "";
  private currentSkill: Skill | null = null;
  private currentSystemPrompt = "";
  // The active-note path at the time currentSystemPrompt was built. We compare
  // this against the current active file before each free-chat turn — if the
  // user switched notes, the system prompt is stale and needs rebuilding so
  // the model sees the right vault context.
  private currentSystemPromptForNote: string | null = null;
  private abortController: AbortController | null = null;

  // Suggestions
  private filteredEntries: SuggestEntry[] = [];
  private selectedSuggestIdx = -1;
  private triggerPos = -1;
  private suggestDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  private config: BarChatConfig;
  private storeUnsubscribe: (() => void) | null = null;
  private activeLeafUnregister: (() => void) | null = null;
  private embedded: boolean;

  constructor(config: BarChatConfig) {
    super();
    this.config = config;
    this.embedded = !!config.host;

    this.container = document.createElement("div");
    this.container.className = "gstack-bar2-container" + (this.embedded ? " embedded" : "");

    this.suggestPopup = document.createElement("div");
    this.suggestPopup.className = "gstack-bar2-popup";
    this.suggestPopup.style.display = "none";
    this.suggestPopup.setAttribute("role", "listbox");
    this.suggestPopup.setAttribute("aria-label", "Skill and note suggestions");

    this.card = document.createElement("div");
    this.card.className = "gstack-bar2-card" + (this.embedded ? " embedded" : "");

    this.toolbar = document.createElement("div");
    this.toolbar.className = "gstack-bar2-toolbar";
    this.buildToolbar();
    this.card.appendChild(this.toolbar);

    this.conversationEl = document.createElement("div");
    this.conversationEl.className = "gstack-bar2-conversation";
    this.card.appendChild(this.conversationEl);

    this.inputRow = document.createElement("div");
    this.inputRow.className = "gstack-bar2-input-row";
    this.buildInputRow();
    // Anchor the suggest popup to the input row, not the container — that way
    // its `bottom: calc(100% + 8px)` positions it above the input in both
    // floating mode (where container.bottom = inputRow.bottom anyway) AND
    // embedded mode (where container fills the entire sidebar height).
    this.inputRow.appendChild(this.suggestPopup);
    this.card.appendChild(this.inputRow);

    this.container.appendChild(this.card);
    (config.host ?? document.body).appendChild(this.container);

    // Embedded surfaces are always "visible" — the host controls visibility.
    if (this.embedded) this.container.classList.add("visible");

    // Floating-bar-only: drag from toolbar, persisted size via ResizeObserver,
    // and restore both on mount so the bar reappears where the user left it.
    if (!this.embedded) {
      this.installDragHandle();
      this.installResizePersistence();
      this.restoreGeometry();
    }

    // Subscribe to store changes (external sidebar edits)
    this.storeUnsubscribe = this.config.chatStore.onChange(() => this.onStoreChange());

    // Active-leaf follow is opt-out: the floating bar follows so it always
    // matches what the user has open; the sidebar embed lets the host drive
    // session switching from its own list UI.
    const followLeaf = config.followActiveLeaf !== false;
    if (followLeaf) {
      const ref = this.config.app.workspace.on("active-leaf-change", () => this.onActiveLeafChange());
      this.activeLeafUnregister = () => {
        // @ts-ignore — Obsidian's offref uses a hidden interface
        this.config.app.workspace.offref(ref);
      };
    }

    this.applyState();
  }

  // ── Public API ───────────────────────────────────────────────────

  show(): void {
    this.container.classList.add("visible");
    // Lazily attach to active note's session when first shown
    if (!this.currentSessionId) this.attachToActiveNote();
    else this.renderConversation();
  }

  hide(): void {
    // Embedded host owns visibility — never self-hide.
    if (this.embedded) return;
    this.container.classList.remove("visible");
    this.hideSuggestPopup();
  }

  focusInput(): void {
    this.show();
    setTimeout(() => this.inputEl.focus(), 50);
  }

  isVisible(): boolean {
    return this.container.classList.contains("visible");
  }

  // Embedded host calls this to switch sessions from its sessions list.
  async setSession(sessionId: string): Promise<void> {
    const session = this.config.chatStore.getSession(sessionId);
    if (!session) return;
    this.currentSessionId = sessionId;
    this.currentSkill = null;
    this.currentSystemPrompt = "";
    this.currentSystemPromptForNote = null;
    this.setState("idle");
    await this.renderConversation();
    this.updateTitle();
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  updateSettings(settings: GStackSettings): void {
    this.config.settings = settings;
  }

  destroy(): void {
    this.abortController?.abort();
    this.storeUnsubscribe?.();
    this.activeLeafUnregister?.();
    if (this.suggestDebounceTimer) clearTimeout(this.suggestDebounceTimer);
    this.resizeObserver?.disconnect();
    this.dragCleanup?.();
    this.container.remove();
  }

  // ── Drag-to-reposition + resize persistence (floating mode only) ────

  private resizeObserver: ResizeObserver | null = null;
  private dragCleanup: (() => void) | null = null;
  private static readonly GEOMETRY_STORAGE_KEY = "ogstack:bar:geometry:v1";

  private installDragHandle(): void {
    // Only the toolbar's empty space is a drag handle — clicks on actual
    // toolbar buttons should not start a drag. We detect this by checking
    // the event target's tag at pointerdown time.
    let dragStart: { x: number; y: number; left: number; top: number } | null = null;

    const onPointerDown = (e: PointerEvent) => {
      // Ignore clicks on interactive children (buttons, inputs).
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("button, input, textarea, .gstack-bar2-toolbar-btn")) return;
      // Only handle primary button.
      if (e.button !== 0) return;

      const rect = this.container.getBoundingClientRect();
      dragStart = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };

      // Switch to absolute positioning anchored by top/left so the centering
      // transform stops fighting us.
      this.container.classList.add("dragging");
      this.container.style.left = `${rect.left}px`;
      this.container.style.top = `${rect.top}px`;
      this.container.style.bottom = "auto";
      this.container.style.transform = "none";

      this.toolbar.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragStart) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      // Clamp inside the viewport (leave at least 60px visible on each side so
      // the user can't lose the bar off-screen).
      const cw = this.container.offsetWidth;
      const ch = this.container.offsetHeight;
      const minX = 60 - cw;
      const minY = 0;
      const maxX = window.innerWidth - 60;
      const maxY = window.innerHeight - 40;
      const left = Math.min(Math.max(dragStart.left + dx, minX), maxX);
      const top = Math.min(Math.max(dragStart.top + dy, minY), maxY);
      this.container.style.left = `${left}px`;
      this.container.style.top = `${top}px`;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragStart) return;
      dragStart = null;
      this.container.classList.remove("dragging");
      try { this.toolbar.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      this.persistGeometry();
    };

    this.toolbar.addEventListener("pointerdown", onPointerDown);
    this.toolbar.addEventListener("pointermove", onPointerMove);
    this.toolbar.addEventListener("pointerup", onPointerUp);
    this.toolbar.addEventListener("pointercancel", onPointerUp);
    this.toolbar.style.cursor = "grab";

    this.dragCleanup = () => {
      this.toolbar.removeEventListener("pointerdown", onPointerDown);
      this.toolbar.removeEventListener("pointermove", onPointerMove);
      this.toolbar.removeEventListener("pointerup", onPointerUp);
      this.toolbar.removeEventListener("pointercancel", onPointerUp);
    };
  }

  private installResizePersistence(): void {
    // Card-level resize (CSS resize: both) drives the container size. Observe
    // and persist with a debounce so we don't hammer localStorage during the
    // drag.
    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    this.resizeObserver = new ResizeObserver(() => {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => this.persistGeometry(), 200);
    });
    this.resizeObserver.observe(this.card);
  }

  private persistGeometry(): void {
    try {
      const rect = this.container.getBoundingClientRect();
      const cardRect = this.card.getBoundingClientRect();
      const geom = {
        left: rect.left,
        top: rect.top,
        width: cardRect.width,
        height: cardRect.height,
        // viewport — so we can re-center sensibly if the user resized the
        // window since the last save and the old coordinates are off-screen.
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
      localStorage.setItem(BarChat.GEOMETRY_STORAGE_KEY, JSON.stringify(geom));
    } catch {
      // localStorage can throw under sandbox / quota errors — non-fatal.
    }
  }

  private restoreGeometry(): void {
    try {
      const raw = localStorage.getItem(BarChat.GEOMETRY_STORAGE_KEY);
      if (!raw) return;
      const geom = JSON.parse(raw) as {
        left: number; top: number; width: number; height: number; vw?: number; vh?: number;
      };
      // Defensive: if either coordinate would push the bar fully off-screen
      // (e.g. user switched displays), drop the saved position and let the
      // default centered layout apply.
      const offTop = geom.top < 0 || geom.top > window.innerHeight - 40;
      const offLeft = geom.left + 60 > window.innerWidth || geom.left + geom.width < 60;
      if (!offTop && !offLeft) {
        this.container.style.left = `${geom.left}px`;
        this.container.style.top = `${geom.top}px`;
        this.container.style.bottom = "auto";
        this.container.style.transform = "none";
      }
      if (geom.width > 200 && geom.height > 120) {
        this.card.style.width = `${geom.width}px`;
        this.card.style.height = `${geom.height}px`;
      }
    } catch {
      // ignore parse / quota errors
    }
  }

  // ── ProgressReporter (back-compat) ───────────────────────────────

  setRunning(message: string): void {
    this.show();
    this.appendStatusMessage(message);
  }

  setDone(_message?: string): void { this.show(); }

  setError(message: string): void {
    this.show();
    this.appendStatusMessage(`✕ ${message}`, true);
    this.setState("error");
  }

  // ── Skill execution ──────────────────────────────────────────────

  async runSkill(skill: Skill): Promise<void> {
    this.show();
    this.currentSkill = skill;

    const activeFile = this.config.app.workspace.getActiveFile();
    if (!activeFile) {
      this.appendStatusMessage("Open a note first.", true);
      return;
    }

    if (!this.config.settings.apiKey && !isLocalOrCliProvider(this.config.settings.provider)) {
      this.appendStatusMessage("Add your API key in Settings → ogstack", true);
      return;
    }

    // Ensure we have a session for this note
    await this.ensureSession(activeFile);

    const prepEl = this.appendStatusMessage(`Preparing /${skill.name}…`);

    let systemPrompt: string;
    try {
      const ctx = await buildVaultContext(
        this.config.app,
        activeFile,
        this.config.settings,
        skill.maxDepth,
        skill.maxTokens ?? this.config.settings.maxTokens
      );
      if (!ctx) {
        prepEl.textContent = "✕ Could not build context.";
        return;
      }

      let finalCtx = ctx;
      if (this.config.settings.scoutEnabled && ctx.candidates.length > 0) {
        prepEl.textContent = "Scoring context relevance…";
        const results = await scoutContext(ctx.candidates, ctx, this.config.app, this.config.settings);
        if (results && results.length > 0) finalCtx = applyScoutResults(ctx, results);
      }

      const vaultStr = formatVaultContext(finalCtx);
      systemPrompt = skill.systemPrompt.replace("{{VAULT_CONTEXT}}", vaultStr);

      // Every skill (interactive OR oneshot) gets the ASK protocol — community
      // skills generally don't set mode in frontmatter, but they DO ask the
      // user clarifying questions. Without this injection the model would ask
      // as plain prose and the user wouldn't get widgets.
      systemPrompt += ASK_PROTOCOL_PROMPT;
    } catch (err: unknown) {
      prepEl.textContent = `✕ ${(err as Error).message ?? "Failed to prepare"}`;
      return;
    }

    prepEl.remove();
    this.currentSystemPrompt = systemPrompt;

    // Record a "user" turn so it's clear what triggered this
    await this.config.chatStore.addMessage(this.currentSessionId!, "user", `/${skill.name}`);
    this.renderConversation();

    if (skill.agent) {
      // Stick the agent skill on the session so follow-up user messages
      // continue the agent loop instead of falling back to plain chat.
      await this.config.chatStore.setAgentSkill(this.currentSessionId!, skill.name);
      await this.runAgentTurn(skill);
    } else {
      // Plain skill — clear any previous agent stickiness on this session.
      await this.config.chatStore.setAgentSkill(this.currentSessionId!, undefined);
      await this.streamAssistantTurn();
    }

    if (skill.autoInsert && this.state === "done") {
      const session = this.currentSession();
      const lastMsg = session?.messages[session.messages.length - 1];
      if (lastMsg?.role === "assistant" && extractAsks(lastMsg.content).length === 0) {
        await this.insertIntoNote(stripAsks(lastMsg.content), "cursor");
      }
    }
  }

  // ── Session attach / switch ──────────────────────────────────────

  private async attachToActiveNote(): Promise<void> {
    const activeFile = this.config.app.workspace.getActiveFile();
    await this.ensureSession(activeFile);
    this.renderConversation();
  }

  private async ensureSession(activeFile: TFile | null): Promise<void> {
    const notePath = activeFile?.path ?? SCRATCH_NOTE_PATH;
    const noteTitle = activeFile?.basename ?? "Scratch";

    // Re-use the most recent session for this note, or create one
    const existing = this.config.chatStore.getSessionsForNote(notePath)[0];
    if (existing) {
      this.currentSessionId = existing.id;
    } else {
      const created = await this.config.chatStore.createSession(notePath, noteTitle);
      this.currentSessionId = created.id;
    }
    this.updateTitle();
  }

  private async onActiveLeafChange(): Promise<void> {
    if (!this.isVisible()) return;
    if (this.state === "streaming" || this.state === "waiting-ask") return; // don't switch mid-turn

    const activeFile = this.config.app.workspace.getActiveFile();
    const notePath = activeFile?.path ?? SCRATCH_NOTE_PATH;
    const current = this.currentSession();
    if (current && current.notePath === notePath) return;

    await this.ensureSession(activeFile);
    this.renderConversation();
  }

  private onStoreChange(): void {
    // Only re-render if idle/done and we're showing the affected session
    if (this.state === "streaming" || this.state === "waiting-ask") return;
    this.renderConversation();
  }

  private currentSession(): ChatSession | undefined {
    if (!this.currentSessionId) return undefined;
    return this.config.chatStore.getSession(this.currentSessionId);
  }

  // ── Streaming loop ───────────────────────────────────────────────

  private async streamAssistantTurn(systemPromptOverride?: string): Promise<void> {
    if (!this.currentSessionId) return;
    this.setState("streaming");
    this.streamingContent = "";

    // Create a live (unsaved) assistant bubble appended to the conversation
    this.streamingAssistantEl = this.conversationEl.createDiv({ cls: "gstack-bar2-msg gstack-bar2-msg-assistant gstack-bar2-msg-streaming" });
    this.renderStreamingText(this.streamingAssistantEl, "");
    this.scrollToBottom();

    const history = this.buildLLMHistory();

    const provider = getProvider(this.config.settings, getVaultBasePath(this.config.app));
    // Capture locally so stop button nulling out this.abortController doesn't
    // throw on .signal access in the for-await loop.
    const controller = new AbortController();
    this.abortController = controller;

    try {
      const stream = provider.stream({
        systemPrompt: systemPromptOverride ?? this.currentSystemPrompt ?? (await this.buildFreeChatSystemPrompt()),
        messages: history,
      });

      for await (const token of stream) {
        if (controller.signal.aborted) break;
        this.streamingContent += token;
        if (this.streamingAssistantEl) {
          this.renderStreamingText(this.streamingAssistantEl, this.streamingContent);
        }
        this.scrollToBottom();
      }

      await this.finalizeAssistantTurn();
    } catch (err: unknown) {
      const e = err as { status?: number; body?: string; message?: string };
      const errText = formatProviderError(e, this.config.settings.provider);
      if (this.streamingAssistantEl) {
        this.streamingAssistantEl.empty();
        this.streamingAssistantEl.createSpan({ text: errText, cls: "gstack-bar2-msg-error" });
      }
      this.setState("error");
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }
  }

  // Agent skill turn. Three paths:
  //   - "claude" (API)       → our streaming agent loop with vault tools
  //   - "claude-cli" / "codex-cli" → fall through to normal streaming; the CLI
  //                            is itself an agent with its own native tools
  //   - anything else        → tell the user to switch provider
  // For the agent-loop path we collect structured tool calls and persist them
  // separately from the assistant text so the bubble re-renders correctly
  // after a reload.
  // `kickoffMessage` is what the model sees as the latest user turn. For the
  // initial skill invocation this is "Run skill: /name" (default). For follow-up
  // turns in an already-active agent session, the caller passes the user's
  // actual new message so the agent continues the conversation naturally.
  private async runAgentTurn(skill: Skill, kickoffMessage?: string): Promise<void> {
    if (!this.currentSessionId) return;

    const provider = this.config.settings.provider;

    // CLI providers are agents natively — let the regular streaming path drive
    // them. The skill's system prompt tells the CLI what to do.
    if (provider === "claude-cli" || provider === "codex-cli") {
      await this.streamAssistantTurn();
      return;
    }
    if (provider !== "claude") {
      this.appendStatusMessage(
        `Skill "${skill.name}" is an agent. Use the Claude API, Claude CLI, or Codex CLI provider (Settings → ogstack).`,
        true
      );
      return;
    }

    this.setState("streaming");

    const bubble = this.conversationEl.createDiv({
      cls: "gstack-bar2-msg gstack-bar2-msg-assistant gstack-bar2-msg-streaming",
    });
    const toolsEl = bubble.createDiv({ cls: "gstack-bar2-agent-tools" });
    const textEl = bubble.createDiv({ cls: "gstack-bar2-agent-text" });
    this.scrollToBottom();

    const controller = new AbortController();
    this.abortController = controller;

    const textChunks: string[] = [];
    const toolCalls: ToolCall[] = [];
    // Map tool_use_id → {index in toolCalls, DOM element}. Keyed by id so two
    // parallel calls to the same tool (or with empty-string results) match
    // their results unambiguously.
    const inflight = new Map<string, { idx: number; el: HTMLElement }>();

    try {
      const events = runClaudeAgent({
        app: this.config.app,
        apiKey: this.config.settings.apiKey,
        model: this.config.settings.model || "claude-sonnet-4-6",
        systemPrompt: this.currentSystemPrompt,
        userMessage: kickoffMessage ?? `Run skill: /${skill.name}`,
        priorMessages: this.buildLLMHistory().slice(0, -1), // exclude the latest user turn we're sending as userMessage
        allowedTools: skill.allowedTools,
        signal: controller.signal,
        allowWrites: this.config.settings.allowAgentWrites,
        maxRounds: skill.maxRounds,
      });

      for await (const evt of events) {
        if (controller.signal.aborted) break;

        if (evt.type === "text_delta") {
          textChunks.push(evt.text);
          textEl.textContent = textChunks.join("");
        } else if (evt.type === "tool_call") {
          const summary = `🔧 ${evt.name}(${formatToolInput(evt.input)})`;
          const line = toolsEl.createDiv({ cls: "gstack-bar2-agent-tool-call", text: summary });
          const idx = toolCalls.length;
          toolCalls.push({ id: evt.id, name: evt.name, input: evt.input, output: "", isError: false });
          inflight.set(evt.id, { idx, el: line });
        } else if (evt.type === "tool_result") {
          const entry = inflight.get(evt.id);
          if (entry) {
            toolCalls[entry.idx].output = evt.output;
            toolCalls[entry.idx].isError = evt.isError;
            entry.el.appendChild(document.createTextNode(evt.isError ? " ✕" : " ✓"));
            if (evt.isError) entry.el.addClass("gstack-bar2-agent-tool-error");
            entry.el.title = evt.output.length > 200 ? evt.output.slice(0, 200) + "…" : evt.output;
            inflight.delete(evt.id);
          }
        } else if (evt.type === "error") {
          // Round-limit exhaustion gets a structured block so the user sees
          // a clear "agent gave up" message instead of a tiny red line.
          const isLimit = /gave up after \d+ tool rounds/.test(evt.message);
          if (isLimit) {
            const block = textEl.createDiv({ cls: "gstack-bar2-msg-error gstack-bar2-agent-limit" });
            block.createDiv({ text: "⚠ Agent stopped at the tool-round limit.", cls: "gstack-bar2-agent-limit-title" });
            block.createDiv({ text: evt.message, cls: "gstack-bar2-agent-limit-detail" });
          } else {
            textEl.createSpan({ text: `✕ ${evt.message}`, cls: "gstack-bar2-msg-error" });
          }
        }
        this.scrollToBottom();
      }

      if (controller.signal.aborted) {
        textEl.createSpan({ text: " (stopped)", cls: "gstack-bar2-msg-status" });
      }

      // Persist structured: text content + toolCalls as a separate field.
      // renderStoredMessage() picks toolCalls up and renders them styled.
      await this.config.chatStore.addMessage(
        this.currentSessionId,
        "assistant",
        textChunks.join(""),
        toolCalls.length > 0 ? toolCalls : undefined
      );
      this.setState("done");
      await this.renderConversation();
    } catch (err: unknown) {
      const msg = (err as Error).message ?? "Agent failed";
      textEl.createSpan({ text: `✕ ${msg}`, cls: "gstack-bar2-msg-error" });
      this.setState("error");
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }
  }

  private async finalizeAssistantTurn(): Promise<void> {
    if (!this.currentSessionId) return;
    const content = this.streamingContent;
    this.streamingContent = "";
    this.streamingAssistantEl = null;

    // Persist the assistant message (full content including any <ASK> tags)
    await this.config.chatStore.addMessage(this.currentSessionId, "assistant", content);

    // Detect ASKs from the final content
    const asks = extractAsks(content);
    this.setState(asks.length > 0 ? "waiting-ask" : "done");

    // Re-render to pick up the persisted message + render ASK UI if needed
    await this.renderConversation();
    this.maybePromptCompaction();
  }

  // ── Render ───────────────────────────────────────────────────────

  // Render coalescing: chatStore.addMessage fires onChange synchronously, and
  // the listener calls renderConversation() un-awaited. Meanwhile handleSend
  // awaits its own renderConversation(). Without serialization, those two
  // async renders interleave: each empty()s the container mid-flight, and
  // MarkdownRenderer.render's await points let messages get appended twice.
  // We allow at most one render in flight, mark subsequent requests dirty,
  // and re-render once when the in-flight one finishes.
  private renderInFlight = false;
  private renderDirty = false;

  private async renderConversation(): Promise<void> {
    if (this.renderInFlight) {
      this.renderDirty = true;
      return;
    }
    this.renderInFlight = true;
    try {
      await this.doRenderConversation();
      while (this.renderDirty) {
        this.renderDirty = false;
        await this.doRenderConversation();
      }
    } finally {
      this.renderInFlight = false;
    }
  }

  private async doRenderConversation(): Promise<void> {
    const session = this.currentSession();
    this.conversationEl.empty();
    this.updateTitle();

    if (!session || session.messages.length === 0) {
      this.applyState();
      return;
    }

    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i];
      const isLast = i === session.messages.length - 1;
      await this.renderStoredMessage(msg, isLast);
    }

    this.applyState();
    this.scrollToBottom();
  }

  private async renderStoredMessage(msg: ChatMessage, isLast: boolean): Promise<void> {
    if (msg.role === "user") {
      const el = this.conversationEl.createDiv({ cls: "gstack-bar2-msg gstack-bar2-msg-user" });
      el.textContent = msg.content;
      return;
    }

    // Assistant message
    const el = this.conversationEl.createDiv({ cls: "gstack-bar2-msg gstack-bar2-msg-assistant" });
    const asks = extractAsks(msg.content);
    const visible = stripAsks(msg.content);

    // If this turn had agent tool calls, render them styled before the text.
    // Otherwise after reload they'd appear as plain markdown lines.
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      this.renderPersistedToolCalls(el, msg.toolCalls);
    }

    const contentEl = el.createDiv({ cls: "gstack-bar2-msg-content" });
    if (visible) {
      await MarkdownRenderer.render(this.config.app, visible, contentEl, "", this);
    }

    if (visible) {
      this.renderActionButtons(el, visible);
    }

    // Render ASK UI only on the most recent assistant message, and only if state is waiting-ask
    if (isLast && asks.length > 0 && this.state === "waiting-ask") {
      this.renderAskUI(el, asks);
    }
  }

  private renderStreamingText(el: HTMLElement, content: string): void {
    // Cursor is injected by CSS (.gstack-bar2-msg-streaming::after) so it always
    // sits at the actual end of the wrapped text. We just keep textContent in sync.
    el.textContent = stripAsks(content);
  }

  private renderPersistedToolCalls(
    parent: HTMLElement,
    calls: import("./chat-store").ToolCall[]
  ): void {
    const toolsEl = parent.createDiv({ cls: "gstack-bar2-agent-tools" });
    for (const t of calls) {
      const summary = `🔧 ${t.name}(${formatToolInput(t.input)}) ${t.isError ? "✕" : "✓"}`;
      const line = toolsEl.createDiv({
        cls: "gstack-bar2-agent-tool-call" + (t.isError ? " gstack-bar2-agent-tool-error" : ""),
        text: summary,
      });
      line.title = t.output.length > 200 ? t.output.slice(0, 200) + "…" : t.output;
    }
  }

  private renderActionButtons(parent: HTMLElement, content: string): void {
    const actions = parent.createDiv({ cls: "gstack-bar2-msg-actions" });

    const insertBtn = actions.createEl("button", { cls: "gstack-bar2-action-btn", text: "Insert at cursor" });
    insertBtn.addEventListener("click", () => this.insertIntoNote(content, "cursor"));

    const appendBtn = actions.createEl("button", { cls: "gstack-bar2-action-btn", text: "Append" });
    appendBtn.addEventListener("click", () => this.insertIntoNote(content, "end"));

    const copyBtn = actions.createEl("button", { cls: "gstack-bar2-action-btn", text: "Copy" });
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(content);
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
    });
  }

  private renderAskUI(parent: HTMLElement, asks: string[]): void {
    const askContainer = parent.createDiv({ cls: "gstack-bar2-ask" });
    askContainer.createDiv({
      cls: "gstack-bar2-ask-header",
      text: asks.length > 1 ? `${asks.length} questions` : "1 question",
    });

    const specs: AskSpec[] = asks.map(parseAskBody);
    const readers: Array<() => string> = [];
    let firstFocusable: HTMLElement | null = null;

    // Forward declaration so option-change handlers can call submit on Enter.
    const submit = async (): Promise<void> => doSubmit();

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const row = askContainer.createDiv({ cls: `gstack-bar2-ask-row gstack-bar2-ask-${spec.type}` });

      // Question text — render as markdown so the model can use **bold**,
      // `code`, etc. We use MarkdownRenderer.render so inline formatting and
      // links resolve the same way they do in the assistant message body.
      const qEl = row.createDiv({ cls: "gstack-bar2-ask-question" });
      void MarkdownRenderer.render(this.config.app, spec.question, qEl, "", this);

      if (spec.type === "text") {
        const ta = row.createEl("textarea", { cls: "gstack-bar2-ask-input" }) as HTMLTextAreaElement;
        ta.rows = 1;
        ta.placeholder = "Your answer… (Enter to send, Shift+Enter for newline)";
        ta.addEventListener("input", () => {
          ta.style.height = "auto";
          ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
        });
        ta.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            void submit();
          }
        });
        readers.push(() => ta.value.trim());
        if (!firstFocusable) firstFocusable = ta;
        continue;
      }

      // Option-based question. If the model already provided an "Other"-like
      // option, don't tack on a second one — use the model's option as the
      // text-revealing slot instead.
      const groupName = `gstack-ask-${Date.now()}-${i}`;
      const optionsList = row.createDiv({ cls: "gstack-bar2-ask-options" });

      const aiOtherIdx = spec.options.findIndex((o) => isOtherLikeOption(o));
      const aiHasOther = aiOtherIdx !== -1;
      const showOtherRow = !aiHasOther && spec.allowOther;

      const inputs: HTMLInputElement[] = [];
      // Track which option (if any) is the AI-provided "Other"-like slot, so
      // its label keeps its original wording AND its textbox reveals on pick.
      let aiOtherInput: HTMLInputElement | null = null;

      for (let oi = 0; oi < spec.options.length; oi++) {
        const opt = spec.options[oi];
        const id = `${groupName}-${oi}`;
        const isAiOther = oi === aiOtherIdx;
        const optionRow = optionsList.createEl("label", {
          cls: "gstack-bar2-ask-option" + (isAiOther ? " gstack-bar2-ask-option-other" : ""),
        });
        optionRow.setAttribute("for", id);
        const input = optionRow.createEl("input", {
          attr: {
            type: spec.type === "single" ? "radio" : "checkbox",
            name: groupName, value: opt, id,
          },
        }) as HTMLInputElement;
        optionRow.createEl("span", { text: opt, cls: "gstack-bar2-ask-option-label" });
        inputs.push(input);
        if (isAiOther) aiOtherInput = input;
        if (!firstFocusable) firstFocusable = input;
      }

      // Either: AI provided an Other-like option (reveal textbox under it) OR
      // we add our own Other row (legacy behavior).
      let otherInput: HTMLInputElement | null = aiOtherInput;
      let otherText: HTMLTextAreaElement | null = null;
      let otherTextWrap: HTMLElement | null = null;

      if (aiHasOther || showOtherRow) {
        if (showOtherRow) {
          const id = `${groupName}-other`;
          const otherRow = optionsList.createEl("label", {
            cls: "gstack-bar2-ask-option gstack-bar2-ask-option-other",
          });
          otherRow.setAttribute("for", id);
          otherInput = otherRow.createEl("input", {
            attr: { type: spec.type === "single" ? "radio" : "checkbox", name: groupName, value: "__other__", id },
          }) as HTMLInputElement;
          otherRow.createEl("span", { text: "Other", cls: "gstack-bar2-ask-option-label" });
        }

        otherTextWrap = optionsList.createDiv({ cls: "gstack-bar2-ask-other-input-wrap" });
        otherText = otherTextWrap.createEl("textarea", {
          cls: "gstack-bar2-ask-input gstack-bar2-ask-other-input",
        }) as HTMLTextAreaElement;
        otherText.rows = 1;
        otherText.placeholder = "Type your answer… (Enter to send)";
        otherTextWrap.style.display = "none";

        const syncOther = () => {
          const show = !!otherInput?.checked;
          if (otherTextWrap) otherTextWrap.style.display = show ? "" : "none";
          if (show) otherText?.focus();
        };
        otherInput?.addEventListener("change", syncOther);
        // Radio group: any other input flipping on must hide the textbox.
        if (spec.type === "single") {
          for (const inp of inputs) {
            if (inp !== otherInput) inp.addEventListener("change", syncOther);
          }
        }
        otherText.addEventListener("input", () => {
          otherText!.style.height = "auto";
          otherText!.style.height = Math.min(otherText!.scrollHeight, 120) + "px";
        });
        otherText.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            void submit();
          }
        });
      }

      // Enter on a focused radio/checkbox submits — matches native form intent
      // ("Enter to send" is the universal chat convention).
      for (const inp of inputs) {
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        });
      }

      readers.push(() => {
        // If aiHasOther: the AI-provided option label is the "picked" value
        // (we don't strip "(explain)" etc.); if the user also typed in the
        // revealed textbox, append it as ": <text>".
        const picked: string[] = [];
        for (const inp of inputs) {
          if (!inp.checked) continue;
          if (inp === aiOtherInput) {
            const txt = otherText?.value.trim() ?? "";
            picked.push(txt ? `${inp.value}: ${txt}` : inp.value);
          } else {
            picked.push(inp.value);
          }
        }
        // Custom "Other" row (only when aiHasOther was false).
        if (!aiHasOther && showOtherRow && otherInput?.checked) {
          const otherVal = otherText?.value.trim() ?? "";
          picked.push(otherVal ? `Other: ${otherVal}` : "Other");
        }
        return picked.join("; ");
      });
    }

    const submitBtn = askContainer.createEl("button", { cls: "gstack-bar2-ask-submit", text: "Send answers" });
    const doSubmit = async (): Promise<void> => {
      if (submitBtn.disabled) return;
      const answers = readers.map((read, idx) => {
        const a = read();
        return `**Q: ${specs[idx].question}**\nA: ${a || "(no answer)"}`;
      });
      submitBtn.disabled = true;
      askContainer.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
        .forEach((el) => { el.disabled = true; });

      if (!this.currentSessionId) return;
      const answerText = answers.join("\n\n");
      const mentionBlock = await resolveMentions(answerText, this.config.app);
      const systemPromptForTurn = mentionBlock
        ? `${this.currentSystemPrompt}\n\n${mentionBlock}`
        : this.currentSystemPrompt;
      await this.config.chatStore.addMessage(this.currentSessionId, "user", answerText);
      await this.renderConversation();
      await this.streamAssistantTurn(systemPromptForTurn);
    };
    submitBtn.addEventListener("click", () => void doSubmit());

    setTimeout(() => firstFocusable?.focus(), 50);
  }

  // ── Toolbar / input ──────────────────────────────────────────────

  private buildToolbar(): void {
    // Embedded mode: leading back button to return to sessions list.
    if (this.embedded && this.config.onClose) {
      const backBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn gstack-bar2-toolbar-back", text: "←" });
      backBtn.title = "Back to chats";
      backBtn.setAttribute("aria-label", "Back to chats");
      backBtn.addEventListener("click", () => this.config.onClose?.());
    }

    this.titleEl = this.toolbar.createDiv({ cls: "gstack-bar2-toolbar-title", text: "ogstack" });

    const newBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "+ New chat" });
    newBtn.title = "Start a new conversation for the active note";
    newBtn.setAttribute("aria-label", "Start new chat");
    newBtn.addEventListener("click", () => this.startNewChat());

    const compactBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "Compact ↑" });
    compactBtn.title = "Summarize older messages to save tokens";
    compactBtn.setAttribute("aria-label", "Compact conversation");
    compactBtn.addEventListener("click", () => this.compactConversation());

    const saveBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "Save to note" });
    saveBtn.title = "Append the whole conversation as a markdown transcript to the bound note";
    saveBtn.setAttribute("aria-label", "Save chat to note");
    saveBtn.addEventListener("click", () => this.exportTranscript());

    // Floating-bar-only: "Open in sidebar" and "×" close. In embedded mode
    // the host owns these affordances.
    if (!this.embedded) {
      const openSidebarBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "Open in sidebar" });
      openSidebarBtn.title = "Continue this chat in the right sidebar";
      openSidebarBtn.setAttribute("aria-label", "Open chat in sidebar");
      openSidebarBtn.addEventListener("click", () => this.openInSidebar());

      const closeBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn gstack-bar2-toolbar-close", text: "×" });
      closeBtn.title = "Hide";
      closeBtn.setAttribute("aria-label", "Close chat");
      closeBtn.addEventListener("click", () => this.hide());
    }
  }

  private updateTitle(): void {
    const session = this.currentSession();
    if (!this.titleEl) return;
    const baseTitle = session?.noteTitle ?? "ogstack";
    const display = baseTitle === "Scratch" ? "Scratch chat" : baseTitle;
    this.titleEl.empty();
    this.titleEl.createSpan({ text: display });
    if (session?.agentSkillName) {
      this.titleEl.createSpan({
        text: ` · agent: /${session.agentSkillName}`,
        cls: "gstack-bar2-toolbar-agent-tag",
      });
    }
  }

  private async startNewChat(): Promise<void> {
    if (this.state === "streaming") this.stopStream();
    const activeFile = this.config.app.workspace.getActiveFile();
    const notePath = activeFile?.path ?? SCRATCH_NOTE_PATH;
    const noteTitle = activeFile?.basename ?? "Scratch";
    const session = await this.config.chatStore.createSession(notePath, noteTitle);
    this.currentSessionId = session.id;
    this.currentSkill = null;
    this.currentSystemPrompt = "";
    this.currentSystemPromptForNote = null;
    // Fresh session — no sticky agent (createSession returns one with no
    // agentSkillName), but be explicit in case the in-memory mirror drifts.
    await this.config.chatStore.setAgentSkill(session.id, undefined);
    this.setState("idle");
    this.updateTitle();
    await this.renderConversation();
    this.inputEl.focus();
  }

  private async openInSidebar(): Promise<void> {
    const session = this.currentSession();
    if (!session) return;
    // Try to focus the sidebar view via the plugin's public API
    const workspace = this.config.app.workspace;
    // @ts-ignore — sidebar plugin handles its own state
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: "ogstack-sidebar", active: true });
    workspace.revealLeaf(leaf);
    // The sidebar view will pick up the session via the store; the user can click into it
  }

  private buildInputRow(): void {
    this.inputEl = this.inputRow.createEl("textarea", { cls: "gstack-bar2-input" }) as HTMLTextAreaElement;
    this.inputEl.placeholder = "Ask, /skill, or @[[note]]…";
    this.inputEl.rows = 1;
    this.inputEl.addEventListener("input", () => {
      this.autoResize();
      // Debounce the suggest popup rebuild — for vaults with thousands of
      // notes, the @-mention filter is the slow path, and rebuilding on every
      // keystroke causes noticeable jank.
      if (this.suggestDebounceTimer) clearTimeout(this.suggestDebounceTimer);
      this.suggestDebounceTimer = setTimeout(() => this.handleInputForSuggest(), 70);
    });
    this.inputEl.addEventListener("keydown", (e) => this.handleKeydown(e));

    this.sendBtn = this.inputRow.createEl("button", { cls: "gstack-bar2-send", text: "↑" }) as HTMLButtonElement;
    this.sendBtn.title = "Send (Enter)";
    this.sendBtn.setAttribute("aria-label", "Send message");
    this.sendBtn.addEventListener("click", () => this.handleSend());

    this.stopBtn = this.inputRow.createEl("button", { cls: "gstack-bar2-stop", text: "■" }) as HTMLButtonElement;
    this.stopBtn.title = "Stop";
    this.stopBtn.setAttribute("aria-label", "Stop generation");
    this.stopBtn.style.display = "none";
    this.stopBtn.addEventListener("click", () => this.stopStream());

    this.inputEl.setAttribute("aria-label", "Chat message input");
  }

  private autoResize(): void {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + "px";
  }

  // ── Input → action ───────────────────────────────────────────────

  private async handleSend(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.state === "streaming") return;

    // Slash command?
    if (text.startsWith("/")) {
      const skillName = text.slice(1).split(/\s/)[0];
      const skill = this.config.getSkills().get(skillName);
      if (skill) {
        this.inputEl.value = "";
        this.autoResize();
        this.hideSuggestPopup();
        await this.runSkill(skill);
        return;
      }
    }

    this.inputEl.value = "";
    this.autoResize();
    this.hideSuggestPopup();

    const activeFile = this.config.app.workspace.getActiveFile();
    await this.ensureSession(activeFile);

    const session = this.currentSession();

    // If this session is sticky-agent (the user previously ran an agent skill
    // and hasn't switched away), continue the agent loop with the new user
    // text as the kickoff message instead of falling back to plain chat.
    const stuckAgentSkillName = session?.agentSkillName;
    if (stuckAgentSkillName) {
      const agentSkill = this.config.getSkills().get(stuckAgentSkillName);
      if (agentSkill) {
        await this.config.chatStore.addMessage(this.currentSessionId!, "user", text);
        await this.renderConversation();
        // currentSystemPrompt was set when the skill first ran and still holds
        // its assembled vault context. Re-running runSkill would rebuild it
        // with the current active note — preferable but expensive on every
        // turn; revisit when token budgets become an issue.
        await this.runAgentTurn(agentSkill, text);
        return;
      }
    }

    // Build free-chat system prompt on the first turn, OR when the user has
    // switched to a different note since the last build. Skill-driven prompts
    // (currentSkill set) own their own context and shouldn't be overwritten.
    const activePath = activeFile?.path ?? null;
    const isFreeChat = !this.currentSkill;
    const noteChanged = isFreeChat && this.currentSystemPromptForNote !== activePath;
    if (isFreeChat && (session?.messages.length === 0 || noteChanged)) {
      this.currentSystemPrompt = await this.buildFreeChatSystemPrompt();
      this.currentSystemPromptForNote = activePath;
    }

    // Resolve @[[Note]] mentions in the user message and append their content
    // to the system prompt for this turn so the model sees the actual content
    // rather than just the literal `[[Name]]` string.
    const mentionBlock = await resolveMentions(text, this.config.app);
    const systemPromptForTurn = mentionBlock
      ? `${this.currentSystemPrompt}\n\n${mentionBlock}`
      : this.currentSystemPrompt;

    await this.config.chatStore.addMessage(this.currentSessionId!, "user", text);
    await this.renderConversation();
    await this.streamAssistantTurn(systemPromptForTurn);
  }

  private async buildFreeChatSystemPrompt(): Promise<string> {
    const activeFile = this.config.app.workspace.getActiveFile();
    const base = "You are a concise AI assistant embedded in Obsidian. Help the user think through their notes. When listing or formatting, use markdown.";
    if (!activeFile) return base + ASK_PROTOCOL_PROMPT + "\n\n(No active note open.)";
    try {
      const ctx = await buildVaultContext(this.config.app, activeFile, this.config.settings, 2, Math.min(this.config.settings.maxTokens, 4000));
      if (!ctx) return base + ASK_PROTOCOL_PROMPT;
      return base + ASK_PROTOCOL_PROMPT + "\n\n" + formatVaultContext(ctx);
    } catch {
      return base + ASK_PROTOCOL_PROMPT;
    }
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (this.filteredEntries.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.selectedSuggestIdx = Math.min(this.selectedSuggestIdx + 1, this.filteredEntries.length - 1);
        this.updateSuggestSelection();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.selectedSuggestIdx = Math.max(this.selectedSuggestIdx - 1, 0);
        this.updateSuggestSelection();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (this.selectedSuggestIdx >= 0) {
          this.applySuggestEntry(this.filteredEntries[this.selectedSuggestIdx]);
          return;
        }
      }
      if (e.key === "Escape") { e.preventDefault(); this.hideSuggestPopup(); return; }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (this.state === "streaming") this.stopStream();
      else this.hide();
    }
  }

  private handleInputForSuggest(): void {
    const cursor = this.inputEl.selectionStart ?? 0;
    const text = this.inputEl.value.slice(0, cursor);

    const slashMatch = text.match(/(?:^|[\s\n])(\/)([^\s]*)$/);
    if (slashMatch) {
      this.triggerPos = cursor - slashMatch[1].length - slashMatch[2].length;
      const q = slashMatch[2].toLowerCase();
      const entries: SuggestEntry[] = [...this.config.getSkills().values()]
        .filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
        .slice(0, 8)
        .map((s) => ({ kind: "skill", skill: s }));
      this.renderSuggestPopup(entries);
      return;
    }

    const atMatch = text.match(/(?:^|[\s\n])@([^\s\n@]*)$/);
    if (atMatch) {
      this.triggerPos = cursor - 1 - atMatch[1].length;
      const q = atMatch[1].toLowerCase();
      const entries: SuggestEntry[] = this.config.app.vault.getFiles()
        .filter((f) => f.extension === "md" && f.basename.toLowerCase().includes(q))
        .slice(0, 8)
        .map((f) => ({ kind: "note", file: f }));
      this.renderSuggestPopup(entries);
      return;
    }

    this.hideSuggestPopup();
  }

  private renderSuggestPopup(entries: SuggestEntry[]): void {
    this.filteredEntries = entries;
    this.selectedSuggestIdx = entries.length > 0 ? 0 : -1;
    this.suggestPopup.empty();

    if (entries.length === 0) { this.suggestPopup.style.display = "none"; return; }

    this.suggestPopup.style.display = "";
    entries.forEach((entry, i) => {
      const item = this.suggestPopup.createDiv({ cls: "gstack-bar2-popup-item" + (i === this.selectedSuggestIdx ? " selected" : "") });
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(i === this.selectedSuggestIdx));
      if (entry.kind === "skill") {
        item.createEl("span", { text: `/${entry.skill.name}`, cls: "gstack-bar2-popup-name" });
        item.createEl("span", { text: entry.skill.description, cls: "gstack-bar2-popup-desc" });
      } else {
        item.createEl("span", { text: `@${entry.file.basename}`, cls: "gstack-bar2-popup-name gstack-bar2-popup-note" });
        item.createEl("span", { text: entry.file.path, cls: "gstack-bar2-popup-desc" });
      }
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.applySuggestEntry(entry);
      });
    });
  }

  private updateSuggestSelection(): void {
    this.suggestPopup.querySelectorAll(".gstack-bar2-popup-item").forEach((el, i) => {
      const isSel = i === this.selectedSuggestIdx;
      el.classList.toggle("selected", isSel);
      el.setAttribute("aria-selected", String(isSel));
    });
  }

  private applySuggestEntry(entry: SuggestEntry): void {
    const before = this.inputEl.value.slice(0, this.triggerPos);
    const after = this.inputEl.value.slice(this.inputEl.selectionStart ?? this.inputEl.value.length);
    if (entry.kind === "skill") {
      this.inputEl.value = before + `/${entry.skill.name} ` + after;
    } else {
      this.inputEl.value = before + `[[${entry.file.basename}]]` + after;
    }
    this.hideSuggestPopup();
    this.inputEl.focus();
    this.autoResize();
  }

  private hideSuggestPopup(): void {
    this.suggestPopup.style.display = "none";
    this.filteredEntries = [];
    this.selectedSuggestIdx = -1;
  }

  // ── State ────────────────────────────────────────────────────────

  private setState(state: BarState): void {
    const wasStreaming = this.state === "streaming";
    this.state = state;
    this.applyState();
    const isStreaming = state === "streaming";
    if (wasStreaming !== isStreaming) {
      const label = this.currentSkill ? `/${this.currentSkill.name}` : "thinking";
      this.config.onStreamingChange?.(isStreaming, label);
    }
  }

  private applyState(): void {
    this.card.dataset.state = this.state;
    const showStop = this.state === "streaming";
    this.stopBtn.style.display = showStop ? "" : "none";
    this.sendBtn.style.display = showStop ? "none" : "";
    this.inputEl.disabled = this.state === "streaming";

    const session = this.currentSession();
    const hasConvo = !!session && session.messages.length > 0;
    // Always show toolbar — New chat / title are useful even on empty session
    this.toolbar.style.display = "";
    // Conversation pane stays visible even when empty so the input row stays
    // pinned to the bottom of the card. Hiding it (previous behavior) made
    // the input float just below the toolbar in a tall/resized card, which
    // also pushed the suggest popup off the top of the card.
    this.conversationEl.style.display = "";
    if (hasConvo) this.card.classList.add("has-conversation");
    else this.card.classList.remove("has-conversation");
  }

  private stopStream(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.setState("done");
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.conversationEl.scrollTop = this.conversationEl.scrollHeight;
    });
  }

  private appendStatusMessage(text: string, isError = false): HTMLElement {
    const el = this.conversationEl.createDiv({
      cls: "gstack-bar2-msg gstack-bar2-msg-status" + (isError ? " gstack-bar2-msg-error" : ""),
      text,
    });
    this.setState(isError ? "error" : "streaming");
    this.scrollToBottom();
    return el;
  }

  private buildLLMHistory(): LLMMessage[] {
    const session = this.currentSession();
    if (!session) return [{ role: "user", content: "Begin." }];

    const history: LLMMessage[] = session.messages.map((m) => ({ role: m.role, content: m.content }));

    if (history.length === 0 || history.every((h) => h.role === "assistant")) {
      history.push({ role: "user", content: "Begin." });
    }
    return history;
  }

  // Route insert/append to the note the chat session is bound to, NOT whatever
  // note happens to be focused right now. Users often click between notes while
  // an assistant reply is on screen — without this routing, "Insert at cursor"
  // would silently dump the content into the wrong file.
  // Build a markdown transcript of the current session and append it to the
  // bound note. Strips ASK tags (UI affordances, not user-readable content)
  // and renders agent tool calls as a code-fenced sidebar so the saved record
  // still shows what the agent did.
  private async exportTranscript(): Promise<void> {
    const session = this.currentSession();
    if (!session || session.messages.length === 0) {
      new Notice("ogstack: nothing to save — this chat is empty");
      return;
    }

    const title = session.noteTitle || "Chat";
    const stamp = new Date(session.updatedAt ?? Date.now()).toLocaleString();
    const lines: string[] = [`## ogstack chat — ${title}`, `*${stamp}*`, ""];

    for (const msg of session.messages) {
      if (msg.role === "user") {
        lines.push("**You:**", "", msg.content.trim(), "");
        continue;
      }
      lines.push("**Assistant:**", "");
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        lines.push("```text");
        for (const t of msg.toolCalls) {
          const status = t.isError ? "✕" : "✓";
          lines.push(`${status} ${t.name}(${formatToolInputForLog(t.input)})`);
        }
        lines.push("```", "");
      }
      const visible = stripAsks(msg.content).trim();
      if (visible) {
        lines.push(visible, "");
      }
    }

    const transcript = lines.join("\n").trimEnd() + "\n";
    await this.insertIntoNote(transcript, "end");
  }

  private async insertIntoNote(content: string, mode: "cursor" | "end"): Promise<void> {
    const session = this.currentSession();
    const targetPath = session?.notePath;
    const isScratch = !targetPath || targetPath === SCRATCH_NOTE_PATH;

    let editor: import("obsidian").Editor | null = null;
    let openedTargetNote = false;

    if (!isScratch && targetPath) {
      const targetFile = this.config.app.vault.getAbstractFileByPath(targetPath);
      if (targetFile instanceof TFile) {
        // Already open and focused?
        const activeView = this.config.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.file?.path === targetPath) {
          editor = activeView.editor;
        } else {
          // Open the note in the active leaf to bring it into focus before edit.
          const leaf = this.config.app.workspace.getLeaf(false);
          try {
            await leaf.openFile(targetFile);
            openedTargetNote = true;
            const reopenedView = this.config.app.workspace.getActiveViewOfType(MarkdownView);
            editor = reopenedView?.editor ?? null;
          } catch {
            editor = null;
          }
        }
      }
    }

    // Scratch session or target file gone — fall back to the currently active
    // editor (caller's choice if they want to paste somewhere else).
    if (!editor) {
      editor = this.config.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? null;
    }

    if (!editor) {
      await navigator.clipboard.writeText(content);
      new Notice("ogstack: no editor open — content copied to clipboard");
      return;
    }

    if (mode === "cursor") {
      editor.replaceRange(content, editor.getCursor());
    } else {
      const lastLine = editor.lastLine();
      const lastLineLen = editor.getLine(lastLine).length;
      const insert = (lastLineLen > 0 ? "\n\n" : "") + content;
      editor.replaceRange(insert, { line: lastLine, ch: lastLineLen });
    }

    if (openedTargetNote && !isScratch && targetPath) {
      const name = targetPath.split("/").pop()?.replace(/\.md$/, "") ?? targetPath;
      new Notice(`ogstack: inserted into ${name}`);
    }
  }

  // ── Compaction ───────────────────────────────────────────────────

  private estimateTokens(): number {
    const session = this.currentSession();
    if (!session) return 0;
    return Math.floor(
      session.messages.reduce((sum, m) => sum + m.content.length, 0) * ESTIMATED_TOKENS_PER_CHAR
    );
  }

  private maybePromptCompaction(): void {
    const tokens = this.estimateTokens();
    if (tokens < this.config.settings.compactionThreshold) return;
    if (this.toolbar.querySelector(".gstack-bar2-compact-prompt")) return;

    const prompt = this.toolbar.createDiv({ cls: "gstack-bar2-compact-prompt" });
    prompt.createSpan({ text: `Chat is getting long (~${tokens} tokens).` });
    const yes = prompt.createEl("button", { cls: "gstack-bar2-toolbar-btn mod-cta", text: "Compact" });
    yes.addEventListener("click", async () => {
      prompt.remove();
      await this.compactConversation();
    });
    const dismiss = prompt.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "Dismiss" });
    dismiss.addEventListener("click", () => prompt.remove());
  }

  private async compactConversation(): Promise<void> {
    const session = this.currentSession();
    if (!session || session.messages.length < 4) return;

    const toSummarize = session.messages.slice(0, -2);
    const recent = session.messages.slice(-2);

    // Use unique [turn-N <role>] / [/turn-N] sentinels so a message that
    // happens to contain a literal "USER:" line can't confuse the model about
    // where turns start. Agent tool calls are surfaced as a [tool: ...] line
    // per call so the compacted history retains what the agent already
    // explored — otherwise an agent skill that read 10 notes pre-compaction
    // would re-discover them all after.
    const text = toSummarize
      .map((m, i) => {
        const tag = `turn-${i + 1} ${m.role}`;
        const toolLines = (m.toolCalls ?? [])
          .map((t) => `  [tool: ${t.name}(${formatToolInputForLog(t.input)}) → ${t.isError ? "ERROR" : truncateForLog(t.output, 200)}]`)
          .join("\n");
        const body = toolLines ? `${toolLines}\n${m.content}` : m.content;
        return `[${tag}]\n${body}\n[/${tag}]`;
      })
      .join("\n\n");
    const compactionPrompt = `Summarize the following conversation into a compact set of key points. Preserve all decisions, facts the user shared, conclusions reached, AND every distinct vault note already explored or modified by agent tools (so the agent doesn't re-read them later). Be brief.\n\n${text}`;

    const statusEl = this.appendStatusMessage("Compacting older messages…");
    try {
      const provider = getProvider(this.config.settings, getVaultBasePath(this.config.app));
      let summary = "";
      const stream = provider.stream({
        systemPrompt: "You compress conversations losslessly into concise bullet points.",
        userMessage: compactionPrompt,
      });
      for await (const token of stream) summary += token;

      statusEl.remove();

      await this.config.chatStore.replaceSessionMessages(session.id, [
        { role: "assistant", content: `**[Earlier conversation, compacted]**\n\n${summary}`, timestamp: Date.now() },
        ...recent,
      ]);

      this.setState("done");
      await this.renderConversation();
    } catch (err: unknown) {
      statusEl.textContent = `✕ Compaction failed: ${(err as Error).message}`;
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

type SuggestEntry =
  | { kind: "skill"; skill: Skill }
  | { kind: "note"; file: TFile };

// Structured shape of a single <ASK>...</ASK> after parsing its body. The
// model can emit either plain text (legacy behavior — renders as a textarea)
// or a JSON object with options. Anything malformed falls back to text so a
// half-formed JSON blob never breaks the conversation.
export interface AskSpec {
  question: string;
  type: "text" | "single" | "multi";
  options: string[];
  allowOther: boolean;
}

// "Other"-like option detection. The AI often provides its own escape-hatch
// option ("Other", "Other (explain)", "Something else…") — when it does, we
// re-use that as the textbox-revealing option rather than appending a second
// "Other" row that confuses users.
export function isOtherLikeOption(label: string): boolean {
  const s = label.trim().toLowerCase();
  if (!s) return false;
  // Strip trailing parens like "(please explain)" before checking.
  const head = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return (
    head === "other" ||
    head === "something else" ||
    head === "none of the above" ||
    head === "n/a" ||
    head === "na"
  );
}

export function parseAskBody(body: string): AskSpec {
  const trimmed = body.trim();
  // Cheap reject — avoid the parse exception when the body is obviously prose.
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const q = typeof obj.question === "string" ? obj.question.trim() : "";
      if (q) {
        const rawType = obj.type;
        const type: AskSpec["type"] =
          rawType === "multi" || rawType === "multiple" || rawType === "checkbox" ? "multi" :
          rawType === "single" || rawType === "radio" || rawType === "choice" ? "single" :
          "text";
        const options = Array.isArray(obj.options)
          ? (obj.options as unknown[]).map((o) => String(o)).filter((s) => s.length > 0)
          : [];
        // If the model gave options but no explicit type, assume single-select.
        const finalType: AskSpec["type"] =
          type === "text" && options.length > 0 ? "single" : type;
        // allowOther defaults to true when there are options — keeps the
        // conversation escape-hatch unless the model explicitly says no.
        const allowOther = options.length > 0 && obj.allowOther !== false;
        return { question: q, type: finalType, options, allowOther };
      }
    } catch {
      // fall through to text
    }
  }
  return { question: trimmed, type: "text", options: [], allowOther: false };
}

export function extractAsks(text: string): string[] {
  const out: string[] = [];
  ASK_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ASK_PATTERN.exec(text)) !== null) {
    const q = m[1].trim();
    if (q) out.push(q);
  }
  return out;
}

export function formatToolInputForLog(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  return keys
    .map((k) => {
      const v = input[k];
      const s = typeof v === "string" ? truncateForLog(v, 40) : JSON.stringify(v);
      return `${k}=${s}`;
    })
    .join(", ");
}

export function truncateForLog(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export function formatToolInput(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  return keys
    .map((k) => {
      const v = input[k];
      const display = typeof v === "string" ? truncate(v, 60) : JSON.stringify(v);
      return `${k}=${display}`;
    })
    .join(", ");
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Resolves the vault root on disk so we can run CLI providers from inside the
// vault. Without this, child_process.spawn inherits Obsidian's install dir as
// cwd, which breaks codex/claude-cli's "I'm not in a project" heuristics.
function getVaultBasePath(app: App): string | undefined {
  const adapter = app.vault.adapter as { getBasePath?: () => string; basePath?: string };
  if (typeof adapter.getBasePath === "function") return adapter.getBasePath();
  if (typeof adapter.basePath === "string") return adapter.basePath;
  return undefined;
}

export function stripAsks(text: string): string {
  return text.replace(ASK_PATTERN, "").trim();
}

export function isLocalOrCliProvider(p: string): boolean {
  return p === "ollama" || p === "claude-cli" || p === "codex-cli" || p === "gemini-cli";
}

export function formatProviderError(
  e: { status?: number; body?: string; message?: string; name?: string },
  provider: string
): string {
  if (e.name === "AbortError" || e.message === "timeout") return "Timed out after 120s.";
  if (e.status === 401) return "Invalid API key — check Settings → ogstack.";
  if (e.status === 0) return `Cannot reach ${provider}. ${e.body ?? ""}`.trim();
  if (e.status && e.status >= 400) return `Provider error ${e.status}: ${e.body ?? "no detail"}`;
  return e.message ?? `Could not reach ${provider}.`;
}
