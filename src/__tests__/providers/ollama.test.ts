import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaProvider } from "../../providers/ollama";

function makeNDJSONStream(events: string[]): Response {
  const body = events.join("\n") + "\n";
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function chunk(content: string, done = false): string {
  return JSON.stringify({ message: { role: "assistant", content }, done });
}

describe("OllamaProvider (streaming)", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("yields tokens incrementally from NDJSON stream", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeNDJSONStream([
        chunk("Hello"),
        chunk(", "),
        chunk("world!"),
        chunk("", true),
      ])
    );
    vi.stubGlobal("fetch", mockFetch);

    const provider = new OllamaProvider("http://localhost:11434", "llama3.2");
    const tokens: string[] = [];
    for await (const t of provider.stream({ systemPrompt: "sys", userMessage: "go" })) {
      tokens.push(t);
    }

    expect(tokens).toEqual(["Hello", ", ", "world!"]);
  });

  it("supports multi-turn messages", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeNDJSONStream([chunk("Follow-up answer.", true)])
    );
    vi.stubGlobal("fetch", mockFetch);

    const provider = new OllamaProvider("http://localhost:11434", "llama3.2");
    const tokens: string[] = [];
    for await (const t of provider.stream({
      systemPrompt: "sys",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
        { role: "user", content: "Follow up" },
      ],
    })) {
      tokens.push(t);
    }

    expect(tokens[0]).toBe("Follow-up answer.");
  });

  it("throws when Ollama is not reachable", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    vi.stubGlobal("fetch", mockFetch);

    const provider = new OllamaProvider("http://localhost:11434", "llama3.2");
    await expect(async () => {
      for await (const _ of provider.stream({ systemPrompt: "sys", userMessage: "go" })) { void _; }
    }).rejects.toMatchObject({ status: 0 });
  });

  it("throws on non-2xx status from Ollama", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("Internal server error", { status: 500 })
    );
    vi.stubGlobal("fetch", mockFetch);

    const provider = new OllamaProvider("http://localhost:11434", "llama3.2");
    await expect(async () => {
      for await (const _ of provider.stream({ systemPrompt: "sys", userMessage: "go" })) { void _; }
    }).rejects.toMatchObject({ status: 500 });
  });
});
