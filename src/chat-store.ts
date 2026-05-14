import type GStackPlugin from "./main";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  noteTitle: string;
  notePath: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export class ChatStore {
  private sessions: ChatSession[] = [];
  private listeners: Set<() => void> = new Set();

  constructor(private plugin: GStackPlugin) {}

  async load(): Promise<void> {
    const data = (await this.plugin.loadData()) as { chatSessions?: ChatSession[] } | null;
    this.sessions = data?.chatSessions ?? [];
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify(): void {
    for (const l of this.listeners) {
      try { l(); } catch { /* swallow listener errors */ }
    }
  }

  private async persist(): Promise<void> {
    const current = ((await this.plugin.loadData()) as Record<string, unknown> | null) ?? {};
    current.chatSessions = this.sessions;
    await this.plugin.saveData(current);
    this.notify();
  }

  getSessions(): ChatSession[] {
    return [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSessionsForNote(notePath: string): ChatSession[] {
    return this.sessions
      .filter((s) => s.notePath === notePath)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSession(id: string): ChatSession | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  async createSession(notePath: string, noteTitle: string): Promise<ChatSession> {
    const session: ChatSession = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      notePath,
      noteTitle,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    this.sessions.push(session);
    await this.persist();
    return session;
  }

  async addMessage(sessionId: string, role: "user" | "assistant", content: string): Promise<ChatMessage> {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const msg: ChatMessage = { role, content, timestamp: Date.now() };
    session.messages.push(msg);
    session.updatedAt = Date.now();
    await this.persist();
    return msg;
  }

  async updateLastAssistantMessage(sessionId: string, content: string): Promise<void> {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const last = session.messages[session.messages.length - 1];
    if (last?.role === "assistant") {
      last.content = content;
      session.updatedAt = Date.now();
      await this.persist();
    }
  }

  async replaceSessionMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    session.messages = messages;
    session.updatedAt = Date.now();
    await this.persist();
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    await this.persist();
  }
}
