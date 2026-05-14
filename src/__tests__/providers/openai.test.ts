import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIProvider } from "../../providers/openai";

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

function deltaEvent(content: string): string {
  return `data: ${JSON.stringify({
    choices: [{ delta: { content } }],
  })}`;
}

describe("OpenAIProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("yields tokens from SSE stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeSSEStream([deltaEvent("Hi"), deltaEvent(" there"), "data: [DONE]"])
      )
    );

    const provider = new OpenAIProvider("key", "gpt-4o");
    const tokens: string[] = [];
    for await (const t of provider.stream({ systemPrompt: "sys", userMessage: "go" })) {
      tokens.push(t);
    }
    expect(tokens).toEqual(["Hi", " there"]);
  });

  it("throws with status on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }))
    );

    const provider = new OpenAIProvider("key", "gpt-4o");
    await expect(async () => {
      for await (const _ of provider.stream({ systemPrompt: "sys", userMessage: "go" })) {}
    }).rejects.toMatchObject({ status: 403 });
  });

  it("stops at [DONE]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeSSEStream([deltaEvent("only this"), "data: [DONE]", deltaEvent("ignored")])
      )
    );

    const provider = new OpenAIProvider("key", "gpt-4o");
    const tokens: string[] = [];
    for await (const t of provider.stream({ systemPrompt: "sys", userMessage: "go" })) {
      tokens.push(t);
    }
    expect(tokens).toEqual(["only this"]);
  });
});
