import { LLMProvider, LLMRequest } from "./provider-interface";
import { fetchWithRetry } from "./retry";

// Anthropic content-block shapes for tool use (subset of the full schema).
export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export interface ClaudeMessage {
  role: "user" | "assistant";
  // Strings are auto-wrapped into a single text block by the API. We keep
  // structured arrays for tool_use / tool_result rounds.
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  >;
}

export interface ClaudeToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ClaudeCompletion {
  stopReason: string;
  content: ClaudeContentBlock[];
}

export type ClaudeStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "stop"; stopReason: string };

export class ClaudeProvider implements LLMProvider {
  constructor(private apiKey: string, private model: string) {}

  // Streaming completion with optional tools. Yields structured events so the
  // agent loop can render text deltas live AND collect full tool_use blocks
  // (which arrive as input_json_delta chunks that we re-assemble).
  async *streamWithTools(
    systemPrompt: string,
    messages: ClaudeMessage[],
    tools: ClaudeToolDef[],
    signal?: AbortSignal
  ): AsyncGenerator<ClaudeStreamEvent, void, unknown> {
    // Combine the caller's signal with a 120s timeout so a hung stream can't
    // wedge the agent loop forever. Either source aborts the underlying fetch.
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 120_000);
    const onCallerAbort = () => timeoutController.abort();
    if (signal) {
      if (signal.aborted) timeoutController.abort();
      else signal.addEventListener("abort", onCallerAbort, { once: true });
    }

    let response: Response;
    try {
      response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          system: systemPrompt,
          messages,
          tools,
          stream: true,
        }),
        signal: timeoutController.signal,
      }, { signal: timeoutController.signal });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onCallerAbort);
      if ((err as { name?: string }).name === "AbortError") {
        // Distinguish caller-cancelled vs timeout — caller signal stays set,
        // timeout fires through timeoutController only.
        if (signal?.aborted) throw err;
        throw new Error("timeout");
      }
      throw err;
    }
    if (!response.ok) {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onCallerAbort);
      const body = await response.text();
      throw { status: response.status, body };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onCallerAbort);
      return;
    }
    const decoder = new TextDecoder();

    // Per-block scratch state. Claude sends content_block_start with the block
    // shape, then deltas until content_block_stop.
    const blocks: Record<number, { type: "text" | "tool_use"; id?: string; name?: string; partialJson: string }> = {};
    let stopReason = "end_turn";
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
          if (!data || data === "[DONE]") continue;

          let evt: Record<string, unknown>;
          try { evt = JSON.parse(data); } catch { continue; }

          const type = evt.type as string;

          if (type === "content_block_start") {
            const idx = evt.index as number;
            const cb = evt.content_block as { type: string; id?: string; name?: string };
            if (cb.type === "text") {
              blocks[idx] = { type: "text", partialJson: "" };
            } else if (cb.type === "tool_use") {
              blocks[idx] = { type: "tool_use", id: cb.id, name: cb.name, partialJson: "" };
            }
          } else if (type === "content_block_delta") {
            const idx = evt.index as number;
            const delta = evt.delta as { type: string; text?: string; partial_json?: string };
            const block = blocks[idx];
            if (!block) continue;
            if (delta.type === "text_delta" && typeof delta.text === "string") {
              yield { type: "text", text: delta.text };
            } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
              block.partialJson += delta.partial_json;
            }
          } else if (type === "content_block_stop") {
            const idx = evt.index as number;
            const block = blocks[idx];
            if (block?.type === "tool_use" && block.id && block.name) {
              let input: Record<string, unknown> = {};
              try {
                input = block.partialJson ? JSON.parse(block.partialJson) : {};
              } catch {
                // malformed JSON from model — pass empty input, tool will error
              }
              yield { type: "tool_use", id: block.id, name: block.name, input };
            }
            delete blocks[idx];
          } else if (type === "message_delta") {
            const delta = evt.delta as { stop_reason?: string };
            if (delta?.stop_reason) stopReason = delta.stop_reason;
          } else if (type === "message_stop") {
            yield { type: "stop", stopReason };
            return;
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onCallerAbort);
      reader.releaseLock();
    }
  }

  // Non-streaming completion with optional tools. Kept for unit tests and as a
  // fallback path; the agent loop uses streamWithTools.
  async complete(
    systemPrompt: string,
    messages: ClaudeMessage[],
    tools?: ClaudeToolDef[],
    signal?: AbortSignal
  ): Promise<ClaudeCompletion> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    };
    if (tools && tools.length > 0) body.tools = tools;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const errBody = await response.text();
      throw { status: response.status, body: errBody };
    }
    const json = (await response.json()) as { stop_reason: string; content: ClaudeContentBlock[] };
    return { stopReason: json.stop_reason, content: json.content };
  }

  async *stream(request: LLMRequest): AsyncGenerator<string, void, unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    let response: Response;
    try {
      response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
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
