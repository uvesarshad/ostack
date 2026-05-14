import { GStackSettings } from "../settings";
import { ClaudeProvider } from "./claude";
import { CliProvider, CliKind } from "./cli";
import { GeminiProvider } from "./gemini";
import { GrokProvider } from "./grok";
import { OllamaProvider } from "./ollama";
import { OpenAIProvider } from "./openai";

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  systemPrompt: string;
  userMessage?: string; // single-turn; ignored when messages is provided
  messages?: LLMMessage[]; // multi-turn conversation history
  model?: string;
}

export interface LLMProvider {
  stream(request: LLMRequest): AsyncGenerator<string, void, unknown>;
}

export function getProvider(settings: GStackSettings): LLMProvider {
  const model = settings.model;
  switch (settings.provider) {
    case "claude":
      return new ClaudeProvider(settings.apiKey, model || "claude-sonnet-4-6");
    case "openai":
      return new OpenAIProvider(settings.apiKey, model || "gpt-4o");
    case "gemini":
      return new GeminiProvider(settings.apiKey, model || "gemini-2.0-flash");
    case "grok":
      return new GrokProvider(settings.apiKey, model || "grok-2-latest");
    case "ollama":
      return new OllamaProvider(settings.ollamaHost, model || "llama3.2");
    case "claude-cli":
    case "codex-cli":
    case "gemini-cli":
      return new CliProvider(settings.provider as CliKind, model, settings.cliPath);
  }
}

export function getScoutProvider(settings: GStackSettings): LLMProvider {
  const scoutModel = settings.scoutModel || "gemini-2.0-flash-lite";
  switch (settings.provider) {
    case "claude":
      return new ClaudeProvider(settings.apiKey, scoutModel);
    case "openai":
      return new OpenAIProvider(settings.apiKey, scoutModel);
    case "gemini":
      return new GeminiProvider(settings.apiKey, scoutModel);
    case "grok":
      return new GrokProvider(settings.apiKey, scoutModel);
    case "ollama":
      return new OllamaProvider(settings.ollamaHost, scoutModel);
    case "claude-cli":
    case "codex-cli":
    case "gemini-cli":
      // CLI providers don't have a separate "scout" mode — fall back to main model
      return new CliProvider(settings.provider as CliKind, scoutModel, settings.cliPath);
  }
}
