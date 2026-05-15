import { describe, it, expect, vi, afterEach } from "vitest";
import { GrokProvider } from "../../providers/grok";

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

describe("GrokProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("yields tokens from SSE stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeSSEStream([deltaEvent("Grok"), deltaEvent(" says hi"), "data: [DONE]"])
      )
    );

    const provider = new GrokProvider("key", "grok-2-latest");
    const tokens: string[] = [];
    for await (const t of provider.stream({ systemPrompt: "sys", userMessage: "go" })) {
      tokens.push(t);
    }
    expect(tokens).toEqual(["Grok", " says hi"]);
  });

  it("posts to api.x.ai with bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeSSEStream([deltaEvent("ok"), "data: [DONE]"])
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GrokProvider("secret-key", "grok-2-latest");
    for await (const _ of provider.stream({ systemPrompt: "sys", userMessage: "go" })) { /* drain */ }

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe("Bearer secret-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("throws with status on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 401 }))
    );

    const provider = new GrokProvider("bad-key", "grok-2-latest");
    await expect(async () => {
      for await (const _ of provider.stream({ systemPrompt: "sys", userMessage: "go" })) { /* drain */ }
    }).rejects.toMatchObject({ status: 401 });
  });

  it("stops at [DONE] and discards subsequent events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeSSEStream([deltaEvent("only this"), "data: [DONE]", deltaEvent("ignored")])
      )
    );

    const provider = new GrokProvider("key", "grok-2-latest");
    const tokens: string[] = [];
    for await (const t of provider.stream({ systemPrompt: "sys", userMessage: "go" })) {
      tokens.push(t);
    }
    expect(tokens).toEqual(["only this"]);
  });

  it("uses messages[] when provided instead of userMessage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeSSEStream([deltaEvent("ok"), "data: [DONE]"])
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GrokProvider("key", "grok-2-latest");
    for await (const _ of provider.stream({
      systemPrompt: "sys",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "again" },
      ],
    })) { /* drain */ }

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "again" },
    ]);
  });
});
