import { requestUrl } from "obsidian";
import { LLMProvider, LLMRequest } from "./provider-interface";

export class OllamaProvider implements LLMProvider {
  constructor(private host: string, private model: string) {}

  async *stream(request: LLMRequest): AsyncGenerator<string, void, unknown> {
    const url = `${this.host.replace(/\/$/, "")}/api/generate`;

    let result: Awaited<ReturnType<typeof requestUrl>>;
    try {
      result = await requestUrl({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt: `${request.systemPrompt}\n\n${request.userMessage}`,
          stream: false,
        }),
      });
    } catch (err: unknown) {
      throw { status: 0, body: String(err) };
    }

    if (result.status < 200 || result.status >= 300) {
      throw { status: result.status, body: result.text };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      throw { status: 200, body: "Ollama returned non-JSON response" };
    }

    const p = parsed as Record<string, unknown>;
    if (typeof p.response === "string") {
      yield p.response;
    }
  }
}
