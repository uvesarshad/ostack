import type GStackPlugin from "./main";

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ChatSession {
  id: string;
  noteTitle: string;
  notePath: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

const CHATS_FOLDER = "_agent/chats";
const SCRATCH_NOTE_PATH = "__ogstack_scratch__";
const MSG_DELIM_RX = /<!--\s*ogstack:msg\s+role=(user|assistant)\s+time=(\d+)\s*-->\r?\n?/g;
const TOOLS_BLOCK_RX = /^<!--\s*ogstack:tools\r?\n([\s\S]*?)\r?\n-->\r?\n?/;
const FM_RX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

// Markdown-sidecar chat store. Each session is its own file at
// _agent/chats/<note-slug>__<sessionId>.md so:
//  - writes touch one small file, not a 10MB blob
//  - chats are visible/searchable inside Obsidian
//  - Obsidian Sync ships only the changed file
// The in-memory cache mirrors disk; the public API is unchanged.

export class ChatStore {
  private sessions: ChatSession[] = [];
  private sessionPaths: Map<string, string> = new Map(); // sessionId -> file path
  private listeners: Set<() => void> = new Set();

  constructor(private plugin: GStackPlugin) {}

  async load(): Promise<void> {
    await this.migrateFromDataJsonIfNeeded();
    await this.ensureChatsFolder();
    await this.scanFolder();
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
    const path = this.buildFilePath(session);
    this.sessionPaths.set(session.id, path);
    await this.writeSessionFile(session, path);
    this.notify();
    return session;
  }

  async addMessage(
    sessionId: string,
    role: "user" | "assistant",
    content: string,
    toolCalls?: ToolCall[]
  ): Promise<ChatMessage> {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const msg: ChatMessage = {
      role,
      content,
      timestamp: Date.now(),
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    };
    session.messages.push(msg);
    session.updatedAt = Date.now();
    await this.writeSessionFile(session);
    this.notify();
    return msg;
  }

  async updateLastAssistantMessage(sessionId: string, content: string): Promise<void> {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const last = session.messages[session.messages.length - 1];
    if (last?.role === "assistant") {
      last.content = content;
      session.updatedAt = Date.now();
      await this.writeSessionFile(session);
      this.notify();
    }
  }

  async replaceSessionMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    session.messages = messages;
    session.updatedAt = Date.now();
    await this.writeSessionFile(session);
    this.notify();
  }

  async deleteSession(id: string): Promise<void> {
    const path = this.sessionPaths.get(id);
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.sessionPaths.delete(id);
    if (path) {
      try {
        const adapter = this.plugin.app.vault.adapter;
        if (await adapter.exists(path)) await adapter.remove(path);
      } catch (err) {
        console.warn(`ogstack: could not delete chat file ${path}`, err);
      }
    }
    this.notify();
  }

  // ── File I/O ────────────────────────────────────────────────────

  private async ensureChatsFolder(): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    if (!(await adapter.exists("_agent"))) {
      try { await adapter.mkdir("_agent"); } catch { /* concurrent create ok */ }
    }
    if (!(await adapter.exists(CHATS_FOLDER))) {
      try { await adapter.mkdir(CHATS_FOLDER); } catch { /* concurrent create ok */ }
    }
  }

  private async scanFolder(): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    if (!(await adapter.exists(CHATS_FOLDER))) return;
    const listing = await adapter.list(CHATS_FOLDER);
    const loaded: ChatSession[] = [];
    for (const filePath of listing.files) {
      if (!filePath.endsWith(".md")) continue;
      try {
        const content = await adapter.read(filePath);
        const session = parseChatFile(content);
        if (!session) continue;
        loaded.push(session);
        this.sessionPaths.set(session.id, filePath);
      } catch (err) {
        console.warn(`ogstack: could not parse chat file ${filePath}`, err);
      }
    }
    this.sessions = loaded;
  }

  private buildFilePath(session: ChatSession): string {
    const slug = session.notePath === SCRATCH_NOTE_PATH || !session.notePath
      ? "_scratch"
      : slugify(session.noteTitle || basename(session.notePath));
    return `${CHATS_FOLDER}/${slug}__${session.id}.md`;
  }

  private async writeSessionFile(session: ChatSession, explicitPath?: string): Promise<void> {
    const path = explicitPath ?? this.sessionPaths.get(session.id) ?? this.buildFilePath(session);
    this.sessionPaths.set(session.id, path);
    await this.ensureChatsFolder();
    await this.plugin.app.vault.adapter.write(path, serializeChat(session));
  }

  // ── Migration ──────────────────────────────────────────────────

  private async migrateFromDataJsonIfNeeded(): Promise<void> {
    const data = (await this.plugin.loadData()) as { chatSessions?: ChatSession[] } | null;
    const old = data?.chatSessions;
    if (!old || !Array.isArray(old) || old.length === 0) return;

    await this.ensureChatsFolder();
    const adapter = this.plugin.app.vault.adapter;
    let migrated = 0;

    for (const session of old) {
      if (!session?.id) continue;
      const path = `${CHATS_FOLDER}/${
        session.notePath === SCRATCH_NOTE_PATH || !session.notePath
          ? "_scratch"
          : slugify(session.noteTitle || basename(session.notePath))
      }__${session.id}.md`;
      try {
        if (await adapter.exists(path)) continue;
        await adapter.write(path, serializeChat(session));
        migrated++;
      } catch (err) {
        console.warn(`ogstack: failed migrating session ${session.id}`, err);
      }
    }

    // Clear chatSessions from data.json but preserve everything else (settings)
    const rest = { ...(data ?? {}) } as Record<string, unknown>;
    delete rest.chatSessions;
    await this.plugin.saveData(rest);

    if (migrated > 0) {
      console.log(`ogstack: migrated ${migrated} chat session(s) to ${CHATS_FOLDER}/`);
    }
  }
}

// ── Serialization ─────────────────────────────────────────────────

function serializeChat(session: ChatSession): string {
  const fmLines = [
    "---",
    "ogstack: chat",
    `id: ${session.id}`,
    `notePath: ${yamlScalar(session.notePath)}`,
    `noteTitle: ${yamlScalar(session.noteTitle)}`,
    `createdAt: ${session.createdAt}`,
    `updatedAt: ${session.updatedAt}`,
    "---",
    "",
  ];
  const body = session.messages
    .map((m) => {
      const header = `<!-- ogstack:msg role=${m.role} time=${m.timestamp} -->\n`;
      const tools = m.toolCalls && m.toolCalls.length > 0
        ? `<!-- ogstack:tools\n${JSON.stringify(m.toolCalls)}\n-->\n`
        : "";
      return `${header}${tools}${m.content}\n`;
    })
    .join("\n");
  return fmLines.join("\n") + body;
}

function parseChatFile(content: string): ChatSession | null {
  const fmMatch = content.match(FM_RX);
  if (!fmMatch) return null;
  const fmText = fmMatch[1];
  const body = fmMatch[2];

  // Quick reject if not our format
  if (!/^\s*ogstack:\s*chat\s*$/m.test(fmText)) return null;

  const fm: Record<string, string> = {};
  for (const line of fmText.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    fm[key] = value;
  }

  if (!fm.id) return null;

  // Split body into messages by delimiter. The regex has 2 capture groups so
  // String.split returns: [pre, role, time, msgBody, role, time, msgBody, ...]
  const parts = body.split(MSG_DELIM_RX);
  const messages: ChatMessage[] = [];
  for (let i = 1; i + 2 < parts.length || i + 1 < parts.length; i += 3) {
    const role = parts[i] as "user" | "assistant";
    const time = parseInt(parts[i + 1], 10);
    // Strip any trailing newlines: the serializer adds one after the message
    // content, plus another from the `.join("\n")` that glues messages together.
    let msgBody = (parts[i + 2] ?? "").replace(/[\r\n]+$/, "");
    if (role !== "user" && role !== "assistant") continue;

    // Optional ogstack:tools block immediately after the msg header
    let toolCalls: ToolCall[] | undefined;
    const toolsMatch = msgBody.match(TOOLS_BLOCK_RX);
    if (toolsMatch) {
      try {
        const parsed = JSON.parse(toolsMatch[1]);
        if (Array.isArray(parsed)) toolCalls = parsed as ToolCall[];
      } catch {
        // ignore malformed tools block, keep content as-is
      }
      msgBody = msgBody.slice(toolsMatch[0].length);
    }

    messages.push({
      role,
      content: msgBody,
      timestamp: isNaN(time) ? Date.now() : time,
      ...(toolCalls ? { toolCalls } : {}),
    });
    if (i + 2 >= parts.length) break;
  }

  return {
    id: fm.id,
    notePath: fm.notePath ?? "",
    noteTitle: fm.noteTitle ?? "",
    createdAt: parseInt(fm.createdAt, 10) || Date.now(),
    updatedAt: parseInt(fm.updatedAt, 10) || Date.now(),
    messages,
  };
}

function yamlScalar(s: string): string {
  if (s === "") return '""';
  // Quote if it has YAML-special chars or leading/trailing whitespace
  if (/[:#"'\n\r]|^[\s\-?!&*|>%@`]|\s$/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "untitled";
}

function basename(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/\.md$/, "");
}
