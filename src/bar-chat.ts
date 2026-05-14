import { App, MarkdownRenderer, MarkdownView, Component, TFile } from "obsidian";
import type { Skill } from "./skill-loader";
import type { GStackSettings } from "./settings";
import type { ProgressReporter } from "./floating-input";
import { getProvider, LLMMessage } from "./providers/provider-interface";
import { buildVaultContext, formatVaultContext } from "./context-builder";
import { applyScoutResults, scoutContext } from "./context-scout";
import type { ChatStore, ChatSession, ChatMessage } from "./chat-store";

// ── Types ────────────────────────────────────────────────────────────

type BarState = "idle" | "streaming" | "waiting-ask" | "done" | "error";

export interface BarChatConfig {
  app: App;
  settings: GStackSettings;
  getSkills: () => Map<string, Skill>;
  chatStore: ChatStore;
  onStreamingChange?: (streaming: boolean, label: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────

const ASK_PATTERN = /<ASK>([\s\S]*?)<\/ASK>/g;
const ESTIMATED_TOKENS_PER_CHAR = 0.25;
const SCRATCH_NOTE_PATH = "__ogstack_scratch__";

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
  private abortController: AbortController | null = null;

  // Suggestions
  private filteredEntries: SuggestEntry[] = [];
  private selectedSuggestIdx = -1;
  private triggerPos = -1;

  private config: BarChatConfig;
  private storeUnsubscribe: (() => void) | null = null;
  private activeLeafUnregister: (() => void) | null = null;

  constructor(config: BarChatConfig) {
    super();
    this.config = config;

    this.container = document.createElement("div");
    this.container.className = "gstack-bar2-container";

    this.suggestPopup = document.createElement("div");
    this.suggestPopup.className = "gstack-bar2-popup";
    this.suggestPopup.style.display = "none";
    this.container.appendChild(this.suggestPopup);

    this.card = document.createElement("div");
    this.card.className = "gstack-bar2-card";

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
    this.card.appendChild(this.inputRow);

    this.container.appendChild(this.card);
    document.body.appendChild(this.container);

    // Subscribe to store changes (external sidebar edits)
    this.storeUnsubscribe = this.config.chatStore.onChange(() => this.onStoreChange());

    // Subscribe to active-leaf changes so the bar follows the note context
    const ref = this.config.app.workspace.on("active-leaf-change", () => this.onActiveLeafChange());
    this.activeLeafUnregister = () => {
      // @ts-ignore — Obsidian's offref uses a hidden interface
      this.config.app.workspace.offref(ref);
    };

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

  updateSettings(settings: GStackSettings): void {
    this.config.settings = settings;
  }

  destroy(): void {
    this.abortController?.abort();
    this.storeUnsubscribe?.();
    this.activeLeafUnregister?.();
    this.container.remove();
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

      if (skill.mode === "interactive") {
        systemPrompt += `\n\n<!-- OGSTACK PROTOCOL --> If you need clarification before producing the final answer, write your reasoning briefly, then wrap each clarifying question in <ASK>question text</ASK> tags. The user will answer and you'll continue. Do not use ASK tags unless you need clarification.`;
      }
    } catch (err: unknown) {
      prepEl.textContent = `✕ ${(err as Error).message ?? "Failed to prepare"}`;
      return;
    }

    prepEl.remove();
    this.currentSystemPrompt = systemPrompt;

    // Record a "user" turn so it's clear what triggered this
    await this.config.chatStore.addMessage(this.currentSessionId!, "user", `/${skill.name}`);
    this.renderConversation();

    await this.streamAssistantTurn();

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

  private async streamAssistantTurn(): Promise<void> {
    if (!this.currentSessionId) return;
    this.setState("streaming");
    this.streamingContent = "";

    // Create a live (unsaved) assistant bubble appended to the conversation
    this.streamingAssistantEl = this.conversationEl.createDiv({ cls: "gstack-bar2-msg gstack-bar2-msg-assistant gstack-bar2-msg-streaming" });
    this.renderStreamingText(this.streamingAssistantEl, "");
    this.scrollToBottom();

    const history = this.buildLLMHistory();

    const provider = getProvider(this.config.settings);
    this.abortController = new AbortController();

    try {
      const stream = provider.stream({
        systemPrompt: this.currentSystemPrompt || (await this.buildFreeChatSystemPrompt()),
        messages: history,
      });

      for await (const token of stream) {
        if (this.abortController.signal.aborted) break;
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
      this.abortController = null;
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

  private async renderConversation(): Promise<void> {
    const session = this.currentSession();
    this.conversationEl.empty();

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
    const visible = stripAsks(content);
    el.empty();
    el.createSpan({ text: visible });
    el.createSpan({ cls: "gstack-bar2-cursor", text: "▌" });
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
    askContainer.createDiv({ cls: "gstack-bar2-ask-header", text: asks.length > 1 ? `${asks.length} questions` : "1 question" });

    const inputs: HTMLTextAreaElement[] = [];

    for (const question of asks) {
      const row = askContainer.createDiv({ cls: "gstack-bar2-ask-row" });
      row.createDiv({ cls: "gstack-bar2-ask-question", text: question });
      const input = row.createEl("textarea", { cls: "gstack-bar2-ask-input" }) as HTMLTextAreaElement;
      input.rows = 1;
      input.placeholder = "Your answer…";
      input.addEventListener("input", () => {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 80) + "px";
      });
      inputs.push(input);
    }

    const submitBtn = askContainer.createEl("button", { cls: "gstack-bar2-ask-submit", text: "Send answers" });
    submitBtn.addEventListener("click", async () => {
      const answers = inputs.map((i, idx) => `**Q: ${asks[idx]}**\nA: ${i.value.trim() || "(no answer)"}`);
      submitBtn.disabled = true;
      inputs.forEach((i) => { i.disabled = true; });

      if (!this.currentSessionId) return;
      await this.config.chatStore.addMessage(this.currentSessionId, "user", answers.join("\n\n"));
      await this.renderConversation();
      await this.streamAssistantTurn();
    });

    setTimeout(() => inputs[0]?.focus(), 50);
  }

  // ── Toolbar / input ──────────────────────────────────────────────

  private buildToolbar(): void {
    this.titleEl = this.toolbar.createDiv({ cls: "gstack-bar2-toolbar-title", text: "ogstack" });

    const newBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "+ New chat" });
    newBtn.title = "Start a new conversation for the active note";
    newBtn.addEventListener("click", () => this.startNewChat());

    const compactBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "Compact ↑" });
    compactBtn.title = "Summarize older messages to save tokens";
    compactBtn.addEventListener("click", () => this.compactConversation());

    const openSidebarBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "Open in sidebar" });
    openSidebarBtn.title = "Continue this chat in the right sidebar";
    openSidebarBtn.addEventListener("click", () => this.openInSidebar());

    const closeBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn gstack-bar2-toolbar-close", text: "×" });
    closeBtn.title = "Hide";
    closeBtn.addEventListener("click", () => this.hide());
  }

  private updateTitle(): void {
    const session = this.currentSession();
    if (!this.titleEl) return;
    const title = session?.noteTitle ?? "ogstack";
    this.titleEl.textContent = title === "Scratch" ? "Scratch chat" : title;
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
      this.handleInputForSuggest();
    });
    this.inputEl.addEventListener("keydown", (e) => this.handleKeydown(e));

    this.sendBtn = this.inputRow.createEl("button", { cls: "gstack-bar2-send", text: "↑" }) as HTMLButtonElement;
    this.sendBtn.title = "Send (Enter)";
    this.sendBtn.addEventListener("click", () => this.handleSend());

    this.stopBtn = this.inputRow.createEl("button", { cls: "gstack-bar2-stop", text: "■" }) as HTMLButtonElement;
    this.stopBtn.title = "Stop";
    this.stopBtn.style.display = "none";
    this.stopBtn.addEventListener("click", () => this.stopStream());
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

    // Build free-chat system prompt (lazy, only first turn of a fresh session)
    const session = this.currentSession();
    if (session && session.messages.length === 0) {
      this.currentSystemPrompt = await this.buildFreeChatSystemPrompt();
    }

    await this.config.chatStore.addMessage(this.currentSessionId!, "user", text);
    await this.renderConversation();
    await this.streamAssistantTurn();
  }

  private async buildFreeChatSystemPrompt(): Promise<string> {
    const activeFile = this.config.app.workspace.getActiveFile();
    const base = "You are a concise AI assistant embedded in Obsidian. Help the user think through their notes. When listing or formatting, use markdown.";
    if (!activeFile) return base + "\n\n(No active note open.)";
    try {
      const ctx = await buildVaultContext(this.config.app, activeFile, this.config.settings, 2, Math.min(this.config.settings.maxTokens, 4000));
      if (!ctx) return base;
      return base + "\n\n" + formatVaultContext(ctx);
    } catch {
      return base;
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
      el.classList.toggle("selected", i === this.selectedSuggestIdx);
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
    this.conversationEl.style.display = hasConvo || this.streamingAssistantEl ? "" : "none";
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

  private async insertIntoNote(content: string, mode: "cursor" | "end"): Promise<void> {
    const view = this.config.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!editor) {
      await navigator.clipboard.writeText(content);
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

    const text = toSummarize.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
    const compactionPrompt = `Summarize the following conversation into a compact set of key points. Preserve all decisions, facts the user shared, and conclusions reached. Be brief.\n\n${text}`;

    const statusEl = this.appendStatusMessage("Compacting older messages…");
    try {
      const provider = getProvider(this.config.settings);
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

function extractAsks(text: string): string[] {
  const out: string[] = [];
  ASK_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ASK_PATTERN.exec(text)) !== null) {
    const q = m[1].trim();
    if (q) out.push(q);
  }
  return out;
}

function stripAsks(text: string): string {
  return text.replace(ASK_PATTERN, "").trim();
}

function isLocalOrCliProvider(p: string): boolean {
  return p === "ollama" || p === "claude-cli" || p === "codex-cli" || p === "gemini-cli";
}

function formatProviderError(
  e: { status?: number; body?: string; message?: string; name?: string },
  provider: string
): string {
  if (e.name === "AbortError" || e.message === "timeout") return "Timed out after 120s.";
  if (e.status === 401) return "Invalid API key — check Settings → ogstack.";
  if (e.status === 0) return `Cannot reach ${provider}. ${e.body ?? ""}`.trim();
  if (e.status && e.status >= 400) return `Provider error ${e.status}: ${e.body ?? "no detail"}`;
  return e.message ?? `Could not reach ${provider}.`;
}
