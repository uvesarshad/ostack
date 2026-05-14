import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClaudeProvider } from "../../providers/claude";

function makeSSEStream(events: string[]): Response {
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

function contentBlockDelta(text: string): string {
  return `data: ${JSON.stringify({
    type: "content_block_delta",
    delta: { type: "text_delta", text },
  })}`;
}

describe("ClaudeProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("yields tokens from SSE stream in order", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeSSEStream([
        contentBlockDelta("Hello"),
        contentBlockDelta(", world"),
        "data: [DONE]",
      ])
    );
    vi.stubGlobal("fetch", mockFetch);

    const provider = new ClaudeProvider("test-key", "claude-sonnet-4-6");
    const tokens: string[] = [];
    for await (const token of provider.stream({ systemPrompt: "sys", userMessage: "user" })) {
      tokens.push(token);
    }

    expect(tokens).toEqual(["Hello", ", world"]);
  });

  it("throws with status 401 on invalid API key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }))
    );

    const provider = new ClaudeProvider("bad-key", "claude-sonnet-4-6");
    await expect(async () => {
      for await (const _ of provider.stream({ systemPrompt: "sys", userMessage: "user" })) {}
    }).rejects.toMatchObject({ status: 401 });
  });

  it("propagates network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const provider = new ClaudeProvider("key", "model");
    await expect(async () => {
      for await (const _ of provider.stream({ systemPrompt: "sys", userMessage: "user" })) {}
    }).rejects.toThrow();
  });

  it("stops gracefully on [DONE]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeSSEStream([contentBlockDelta("token"), "data: [DONE]", contentBlockDelta("after-done")])
      )
    );

    const provider = new ClaudeProvider("key", "model");
    const tokens: string[] = [];
    for await (const t of provider.stream({ systemPrompt: "sys", userMessage: "user" })) {
      tokens.push(t);
    }
    expect(tokens).toEqual(["token"]);
  });

  it("skips non-content SSE events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeSSEStream([
          `data: ${JSON.stringify({ type: "message_start" })}`,
          contentBlockDelta("real token"),
          `data: ${JSON.stringify({ type: "message_stop" })}`,
          "data: [DONE]",
        ])
      )
    );

    const provider = new ClaudeProvider("key", "model");
    const tokens: string[] = [];
    for await (const t of provider.stream({ systemPrompt: "sys", userMessage: "user" })) {
      tokens.push(t);
    }
    expect(tokens).toEqual(["real token"]);
  });
});
