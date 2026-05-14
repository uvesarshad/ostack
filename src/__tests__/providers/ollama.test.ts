import { describe, it, expect, vi, afterEach } from "vitest";
import { OllamaProvider } from "../../providers/ollama";
import { requestUrl } from "obsidian";

const chatResponse = (content: string) =>
  JSON.stringify({ message: { role: "assistant", content } });

describe("OllamaProvider", () => {
  afterEach(() => vi.clearAllMocks());

  it("yields the full response as a single chunk", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: chatResponse("The full answer from Ollama."),
      json: {},
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    });

    const provider = new OllamaProvider("http://localhost:11434", "llama3.2");
    const tokens: string[] = [];
    for await (const t of provider.stream({ systemPrompt: "sys", userMessage: "go" })) {
      tokens.push(t);
    }

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toBe("The full answer from Ollama.");
  });

  it("supports multi-turn messages", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: chatResponse("Follow-up answer."),
      json: {},
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    });

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

  it("throws when Ollama is not running (requestUrl rejects)", async () => {
    vi.mocked(requestUrl).mockRejectedValue(new Error("connection refused"));

    const provider = new OllamaProvider("http://localhost:11434", "llama3.2");
    await expect(async () => {
      for await (const _ of provider.stream({ systemPrompt: "sys", userMessage: "go" })) {}
    }).rejects.toMatchObject({ status: 0 });
  });

  it("throws on non-2xx status from Ollama", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 500,
      text: "Internal server error",
      json: {},
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    });

    const provider = new OllamaProvider("http://localhost:11434", "llama3.2");
    await expect(async () => {
      for await (const _ of provider.stream({ systemPrompt: "sys", userMessage: "go" })) {}
    }).rejects.toMatchObject({ status: 500 });
  });

  it("throws on non-JSON Ollama response", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: "not json",
      json: {},
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    });

    const provider = new OllamaProvider("http://localhost:11434", "llama3.2");
    await expect(async () => {
      for await (const _ of provider.stream({ systemPrompt: "sys", userMessage: "go" })) {}
    }).rejects.toBeDefined();
  });
});
