import { GStackSettings } from "../settings";
import { ClaudeProvider } from "./claude";
import { GeminiProvider } from "./gemini";
import { OllamaProvider } from "./ollama";
import { OpenAIProvider } from "./openai";

export interface LLMRequest {
  systemPrompt: string;
  userMessage: string;
  model?: string;
}

export interface LLMProvider {
  stream(request: LLMRequest): AsyncGenerator<string, void, unknown>;
}

export function getProvider(settings: GStackSettings): LLMProvider {
  switch (settings.provider) {
    case "claude":
      return new ClaudeProvider(settings.apiKey, settings.model || "claude-sonnet-4-6");
    case "openai":
      return new OpenAIProvider(settings.apiKey, settings.model || "gpt-4o");
    case "gemini":
      return new GeminiProvider(settings.apiKey, settings.model || "gemini-2.0-flash");
    case "ollama":
      return new OllamaProvider(settings.ollamaHost, settings.model || "llama3.2");
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
    case "ollama":
      return new OllamaProvider(settings.ollamaHost, scoutModel);
  }
}
