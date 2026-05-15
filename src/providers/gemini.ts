import { LLMProvider, LLMRequest } from "./provider-interface";
import { fetchWithRetry } from "./retry";

export class GeminiProvider implements LLMProvider {
  constructor(private apiKey: string, private model: string) {}

  async *stream(request: LLMRequest): AsyncGenerator<string, void, unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;

    let response: Response;
    try {
      response = await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: request.systemPrompt }],
          },
          contents: request.messages
            ? request.messages.map((m) => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }],
              }))
            : [{ role: "user", parts: [{ text: request.userMessage ?? "" }] }],
        }),
        signal: controller.signal,
      }, { signal: controller.signal });
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
          if (!data) continue;

          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          const p = parsed as Record<string, unknown>;
          const candidates = p.candidates as Array<Record<string, unknown>> | undefined;
          const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
          const parts = content?.parts as Array<Record<string, unknown>> | undefined;
          const text = parts?.[0]?.text;
          if (typeof text === "string" && text) {
            yield text;
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }
  }
}
