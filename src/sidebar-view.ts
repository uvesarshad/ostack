import { ItemView, MarkdownRenderer, TFile, WorkspaceLeaf } from "obsidian";
import { ChatSession } from "./chat-store";
import { runChatMessage } from "./chat-runner";
import { runSkill } from "./skill-runner";
import type GStackPlugin from "./main";

export const SIDEBAR_VIEW_TYPE = "ogstack-sidebar";

type Screen = { name: "sessions" } | { name: "chat"; sessionId: string };

export class OgstackSidebarView extends ItemView {
  private screen: Screen = { name: "sessions" };
  private streamingContent = "";

  constructor(leaf: WorkspaceLeaf, private plugin: GStackPlugin) {
    super(leaf);
  }

  getViewType(): string { return SIDEBAR_VIEW_TYPE; }
  getDisplayText(): string { return "ogstack"; }
  getIcon(): string { return "wand-2"; }

  async onOpen(): Promise<void> { await this.render(); }

  async render(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.className = "gstack-chat";

    if (this.screen.name === "sessions") {
      this.renderSessionsScreen(root);
    } else {
      await this.renderChatScreen(root, this.screen.sessionId);
    }
  }

  // ── Sessions screen ──────────────────────────────────────────

  private renderSessionsScreen(root: HTMLElement): void {
    const header = root.createDiv({ cls: "gstack-chat-header" });
    header.createEl("span", { text: "ogstack", cls: "gstack-chat-title" });
    const newBtn = header.createEl("button", { cls: "gstack-chat-icon-btn", text: "+" });
    newBtn.title = "New chat for active note";
    newBtn.addEventListener("click", () => this.startNewChat());

    const sessions = this.plugin.chatStore.getSessions();
    const body = root.createDiv({ cls: "gstack-chat-body" });

    if (sessions.length === 0) {
      this.renderSessionsEmpty(body);
      return;
    }

    const list = body.createDiv({ cls: "gstack-session-list" });
    for (const session of sessions) {
      this.renderSessionItem(list, session);
    }
  }

  private renderSessionsEmpty(container: HTMLElement): void {
    const empty = container.createDiv({ cls: "gstack-chat-empty" });
    empty.createEl("div", { text: "✦", cls: "gstack-chat-empty-icon" });
    empty.createEl("p", { text: "No conversations yet.", cls: "gstack-chat-empty-title" });
    empty.createEl("p", { text: "Open a note with linked notes, then click + to start a chat about it.", cls: "gstack-chat-empty-sub" });

    const tips = empty.createDiv({ cls: "gstack-chat-empty-tips" });
    const rows = [
      ["/ commands", "Run built-in skills like /research or /plan"],
      ["@ mentions", "Tag any vault note to pull it into context"],
      ["Chat history", "Conversations are saved per note"],
    ];
    for (const [label, desc] of rows) {
      const row = tips.createDiv({ cls: "gstack-chat-tip-row" });
      row.createEl("span", { text: label, cls: "gstack-chat-tip-label" });
      row.createEl("span", { text: desc, cls: "gstack-chat-tip-desc" });
    }
  }

  private renderSessionItem(container: HTMLElement, session: ChatSession): void {
    const item = container.createDiv({ cls: "gstack-session-item" });
    const info = item.createDiv({ cls: "gstack-session-info" });
    info.createEl("div", { text: session.noteTitle || "Untitled", cls: "gstack-session-title" });

    const last = session.messages[session.messages.length - 1];
    const preview = last
      ? last.content.slice(0, 72) + (last.content.length > 72 ? "…" : "")
      : "No messages yet";
    info.createEl("div", { text: preview, cls: "gstack-session-preview" });

    const meta = item.createDiv({ cls: "gstack-session-meta" });
    meta.createEl("span", { text: relativeTime(session.updatedAt), cls: "gstack-session-time" });
    const del = meta.createEl("button", { cls: "gstack-session-del", text: "×" });
    del.title = "Delete";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      await this.plugin.chatStore.deleteSession(session.id);
      this.render();
    });

    item.addEventListener("click", () => {
      this.screen = { name: "chat", sessionId: session.id };
      this.render();
    });
  }

  // ── Chat screen ──────────────────────────────────────────────

  private async renderChatScreen(root: HTMLElement, sessionId: string): Promise<void> {
    const session = this.plugin.chatStore.getSession(sessionId);
    if (!session) { this.screen = { name: "sessions" }; this.renderSessionsScreen(root); return; }

    const header = root.createDiv({ cls: "gstack-chat-header" });
    const back = header.createEl("button", { cls: "gstack-chat-icon-btn", text: "←" });
    back.addEventListener("click", () => { this.screen = { name: "sessions" }; this.render(); });
    header.createEl("span", { text: session.noteTitle || "Chat", cls: "gstack-chat-title" });

    const body = root.createDiv({ cls: "gstack-chat-body" });
    const msgs = body.createDiv({ cls: "gstack-chat-messages" });

    if (session.messages.length === 0) {
      this.renderChatEmpty(msgs);
    }

    for (const msg of session.messages) {
      await this.appendMessage(msgs, msg.role, msg.content, false);
    }

    setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 10);

    const inputArea = root.createDiv({ cls: "gstack-chat-input-area" });
    this.buildInputArea(inputArea, session, msgs);
  }

  private renderChatEmpty(container: HTMLElement): void {
    const el = container.createDiv({ cls: "gstack-chat-intro" });
    el.createEl("div", { text: "✦ Chat with your vault", cls: "gstack-chat-intro-title" });
    const tips = [
      ["Ask", "anything about your linked notes"],
      ["/command", "run /research, /plan, /review, …"],
      ["@[[Note]]", "pull a specific note into context"],
      ["Shift+Enter", "newline · Enter to send"],
    ];
    const grid = el.createDiv({ cls: "gstack-chat-intro-grid" });
    for (const [key, val] of tips) {
      const row = grid.createDiv({ cls: "gstack-chat-intro-row" });
      row.createEl("kbd", { text: key, cls: "gstack-chat-intro-key" });
      row.createEl("span", { text: val, cls: "gstack-chat-intro-val" });
    }
  }

  private async appendMessage(
    container: HTMLElement,
    role: "user" | "assistant",
    content: string,
    streaming: boolean
  ): Promise<HTMLElement> {
    const el = container.createDiv({ cls: `gstack-msg gstack-msg-${role}` });
    if (streaming) {
      el.createEl("span", { cls: "gstack-msg-cursor", text: "●" });
    } else if (role === "assistant") {
      await MarkdownRenderer.render(this.plugin.app, content, el, "", this);
    } else {
      // Render user message — highlight [[Wiki Links]] as clickable chips
      this.renderUserMessage(el, content);
    }
    return el;
  }

  private renderUserMessage(el: HTMLElement, content: string): void {
    // Split on [[...]] to highlight note references
    const parts = content.split(/(\[\[[^\]]+\]\])/g);
    for (const part of parts) {
      if (part.startsWith("[[") && part.endsWith("]]")) {
        el.createEl("span", { text: part, cls: "gstack-msg-mention" });
      } else if (part) {
        el.createEl("span", { text: part });
      }
    }
  }

  // ── Input area ───────────────────────────────────────────────

  private buildInputArea(container: HTMLElement, session: ChatSession, msgs: HTMLElement): void {
    const skills = this.plugin.getSkills();
    const suggestEl = container.createDiv({ cls: "gstack-chat-suggest" });

    type SuggestEntry = { type: "skill"; skill: { name: string; description: string } } | { type: "note"; file: TFile };
    let filteredEntries: SuggestEntry[] = [];
    let selectedIdx = -1;
    let currentTrigger: "@" | "/" | null = null;
    let triggerPos = -1;

    const textarea = container.createEl("textarea", {
      cls: "gstack-chat-textarea",
      placeholder: "Message ogstack…  /skill  @[[note]]  Shift+Enter = newline",
    });
    (textarea as HTMLTextAreaElement).rows = 2;

    const footer = container.createDiv({ cls: "gstack-chat-footer" });
    const hint = footer.createEl("span", { text: "Enter to send · Shift+Enter for newline", cls: "gstack-chat-hint-text" });
    hint.style.display = "none";
    textarea.addEventListener("focus", () => { hint.style.display = ""; });
    textarea.addEventListener("blur", () => { hint.style.display = "none"; });
    const sendBtn = footer.createEl("button", { cls: "gstack-chat-send-btn", text: "Send" });

    const setDisabled = (v: boolean) => {
      (textarea as HTMLTextAreaElement).disabled = v;
      (sendBtn as HTMLButtonElement).disabled = v;
    };

    const clearSuggest = () => {
      suggestEl.empty();
      suggestEl.classList.remove("visible");
      filteredEntries = [];
      selectedIdx = -1;
      currentTrigger = null;
      triggerPos = -1;
    };

    const updateSelection = () => {
      suggestEl.querySelectorAll(".gstack-chat-suggest-item").forEach((el, i) => {
        el.classList.toggle("selected", i === selectedIdx);
      });
    };

    const applyEntry = (entry: SuggestEntry) => {
      const tv = textarea as HTMLTextAreaElement;
      const before = tv.value.slice(0, triggerPos);
      const after = tv.value.slice(tv.selectionStart ?? tv.value.length);

      if (entry.type === "skill") {
        tv.value = before + `/${entry.skill.name} ` + after;
      } else {
        tv.value = before + `[[${entry.file.basename}]]` + after;
      }
      clearSuggest();
      textarea.focus();
    };

    const renderSuggest = (entries: SuggestEntry[]) => {
      filteredEntries = entries;
      suggestEl.empty();
      if (entries.length === 0) { clearSuggest(); return; }

      suggestEl.classList.add("visible");
      entries.forEach((entry, i) => {
        const item = suggestEl.createDiv({ cls: "gstack-chat-suggest-item" + (i === selectedIdx ? " selected" : "") });
        if (entry.type === "skill") {
          item.createEl("span", { text: `/${entry.skill.name}`, cls: "gstack-chat-suggest-name" });
          item.createEl("span", { text: entry.skill.description, cls: "gstack-chat-suggest-desc" });
        } else {
          item.createEl("span", { text: `@${entry.file.basename}`, cls: "gstack-chat-suggest-name gstack-chat-suggest-note" });
          item.createEl("span", { text: entry.file.path, cls: "gstack-chat-suggest-desc" });
        }
        item.addEventListener("click", () => applyEntry(entry));
      });
    };

    textarea.addEventListener("input", () => {
      const tv = textarea as HTMLTextAreaElement;
      const cursor = tv.selectionStart ?? 0;
      const text = tv.value.slice(0, cursor);

      // Detect / trigger
      const slashMatch = text.match(/(?:^|[\s\n])(\/)([^\s]*)$/);
      if (slashMatch) {
        triggerPos = cursor - slashMatch[1].length - slashMatch[2].length;
        currentTrigger = "/";
        const q = slashMatch[2].toLowerCase();
        const matched = [...skills.values()]
          .filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
          .slice(0, 6)
          .map((s): SuggestEntry => ({ type: "skill", skill: s }));
        renderSuggest(matched);
        return;
      }

      // Detect @ trigger
      const atMatch = text.match(/(?:^|[\s\n])@([^\s\n@]*)$/);
      if (atMatch) {
        triggerPos = cursor - 1 - atMatch[1].length;
        currentTrigger = "@";
        const q = atMatch[1].toLowerCase();
        const files = this.plugin.app.vault.getFiles()
          .filter((f) => f.extension === "md" && f.basename.toLowerCase().includes(q))
          .slice(0, 6)
          .map((f): SuggestEntry => ({ type: "note", file: f }));
        renderSuggest(files);
        return;
      }

      clearSuggest();
    });

    const send = async () => {
      const tv = textarea as HTMLTextAreaElement;
      const text = tv.value.trim();
      if (!text) return;
      tv.value = "";
      clearSuggest();
      setDisabled(true);

      if (text.startsWith("/")) {
        const skillName = text.slice(1).split(/\s/)[0].trim();
        const skill = skills.get(skillName);
        if (skill) {
          await this.plugin.chatStore.addMessage(session.id, "user", text);
          await this.appendMessage(msgs, "user", text, false);
          const runningEl = await this.appendMessage(msgs, "assistant", "", true);
          runningEl.querySelector(".gstack-msg-cursor")!.textContent = `Running /${skillName}…`;
          msgs.scrollTop = msgs.scrollHeight;

          await runSkill(skill, this.plugin.app, this.plugin.settings);
          runningEl.remove();

          const done = `Ran /${skillName} — output written to your note.`;
          await this.appendMessage(msgs, "assistant", done, false);
          await this.plugin.chatStore.addMessage(session.id, "assistant", done);
          msgs.scrollTop = msgs.scrollHeight;
          setDisabled(false);
          textarea.focus();
          return;
        }
      }

      // Free-text multi-turn chat
      await this.plugin.chatStore.addMessage(session.id, "user", text);
      await this.appendMessage(msgs, "user", text, false);

      const assistantEl = msgs.createDiv({ cls: "gstack-msg gstack-msg-assistant" });
      assistantEl.createEl("span", { cls: "gstack-msg-cursor", text: "●" });
      msgs.scrollTop = msgs.scrollHeight;

      this.streamingContent = "";
      const activeFile = this.plugin.app.workspace.getActiveFile();
      const historySnapshot = session.messages.slice(0, -1);

      await runChatMessage(
        text,
        historySnapshot,
        this.plugin.app,
        this.plugin.settings,
        activeFile,
        (token) => {
          this.streamingContent += token;
          assistantEl.textContent = this.streamingContent;
          msgs.scrollTop = msgs.scrollHeight;
        },
        async () => {
          assistantEl.empty();
          await MarkdownRenderer.render(this.plugin.app, this.streamingContent, assistantEl, "", this);
          await this.plugin.chatStore.addMessage(session.id, "assistant", this.streamingContent);
          this.streamingContent = "";
          msgs.scrollTop = msgs.scrollHeight;
          setDisabled(false);
          textarea.focus();
        },
        (errMsg) => {
          assistantEl.empty();
          assistantEl.createEl("span", { text: `Error: ${errMsg}`, cls: "gstack-msg-error" });
          setDisabled(false);
        }
      );
    };

    textarea.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape" && filteredEntries.length > 0) {
        ke.preventDefault();
        clearSuggest();
        return;
      }
      if (ke.key === "ArrowUp" && filteredEntries.length > 0) {
        ke.preventDefault();
        selectedIdx = Math.max(selectedIdx - 1, 0);
        updateSelection();
        return;
      }
      if (ke.key === "ArrowDown" && filteredEntries.length > 0) {
        ke.preventDefault();
        selectedIdx = Math.min(selectedIdx + 1, filteredEntries.length - 1);
        updateSelection();
        return;
      }
      if (ke.key === "Enter" && !ke.shiftKey) {
        ke.preventDefault();
        if (selectedIdx >= 0 && filteredEntries[selectedIdx]) {
          applyEntry(filteredEntries[selectedIdx]);
          return;
        }
        send();
        return;
      }
    });

    sendBtn.addEventListener("click", send);
    setTimeout(() => textarea.focus(), 50);
  }

  // ── Public API ───────────────────────────────────────────────

  async startNewChat(): Promise<void> {
    const active = this.plugin.app.workspace.getActiveFile();
    const session = await this.plugin.chatStore.createSession(
      active?.path ?? "",
      active?.basename ?? "New Chat"
    );
    this.screen = { name: "chat", sessionId: session.id };
    await this.render();
  }

  async openForNote(notePath: string, noteTitle: string): Promise<void> {
    let session = this.plugin.chatStore.getSessionsForNote(notePath)[0];
    if (!session) {
      session = await this.plugin.chatStore.createSession(notePath, noteTitle);
    }
    this.screen = { name: "chat", sessionId: session.id };
    await this.render();
  }

  async onClose(): Promise<void> { /* nothing */ }
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(diff / 86_400_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
