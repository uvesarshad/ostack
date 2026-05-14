import { LLMProvider, LLMRequest } from "./provider-interface";

export class GrokProvider implements LLMProvider {
  constructor(private apiKey: string, private model: string) {}

  async *stream(request: LLMRequest): AsyncGenerator<string, void, unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    let response: Response;
    try {
      response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
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
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      if ((err as { name?: string }).name === "AbortError") throw new Error("timeout");
      throw err;
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
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") return;

          let parsed: unknown;
          try { parsed = JSON.parse(data); } catch { continue; }

          const p = parsed as Record<string, unknown>;
          const choices = p.choices as Array<Record<string, unknown>> | undefined;
          const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
          if (typeof delta?.content === "string" && delta.content) {
            yield delta.content;
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }
  }
}
