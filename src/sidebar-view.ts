import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { BarChat } from "./bar-chat";
import { ChatSession } from "./chat-store";
import type GStackPlugin from "./main";

export const SIDEBAR_VIEW_TYPE = "ogstack-sidebar";

type Screen = { name: "sessions" } | { name: "chat"; sessionId: string };

// The sidebar is a thin shell: it owns the sessions list (history) and, when
// the user picks a session or starts a new one, mounts a BarChat instance into
// its own container. That gives both surfaces the exact same conversation code
// (streaming, agents, ASK, compaction, Insert/Append/Copy) — only the chrome
// around it differs.
export class OgstackSidebarView extends ItemView {
  private screen: Screen = { name: "sessions" };
  private storeUnsubscribe: (() => void) | null = null;
  // Tick once per minute to refresh "5m ago"-style timestamps. Without this,
  // a long-open sidebar shows stale relative times.
  private relativeTimeInterval: ReturnType<typeof setInterval> | null = null;
  private embeddedBar: BarChat | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: GStackPlugin) {
    super(leaf);
  }

  getViewType(): string { return SIDEBAR_VIEW_TYPE; }
  getDisplayText(): string { return "ogstack"; }
  getIcon(): string { return "wand-2"; }

  async onOpen(): Promise<void> {
    this.storeUnsubscribe = this.plugin.chatStore.onChange(() => {
      // Only re-render the sessions list — the embedded BarChat manages its
      // own re-render via the same store subscription.
      if (this.screen.name === "sessions") this.render();
    });

    this.relativeTimeInterval = setInterval(() => {
      if (this.screen.name !== "sessions") return;
      const root = this.containerEl.children[1] as HTMLElement | undefined;
      if (!root) return;
      const sessions = this.plugin.chatStore.getSessions();
      const sessionsById = new Map(sessions.map((s) => [s.id, s]));
      root.querySelectorAll(".gstack-session-item").forEach((item) => {
        const sessionId = item.getAttribute("data-session-id");
        const s = sessionId ? sessionsById.get(sessionId) : null;
        const timeEl = item.querySelector(".gstack-session-time");
        if (s && timeEl) timeEl.textContent = relativeTime(s.updatedAt);
      });
    }, 60_000);

    await this.render();
  }

  async render(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    this.teardownEmbeddedBar();
    root.empty();
    root.className = "gstack-chat";

    if (this.screen.name === "sessions") {
      this.renderSessionsScreen(root);
    } else {
      this.renderChatScreen(root, this.screen.sessionId);
    }
  }

  private teardownEmbeddedBar(): void {
    if (this.embeddedBar) {
      this.embeddedBar.destroy();
      this.embeddedBar = null;
    }
  }

  // ── Sessions screen ──────────────────────────────────────────

  private renderSessionsScreen(root: HTMLElement): void {
    const header = root.createDiv({ cls: "gstack-chat-header" });
    header.createEl("span", { text: "ogstack", cls: "gstack-chat-title" });
    const newBtn = header.createEl("button", { cls: "gstack-chat-icon-btn", text: "+" });
    newBtn.title = "New chat for active note";
    newBtn.setAttribute("aria-label", "Start new chat for active note");
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
    item.setAttribute("data-session-id", session.id);
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.setAttribute("aria-label", `Open chat: ${session.noteTitle || "Untitled"}`);
    const info = item.createDiv({ cls: "gstack-session-info" });
    info.createEl("div", { text: session.noteTitle || "Untitled", cls: "gstack-session-title" });

    const last = session.messages[session.messages.length - 1];
    const preview = last
      ? last.content.slice(0, 72) + (last.content.length > 72 ? "…" : "")
      : "No messages yet";
    info.createEl("div", { text: preview, cls: "gstack-session-preview" });

    const meta = item.createDiv({ cls: "gstack-session-meta" });
    meta.createEl("span", { text: relativeTime(session.updatedAt), cls: "gstack-session-time" });
    const del = meta.createEl("button", { cls: "gstack-session-del" });
    setIcon(del, "trash-2");
    del.title = "Delete chat";
    del.setAttribute("aria-label", `Delete chat: ${session.noteTitle || "Untitled"}`);
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      // Quick confirm — sessions are non-trivial to recreate and there's no undo.
      if (!confirm(`Delete chat "${session.noteTitle || "Untitled"}"? This cannot be undone.`)) return;
      await this.plugin.chatStore.deleteSession(session.id);
      this.render();
    });

    const open = () => {
      this.screen = { name: "chat", sessionId: session.id };
      this.render();
    };
    item.addEventListener("click", open);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  }

  // ── Chat screen (BarChat host) ───────────────────────────────

  private renderChatScreen(root: HTMLElement, sessionId: string): void {
    const session = this.plugin.chatStore.getSession(sessionId);
    if (!session) {
      this.screen = { name: "sessions" };
      this.renderSessionsScreen(root);
      return;
    }

    // Mount a BarChat in embedded mode. The host (this view) drives session
    // switching via setSession; BarChat owns all conversation behavior.
    const hostEl = root.createDiv({ cls: "gstack-sidebar-bar-host" });

    this.embeddedBar = new BarChat({
      app: this.plugin.app,
      settings: this.plugin.settings,
      getSkills: () => this.plugin.getSkills(),
      chatStore: this.plugin.chatStore,
      host: hostEl,
      followActiveLeaf: false,
      onClose: () => {
        this.screen = { name: "sessions" };
        this.render();
      },
    });

    void this.embeddedBar.setSession(sessionId);
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

  async onClose(): Promise<void> {
    this.teardownEmbeddedBar();
    this.storeUnsubscribe?.();
    this.storeUnsubscribe = null;
    if (this.relativeTimeInterval) {
      clearInterval(this.relativeTimeInterval);
      this.relativeTimeInterval = null;
    }
  }
}

export function relativeTime(ts: number): string {
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
