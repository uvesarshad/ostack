import { App, Editor, MarkdownRenderer, MarkdownView, Component, TFile } from "obsidian";
import type { Skill } from "./skill-loader";
import type { GStackSettings } from "./settings";
import type { ProgressReporter } from "./floating-input";
import { getProvider, LLMMessage } from "./providers/provider-interface";
import { buildVaultContext, formatVaultContext } from "./context-builder";
import { applyScoutResults, scoutContext } from "./context-scout";

// ── Types ────────────────────────────────────────────────────────────

type BarState = "idle" | "streaming" | "waiting-ask" | "done" | "error";

interface BarMessage {
  id: string;
  role: "user" | "assistant" | "system-status";
  content: string;
  asks?: string[];   // pending <ASK> questions extracted from assistant message
  rendered?: boolean;
}

export interface BarChatConfig {
  app: App;
  settings: GStackSettings;
  getSkills: () => Map<string, Skill>;
  onStreamingChange?: (streaming: boolean, label: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────

const ASK_PATTERN = /<ASK>([\s\S]*?)<\/ASK>/g;

const ESTIMATED_TOKENS_PER_CHAR = 0.25;

// ── BarChat: the new floating conversation surface ───────────────────

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

  // State
  private state: BarState = "idle";
  private messages: BarMessage[] = [];
  private activeAssistantEl: HTMLElement | null = null;
  private activeAssistantContent = "";
  private currentSkill: Skill | null = null;
  private currentSystemPrompt = "";
  private abortController: AbortController | null = null;

  // Suggestions
  private filteredEntries: SuggestEntry[] = [];
  private selectedSuggestIdx = -1;
  private triggerPos = -1;

  private config: BarChatConfig;

  constructor(config: BarChatConfig) {
    super();
    this.config = config;

    // ── Outer container (fixed, centred) ─────────────────────────
    this.container = document.createElement("div");
    this.container.className = "gstack-bar2-container";

    // Suggestions popup (above the card)
    this.suggestPopup = document.createElement("div");
    this.suggestPopup.className = "gstack-bar2-popup";
    this.suggestPopup.style.display = "none";
    this.container.appendChild(this.suggestPopup);

    // The card
    this.card = document.createElement("div");
    this.card.className = "gstack-bar2-card";

    // Toolbar (hidden when no conversation)
    this.toolbar = document.createElement("div");
    this.toolbar.className = "gstack-bar2-toolbar";
    this.buildToolbar();
    this.card.appendChild(this.toolbar);

    // Conversation pane
    this.conversationEl = document.createElement("div");
    this.conversationEl.className = "gstack-bar2-conversation";
    this.card.appendChild(this.conversationEl);

    // Input row
    this.inputRow = document.createElement("div");
    this.inputRow.className = "gstack-bar2-input-row";
    this.buildInputRow();
    this.card.appendChild(this.inputRow);

    this.container.appendChild(this.card);
    document.body.appendChild(this.container);

    this.applyState();
  }

  // ── Public API ───────────────────────────────────────────────────

  show(): void {
    this.container.classList.add("visible");
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

  hasActiveConversation(): boolean {
    return this.messages.length > 0;
  }

  updateSettings(settings: GStackSettings): void {
    this.config.settings = settings;
  }

  destroy(): void {
    this.abortController?.abort();
    this.container.remove();
  }

  // ── ProgressReporter interface (back-compat for skill-runner) ────

  setRunning(message: string): void {
    this.show();
    this.appendStatusMessage(message);
  }

  setDone(_message?: string): void {
    // Streaming completion is handled inside runSkillInBar; this is unused there.
    // For legacy callers, just ensure visible.
    this.show();
  }

  setError(message: string): void {
    this.show();
    this.appendStatusMessage(`✕ ${message}`, true);
    this.setState("error");
  }

  // ── Skill execution entry point ──────────────────────────────────

  async runSkill(skill: Skill): Promise<void> {
    this.show();
    this.currentSkill = skill;

    // Build context & system prompt (similar to skill-runner)
    const activeFile = this.config.app.workspace.getActiveFile();
    if (!activeFile) {
      this.appendStatusMessage("Open a note first.", true);
      return;
    }

    if (!this.config.settings.apiKey && !isLocalOrCliProvider(this.config.settings.provider)) {
      this.appendStatusMessage("Add your API key in Settings → ogstack", true);
      return;
    }

    // Show "preparing" status
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

      // For interactive skills, inject the ASK protocol instructions
      if (skill.mode === "interactive") {
        systemPrompt += `\n\n<!-- OGSTACK PROTOCOL --> If you need clarification before producing the final answer, write your reasoning briefly, then wrap each clarifying question in <ASK>question text</ASK> tags. The user will answer and you'll continue. Do not use ASK tags unless you need clarification.`;
      }
    } catch (err: unknown) {
      prepEl.textContent = `✕ ${(err as Error).message ?? "Failed to prepare"}`;
      return;
    }

    // Replace the prep status with a fresh assistant bubble for streaming
    prepEl.remove();
    this.currentSystemPrompt = systemPrompt;

    // First turn: empty user message (the skill's system prompt drives the response)
    await this.streamAssistantTurn([]);

    // After streaming, if auto_insert is set and we have content (no asks), insert it
    if (skill.autoInsert && this.state === "done") {
      const lastAssistant = this.findLastAssistant();
      if (lastAssistant && lastAssistant.asks?.length === 0) {
        this.insertIntoNote(lastAssistant.content, "cursor");
      }
    }
  }

  // ── Streaming loop ───────────────────────────────────────────────

  private async streamAssistantTurn(extraUserMessages: LLMMessage[]): Promise<void> {
    this.setState("streaming");
    this.activeAssistantContent = "";

    // Create the assistant message bubble
    const msgId = `msg-${Date.now()}`;
    const msg: BarMessage = { id: msgId, role: "assistant", content: "" };
    this.messages.push(msg);
    this.activeAssistantEl = this.renderMessage(msg);
    this.scrollToBottom();

    // Build messages from history
    const history: LLMMessage[] = this.buildLLMHistory(extraUserMessages);

    const provider = getProvider(this.config.settings);
    this.abortController = new AbortController();

    try {
      const stream = provider.stream({
        systemPrompt: this.currentSystemPrompt,
        messages: history,
      });

      for await (const token of stream) {
        if (this.abortController.signal.aborted) break;
        this.activeAssistantContent += token;
        this.renderStreamingText(this.activeAssistantEl, this.activeAssistantContent);
        this.scrollToBottom();
      }

      // Stream done — finalize
      msg.content = this.activeAssistantContent;
      await this.finalizeAssistantMessage(msg);
    } catch (err: unknown) {
      const e = err as { status?: number; body?: string; message?: string };
      const errText = formatProviderError(e, this.config.settings.provider);
      msg.content = errText;
      if (this.activeAssistantEl) this.activeAssistantEl.textContent = errText;
      this.setState("error");
      return;
    } finally {
      this.abortController = null;
    }
  }

  private async finalizeAssistantMessage(msg: BarMessage): Promise<void> {
    // Detect <ASK> blocks
    const asks = extractAsks(msg.content);
    msg.asks = asks;

    if (this.activeAssistantEl) {
      // Render content stripped of ASK tags as markdown
      const visibleContent = msg.content.replace(ASK_PATTERN, "").trim();

      // Replace text node with rendered markdown + action buttons
      this.activeAssistantEl.empty();
      const contentEl = this.activeAssistantEl.createDiv({ cls: "gstack-bar2-msg-content" });
      if (visibleContent) {
        await MarkdownRenderer.render(this.config.app, visibleContent, contentEl, "", this);
      }

      // Action buttons (only if there's content beyond ASKs)
      if (visibleContent) {
        this.renderActionButtons(this.activeAssistantEl, visibleContent);
      }

      // ASK questions UI
      if (asks.length > 0) {
        this.renderAskUI(this.activeAssistantEl, asks);
        this.setState("waiting-ask");
      } else {
        this.setState("done");
      }
    } else {
      this.setState(asks.length > 0 ? "waiting-ask" : "done");
    }

    this.activeAssistantEl = null;
    this.maybePromptCompaction();
    this.scrollToBottom();
  }

  // ── DOM rendering ────────────────────────────────────────────────

  private buildToolbar(): void {
    const compactBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "Compact ↑" });
    compactBtn.title = "Summarize older messages to save tokens";
    compactBtn.addEventListener("click", () => this.compactConversation());

    const clearBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "Clear" });
    clearBtn.addEventListener("click", () => this.clearConversation());

    const closeBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn gstack-bar2-toolbar-close", text: "×" });
    closeBtn.title = "Hide";
    closeBtn.addEventListener("click", () => this.hide());
  }

  private buildInputRow(): void {
    this.inputEl = this.inputRow.createEl("textarea", { cls: "gstack-bar2-input" }) as HTMLTextAreaElement;
    this.inputEl.placeholder = "Ask, or /skill, or @[[note]]…";
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

  private renderMessage(msg: BarMessage): HTMLElement {
    const el = this.conversationEl.createDiv({ cls: `gstack-bar2-msg gstack-bar2-msg-${msg.role}` });
    if (msg.role === "user") {
      el.textContent = msg.content;
    } else if (msg.role === "system-status") {
      el.textContent = msg.content;
    } else if (msg.role === "assistant") {
      // During streaming, we use plain text. Markdown is rendered in finalize().
      el.textContent = msg.content;
    }
    return el;
  }

  private renderStreamingText(el: HTMLElement, content: string): void {
    // Show the streaming text live with a blinking cursor at end
    // Strip ASK tags from visible streaming text
    const visible = content.replace(ASK_PATTERN, "").trim();
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
      // Lock the ASK UI
      inputs.forEach((i) => { i.disabled = true; });
      // Add a user message with the answers
      const userMsg: BarMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content: answers.join("\n\n"),
      };
      this.messages.push(userMsg);
      this.renderMessage(userMsg);
      // Continue the conversation
      await this.streamAssistantTurn([]);
    });

    // Focus first input
    setTimeout(() => inputs[0]?.focus(), 50);
  }

  // ── Input handling (send, suggestions) ───────────────────────────

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

    // Free-form message
    this.inputEl.value = "";
    this.autoResize();
    this.hideSuggestPopup();

    // If no active conversation, set up a basic system prompt
    if (this.messages.length === 0) {
      this.currentSystemPrompt = await this.buildFreeChatSystemPrompt();
    }

    const userMsg: BarMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
    };
    this.messages.push(userMsg);
    this.renderMessage(userMsg);
    this.scrollToBottom();

    await this.streamAssistantTurn([]);
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
    // Suggestions navigation
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
      if (e.key === "Escape") {
        e.preventDefault();
        this.hideSuggestPopup();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (this.state === "streaming") {
        this.stopStream();
      } else {
        this.hide();
      }
      return;
    }
  }

  private handleInputForSuggest(): void {
    const cursor = this.inputEl.selectionStart ?? 0;
    const text = this.inputEl.value.slice(0, cursor);

    // / trigger (skills)
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

    // @ trigger (notes)
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

    if (entries.length === 0) {
      this.suggestPopup.style.display = "none";
      return;
    }

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

  // ── State management ─────────────────────────────────────────────

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

    const hasConvo = this.messages.length > 0;
    this.toolbar.style.display = hasConvo ? "" : "none";
    this.conversationEl.style.display = hasConvo ? "" : "none";
    if (hasConvo) {
      this.card.classList.add("has-conversation");
    } else {
      this.card.classList.remove("has-conversation");
    }
  }

  private stopStream(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.setState("done");
  }

  private clearConversation(): void {
    this.messages = [];
    this.conversationEl.empty();
    this.currentSkill = null;
    this.currentSystemPrompt = "";
    this.setState("idle");
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

  private findLastAssistant(): BarMessage | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "assistant") return this.messages[i];
    }
    return null;
  }

  private buildLLMHistory(extra: LLMMessage[]): LLMMessage[] {
    const history: LLMMessage[] = [];
    // Skip the very last assistant message if it's the one we're currently building
    const allMsgs = this.messages.slice(0, -1); // exclude the just-pushed placeholder
    for (const m of allMsgs) {
      if (m.role === "system-status") continue;
      history.push({ role: m.role as "user" | "assistant", content: m.content });
    }
    // First-turn skill invocation has no user message — synthesize one
    if (history.length === 0 || history.every((h) => h.role === "assistant")) {
      history.push({ role: "user", content: "Begin." });
    }
    return [...history, ...extra];
  }

  private async insertIntoNote(content: string, mode: "cursor" | "end"): Promise<void> {
    const view = this.config.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!editor) {
      // No active editor — copy to clipboard as fallback
      await navigator.clipboard.writeText(content);
      return;
    }

    if (mode === "cursor") {
      const cursor = editor.getCursor();
      editor.replaceRange(content, cursor);
    } else {
      const lastLine = editor.lastLine();
      const lastLineLen = editor.getLine(lastLine).length;
      const insert = (editor.getLine(lastLine).length > 0 ? "\n\n" : "") + content;
      editor.replaceRange(insert, { line: lastLine, ch: lastLineLen });
    }
  }

  // ── Compaction ───────────────────────────────────────────────────

  private estimateTokens(): number {
    return Math.floor(
      this.messages.reduce((sum, m) => sum + m.content.length, 0) * ESTIMATED_TOKENS_PER_CHAR
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
    if (this.messages.length < 4) return;

    const toSummarize = this.messages.slice(0, -2); // keep last 2 turns
    const recent = this.messages.slice(-2);

    const text = toSummarize
      .filter((m) => m.role !== "system-status")
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

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
      this.messages = [
        { id: "compact-" + Date.now(), role: "assistant", content: `**[Earlier conversation, compacted]**\n\n${summary}` },
        ...recent,
      ];
      // Re-render
      this.conversationEl.empty();
      for (const m of this.messages) {
        const el = this.renderMessage(m);
        if (m.role === "assistant") {
          await MarkdownRenderer.render(this.config.app, m.content, el, "", this);
        }
      }
      this.setState("done");
      this.scrollToBottom();
    } catch (err: unknown) {
      statusEl.textContent = `✕ Compaction failed: ${(err as Error).message}`;
    }
  }

  // Backward-compat for old callers (PersistentBar.updateSkills)
  updateSkills(_skills: Map<string, Skill>): void {
    // getSkills() callback always fetches latest; no-op
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
