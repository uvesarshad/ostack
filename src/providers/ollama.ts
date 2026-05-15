import { LLMProvider, LLMRequest } from "./provider-interface";
import { fetchWithRetry } from "./retry";

export class OllamaProvider implements LLMProvider {
  constructor(private host: string, private model: string) {}

  async *stream(request: LLMRequest): AsyncGenerator<string, void, unknown> {
    const url = `${this.host.replace(/\/$/, "")}/api/chat`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    let response: Response;
    try {
      response = await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: request.systemPrompt },
            ...(request.messages
              ? request.messages.map((m) => ({ role: m.role, content: m.content }))
              : [{ role: "user", content: request.userMessage ?? "" }]),
          ],
          stream: true,
        }),
        signal: controller.signal,
      }, { signal: controller.signal });
    } catch (err: unknown) {
      clearTimeout(timeout);
      if ((err as { name?: string }).name === "AbortError") throw new Error("timeout");
      throw { status: 0, body: String(err) };
    }

    if (!response.ok) {
      clearTimeout(timeout);
      const body = await response.text();
      throw { status: response.status, body };
    }

    const reader = response.body?.getReader();
    if (!reader) { clearTimeout(timeout); return; }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // Ollama uses NDJSON: one JSON object per line, no SSE framing
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed: unknown;
          try { parsed = JSON.parse(trimmed); } catch { continue; }

          const p = parsed as Record<string, unknown>;
          const message = p.message as Record<string, unknown> | undefined;
          if (typeof message?.content === "string" && message.content) {
            yield message.content;
          }
          if (p.done === true) return;
        }
      }
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }
  }
}
