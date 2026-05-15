import { describe, it, expect, beforeEach, vi } from "vitest";
import { App } from "obsidian";
import { ChatStore, ChatMessage, ToolCall } from "../chat-store";

// Minimal in-memory filesystem mock for the vault adapter so we can verify
// what the ChatStore reads, writes, lists, and removes.
class InMemoryAdapter {
  files = new Map<string, string>();
  folders = new Set<string>();

  exists = vi.fn(async (p: string) => this.files.has(p) || this.folders.has(p));
  mkdir = vi.fn(async (p: string) => { this.folders.add(p); });
  write = vi.fn(async (p: string, content: string) => { this.files.set(p, content); });
  read = vi.fn(async (p: string) => {
    if (!this.files.has(p)) throw new Error(`ENOENT: ${p}`);
    return this.files.get(p)!;
  });
  remove = vi.fn(async (p: string) => { this.files.delete(p); });
  list = vi.fn(async (folder: string) => {
    const prefix = folder.endsWith("/") ? folder : folder + "/";
    const files: string[] = [];
    const folders: string[] = [];
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix) && !f.slice(prefix.length).includes("/")) files.push(f);
    }
    for (const d of this.folders) {
      if (d.startsWith(prefix) && !d.slice(prefix.length).includes("/")) folders.push(d);
    }
    return { files, folders };
  });
}

function makePlugin(adapter: InMemoryAdapter, initialData: Record<string, unknown> = {}) {
  const app = new App();
  app.vault.adapter = adapter as unknown as App["vault"]["adapter"];

  let storedData: Record<string, unknown> = { ...initialData };
  return {
    app,
    loadData: vi.fn(async () => ({ ...storedData })),
    saveData: vi.fn(async (data: Record<string, unknown>) => {
      storedData = { ...data };
    }),
    _getStored: () => storedData,
  } as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0] & { _getStored: () => Record<string, unknown> };
}

describe("ChatStore — round-trip persistence", () => {
  it("creates a session, adds messages, and reads them back from disk", async () => {
    const adapter = new InMemoryAdapter();
    const plugin = makePlugin(adapter);
    const store = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);

    await store.load();
    const session = await store.createSession("Notes/idea.md", "idea");
    await store.addMessage(session.id, "user", "hello there");
    await store.addMessage(session.id, "assistant", "hi back");

    // New store reading from same adapter — confirms it round-trips through disk
    const store2 = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store2.load();
    const reloaded = store2.getSession(session.id);
    expect(reloaded).toBeTruthy();
    expect(reloaded!.messages.map((m) => m.content)).toEqual(["hello there", "hi back"]);
    expect(reloaded!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("persists tool calls on assistant messages and reads them back structurally", async () => {
    const adapter = new InMemoryAdapter();
    const plugin = makePlugin(adapter);
    const store = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);

    await store.load();
    const session = await store.createSession("note.md", "note");
    await store.addMessage(session.id, "user", "go");

    const toolCalls: ToolCall[] = [
      { name: "read_note", input: { path: "x.md" }, output: "contents", isError: false },
      { name: "search_vault", input: { query: "hi" }, output: "no matches", isError: false },
    ];
    await store.addMessage(session.id, "assistant", "final answer text", toolCalls);

    const store2 = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store2.load();
    const reloaded = store2.getSession(session.id);
    const assistant = reloaded!.messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toBe("final answer text");
    expect(assistant.toolCalls).toBeDefined();
    expect(assistant.toolCalls!.length).toBe(2);
    expect(assistant.toolCalls![0].name).toBe("read_note");
    expect(assistant.toolCalls![0].input).toEqual({ path: "x.md" });
    expect(assistant.toolCalls![1].isError).toBe(false);
  });

  it("persists agentSkillName stickiness across reloads", async () => {
    const adapter = new InMemoryAdapter();
    const plugin = makePlugin(adapter);
    const store = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);

    await store.load();
    const session = await store.createSession("note.md", "note");
    expect(session.agentSkillName).toBeUndefined();

    await store.setAgentSkill(session.id, "vault-agent");
    expect(store.getSession(session.id)!.agentSkillName).toBe("vault-agent");

    const store2 = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store2.load();
    expect(store2.getSession(session.id)!.agentSkillName).toBe("vault-agent");

    // Clearing it removes the field from disk
    await store2.setAgentSkill(session.id, undefined);
    const store3 = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store3.load();
    expect(store3.getSession(session.id)!.agentSkillName).toBeUndefined();
  });

  it("messages without tool calls don't get a toolCalls field on reload", async () => {
    const adapter = new InMemoryAdapter();
    const plugin = makePlugin(adapter);
    const store = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store.load();
    const session = await store.createSession("note.md", "note");
    await store.addMessage(session.id, "assistant", "no tools used");

    const store2 = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store2.load();
    const reloaded = store2.getSession(session.id);
    expect(reloaded!.messages[0].toolCalls).toBeUndefined();
  });

  it("replaceSessionMessages rewrites the file atomically", async () => {
    const adapter = new InMemoryAdapter();
    const plugin = makePlugin(adapter);
    const store = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store.load();
    const session = await store.createSession("note.md", "note");
    await store.addMessage(session.id, "user", "old");

    const newMsgs: ChatMessage[] = [
      { role: "user", content: "compacted summary", timestamp: Date.now() },
    ];
    await store.replaceSessionMessages(session.id, newMsgs);

    const store2 = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store2.load();
    const reloaded = store2.getSession(session.id);
    expect(reloaded!.messages.length).toBe(1);
    expect(reloaded!.messages[0].content).toBe("compacted summary");
  });

  it("deleteSession removes the file from disk", async () => {
    const adapter = new InMemoryAdapter();
    const plugin = makePlugin(adapter);
    const store = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store.load();
    const session = await store.createSession("note.md", "note");
    await store.addMessage(session.id, "user", "x");
    const fileCountBefore = adapter.files.size;
    await store.deleteSession(session.id);
    expect(adapter.files.size).toBe(fileCountBefore - 1);
    expect(store.getSession(session.id)).toBeUndefined();
  });

  it("notifies onChange subscribers on persist", async () => {
    const adapter = new InMemoryAdapter();
    const plugin = makePlugin(adapter);
    const store = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store.load();
    const fn = vi.fn();
    store.onChange(fn);
    const session = await store.createSession("note.md", "note");
    await store.addMessage(session.id, "user", "x");
    expect(fn).toHaveBeenCalled();
  });
});

describe("ChatStore — migration from data.json", () => {
  it("migrates legacy chatSessions out of data.json into per-session files", async () => {
    const adapter = new InMemoryAdapter();
    const legacySessions = [
      {
        id: "sess-1",
        notePath: "Inbox/idea.md",
        noteTitle: "idea",
        createdAt: 1000,
        updatedAt: 2000,
        messages: [
          { role: "user", content: "hi", timestamp: 1500 },
          { role: "assistant", content: "hello", timestamp: 1600 },
        ],
      },
      {
        id: "sess-2",
        notePath: "__ogstack_scratch__",
        noteTitle: "Scratch",
        createdAt: 3000,
        updatedAt: 4000,
        messages: [{ role: "user", content: "scratch msg", timestamp: 3500 }],
      },
    ];
    const plugin = makePlugin(adapter, {
      chatSessions: legacySessions,
      // some other settings that must be preserved
      provider: "claude",
      apiKey: "sk-fake",
    });

    const store = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store.load();

    // Both sessions show up in memory
    expect(store.getSessions().length).toBe(2);
    const s1 = store.getSession("sess-1")!;
    expect(s1.messages.length).toBe(2);
    expect(s1.messages[0].content).toBe("hi");

    // Files were written under _agent/chats/
    const writtenPaths = [...adapter.files.keys()];
    expect(writtenPaths.length).toBe(2);
    expect(writtenPaths.every((p) => p.startsWith("_agent/chats/"))).toBe(true);

    // chatSessions key stripped from data.json, other settings preserved
    const stored = (plugin as unknown as { _getStored: () => Record<string, unknown> })._getStored();
    expect(stored.chatSessions).toBeUndefined();
    expect(stored.provider).toBe("claude");
    expect(stored.apiKey).toBe("sk-fake");
  });

  it("migration is idempotent — running twice doesn't duplicate files", async () => {
    const adapter = new InMemoryAdapter();
    const plugin = makePlugin(adapter, {
      chatSessions: [
        {
          id: "sess-1",
          notePath: "n.md",
          noteTitle: "n",
          createdAt: 1,
          updatedAt: 2,
          messages: [{ role: "user", content: "x", timestamp: 1 }],
        },
      ],
    });
    const store1 = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store1.load();
    const filesAfterFirst = adapter.files.size;

    const store2 = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store2.load();
    expect(adapter.files.size).toBe(filesAfterFirst);
  });

  it("does nothing when there are no legacy sessions", async () => {
    const adapter = new InMemoryAdapter();
    const plugin = makePlugin(adapter, { provider: "claude" });
    const store = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store.load();
    expect(store.getSessions().length).toBe(0);
    expect((plugin as unknown as { saveData: ReturnType<typeof vi.fn> }).saveData).not.toHaveBeenCalled();
  });

  it("preserves messages with multiline content and quotes in YAML scalars", async () => {
    const adapter = new InMemoryAdapter();
    const plugin = makePlugin(adapter, {
      chatSessions: [
        {
          id: "edge-1",
          notePath: 'tricky: path with "quotes".md',
          noteTitle: 'tricky title with "quotes"',
          createdAt: 1,
          updatedAt: 2,
          messages: [
            { role: "user", content: "line one\nline two\n\nline four", timestamp: 1 },
          ],
        },
      ],
    });

    const store = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store.load();

    const store2 = new ChatStore(plugin as unknown as Parameters<typeof ChatStore["prototype"]["constructor"]>[0]);
    await store2.load();
    const reloaded = store2.getSession("edge-1");
    expect(reloaded).toBeTruthy();
    expect(reloaded!.noteTitle).toBe('tricky title with "quotes"');
    expect(reloaded!.messages[0].content).toBe("line one\nline two\n\nline four");
  });
});
