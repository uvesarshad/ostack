import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiProvider } from "../../providers/gemini";

function makeSSEStream(lines: string[]): Response {
  const body = lines.join("\n") + "\n";
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function geminiEvent(text: string): string {
  return `data: ${JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  })}`;
}

describe("GeminiProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("yields text chunks from SSE stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeSSEStream([geminiEvent("Sentence one. "), geminiEvent("Sentence two.")])
      )
    );

    const provider = new GeminiProvider("key", "gemini-2.0-flash");
    const tokens: string[] = [];
    for await (const t of provider.stream({ systemPrompt: "sys", userMessage: "go" })) {
      tokens.push(t);
    }
    expect(tokens).toEqual(["Sentence one. ", "Sentence two."]);
  });

  it("throws on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Bad key", { status: 401 }))
    );

    const provider = new GeminiProvider("bad-key", "gemini-2.0-flash");
    await expect(async () => {
      for await (const _ of provider.stream({ systemPrompt: "sys", userMessage: "go" })) {}
    }).rejects.toMatchObject({ status: 401 });
  });

  it("skips malformed SSE events gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeSSEStream([
          "data: {not valid json}",
          geminiEvent("valid token"),
        ])
      )
    );

    const provider = new GeminiProvider("key", "gemini-2.0-flash");
    const tokens: string[] = [];
    for await (const t of provider.stream({ systemPrompt: "sys", userMessage: "go" })) {
      tokens.push(t);
    }
    expect(tokens).toEqual(["valid token"]);
  });
});
