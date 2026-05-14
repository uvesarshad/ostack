import { LLMProvider, LLMRequest } from "./provider-interface";

export class ClaudeProvider implements LLMProvider {
  constructor(private apiKey: string, private model: string) {}

  async *stream(request: LLMRequest): AsyncGenerator<string, void, unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          system: request.systemPrompt,
          messages: request.messages
            ? request.messages.map((m) => ({ role: m.role, content: m.content }))
            : [{ role: "user", content: request.userMessage ?? "" }],
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      if ((err as { name?: string }).name === "AbortError") {
        throw new Error("timeout");
      }
      throw err;
    }

    if (!response.ok) {
      clearTimeout(timeout);
      const body = await response.text();
      throw { status: response.status, body };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      clearTimeout(timeout);
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") return;

          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          const p = parsed as Record<string, unknown>;
          if (p.type === "content_block_delta") {
            const delta = p.delta as Record<string, unknown> | undefined;
            if (delta?.type === "text_delta" && typeof delta.text === "string") {
              yield delta.text;
            }
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }
  }
}
