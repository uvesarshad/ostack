import { App } from "obsidian";
import {
  ClaudeProvider,
  ClaudeMessage,
  ClaudeContentBlock,
  ClaudeStreamEvent,
} from "./providers/claude";
import { executeVaultTool, resolveTools } from "./tools/vault-tools";

export type AgentEvent =
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; output: string; isError: boolean }
  | { type: "text_delta"; text: string }
  | { type: "error"; message: string };

const MAX_TOOL_ROUNDS = 10;

// Streaming agentic loop on top of Claude's tool-use API.
//
// Each round we open a streaming request, fan out:
//   - text_delta events (live to caller)
//   - completed tool_use blocks (assembled from input_json_delta chunks)
// When the stream's stop_reason is "tool_use", we execute the buffered tool
// calls, append their results, and start another streaming request.
// When stop_reason is "end_turn" (or any non-tool reason), we're done.
export async function* runClaudeAgent(args: {
  app: App;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  priorMessages?: { role: "user" | "assistant"; content: string }[];
  allowedTools: string[] | null;
  signal?: AbortSignal;
}): AsyncGenerator<AgentEvent, void, unknown> {
  const { app, apiKey, model, systemPrompt, userMessage, priorMessages, allowedTools, signal } = args;

  const tools = resolveTools(allowedTools).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as unknown as Record<string, unknown>,
  }));

  const provider = new ClaudeProvider(apiKey, model);

  const messages: ClaudeMessage[] = [];
  for (const m of priorMessages ?? []) {
    messages.push({ role: m.role, content: m.content });
  }
  messages.push({ role: "user", content: userMessage });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal?.aborted) return;

    // Collect this turn's assistant content blocks so we can record them
    // verbatim into the conversation history for the next request.
    const turnAssistantContent: ClaudeContentBlock[] = [];
    const pendingTextChunks: string[] = [];
    const pendingToolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    let stopReason = "end_turn";

    try {
      const stream: AsyncGenerator<ClaudeStreamEvent> = provider.streamWithTools(
        systemPrompt,
        messages,
        tools,
        signal
      );
      for await (const evt of stream) {
        if (signal?.aborted) return;
        if (evt.type === "text") {
          pendingTextChunks.push(evt.text);
          yield { type: "text_delta", text: evt.text };
        } else if (evt.type === "tool_use") {
          pendingToolCalls.push({ id: evt.id, name: evt.name, input: evt.input });
        } else if (evt.type === "stop") {
          stopReason = evt.stopReason;
        }
      }
    } catch (err: unknown) {
      const e = err as { status?: number; body?: string; message?: string };
      yield { type: "error", message: e.body ?? e.message ?? "Claude API request failed" };
      return;
    }

    // Reconstruct the assistant turn's content blocks for the next round
    if (pendingTextChunks.length > 0) {
      turnAssistantContent.push({ type: "text", text: pendingTextChunks.join("") });
    }
    for (const tu of pendingToolCalls) {
      turnAssistantContent.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
    }

    if (stopReason !== "tool_use" || pendingToolCalls.length === 0) {
      // Model finished — no more tools to run
      return;
    }

    messages.push({ role: "assistant", content: turnAssistantContent });

    const toolResultBlocks: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }> = [];

    for (const tu of pendingToolCalls) {
      if (signal?.aborted) return;
      yield { type: "tool_call", id: tu.id, name: tu.name, input: tu.input };
      let output: string;
      let isError = false;
      try {
        output = await executeVaultTool(app, tu.name, tu.input);
        if (output.startsWith("ERROR:")) isError = true;
      } catch (err: unknown) {
        output = `ERROR: ${(err as Error).message}`;
        isError = true;
      }
      yield { type: "tool_result", id: tu.id, name: tu.name, output, isError };
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: output,
        is_error: isError || undefined,
      });
    }

    messages.push({ role: "user", content: toolResultBlocks });
  }

  yield { type: "error", message: `Agent stopped after ${MAX_TOOL_ROUNDS} tool rounds (loop guard).` };
}
