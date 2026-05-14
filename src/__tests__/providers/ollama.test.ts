import { describe, it, expect, vi, afterEach } from "vitest";
import { OllamaProvider } from "../../providers/ollama";
import { requestUrl } from "obsidian";

describe("OllamaProvider", () => {
  afterEach(() => vi.clearAllMocks());

  it("yields the full response as a single chunk", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: JSON.stringify({ response: "The full answer from Ollama." }),
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
