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

export function getProvider(settings: GStackSettings, cwd?: string): LLMProvider {
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
      return new CliProvider(settings.provider as CliKind, model, settings.cliPath, cwd);
  }
}

export function getScoutProvider(settings: GStackSettings, cwd?: string): LLMProvider {
  const scoutModel = settings.scoutModel || "gemini-2.0-flash-lite";

  // Resolve which provider + credentials the scout should use. "inherit" means
  // reuse the main provider config (just with the scout model).
  const useInherit = settings.scoutProvider === "inherit" || !settings.scoutProvider;
  const scoutProviderId = (useInherit ? settings.provider : settings.scoutProvider) as GStackSettings["provider"];
  const scoutApiKey = useInherit ? settings.apiKey : settings.scoutApiKey;
  const scoutCliPath = useInherit ? settings.cliPath : settings.scoutCliPath;
  const scoutOllamaHost = useInherit ? settings.ollamaHost : (settings.scoutOllamaHost || settings.ollamaHost);

  switch (scoutProviderId) {
    case "claude":
      return new ClaudeProvider(scoutApiKey, scoutModel);
    case "openai":
      return new OpenAIProvider(scoutApiKey, scoutModel);
    case "gemini":
      return new GeminiProvider(scoutApiKey, scoutModel);
    case "grok":
      return new GrokProvider(scoutApiKey, scoutModel);
    case "ollama":
      return new OllamaProvider(scoutOllamaHost, scoutModel);
    case "claude-cli":
    case "codex-cli":
    case "gemini-cli":
      return new CliProvider(scoutProviderId as CliKind, scoutModel, scoutCliPath, cwd);
  }
}
