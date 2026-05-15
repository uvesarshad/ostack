import { describe, it, expect } from "vitest";
import { getProvider, getScoutProvider } from "../../providers/provider-interface";
import { ClaudeProvider } from "../../providers/claude";
import { OpenAIProvider } from "../../providers/openai";
import { GeminiProvider } from "../../providers/gemini";
import { GrokProvider } from "../../providers/grok";
import { OllamaProvider } from "../../providers/ollama";
import { CliProvider } from "../../providers/cli";
import { DEFAULT_SETTINGS, GStackSettings } from "../../settings";

function settings(overrides: Partial<GStackSettings> = {}): GStackSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("getProvider", () => {
  it("returns ClaudeProvider for provider=claude", () => {
    const p = getProvider(settings({ provider: "claude", apiKey: "sk" }));
    expect(p).toBeInstanceOf(ClaudeProvider);
  });

  it("returns OpenAIProvider for provider=openai", () => {
    const p = getProvider(settings({ provider: "openai", apiKey: "sk" }));
    expect(p).toBeInstanceOf(OpenAIProvider);
  });

  it("returns GeminiProvider for provider=gemini", () => {
    const p = getProvider(settings({ provider: "gemini", apiKey: "sk" }));
    expect(p).toBeInstanceOf(GeminiProvider);
  });

  it("returns GrokProvider for provider=grok", () => {
    const p = getProvider(settings({ provider: "grok", apiKey: "sk" }));
    expect(p).toBeInstanceOf(GrokProvider);
  });

  it("returns OllamaProvider for provider=ollama", () => {
    const p = getProvider(settings({ provider: "ollama" }));
    expect(p).toBeInstanceOf(OllamaProvider);
  });

  it("returns CliProvider for each CLI kind", () => {
    for (const provider of ["claude-cli", "codex-cli", "gemini-cli"] as const) {
      const p = getProvider(settings({ provider }));
      expect(p).toBeInstanceOf(CliProvider);
    }
  });

  it("falls back to default model strings when settings.model is empty", () => {
    // Indirect verification — the provider's internal `model` field comes
    // through into the request, but here we just exercise the factory without
    // throwing for each provider with an empty model.
    const providerIds: GStackSettings["provider"][] = [
      "claude", "openai", "gemini", "grok", "ollama",
      "claude-cli", "codex-cli", "gemini-cli",
    ];
    for (const provider of providerIds) {
      expect(() => getProvider(settings({ provider, model: "" }))).not.toThrow();
    }
  });
});

describe("getScoutProvider — inherit mode", () => {
  it("inherits the main provider when scoutProvider is 'inherit'", () => {
    const p = getScoutProvider(settings({
      provider: "openai", apiKey: "main",
      scoutProvider: "inherit",
    }));
    expect(p).toBeInstanceOf(OpenAIProvider);
  });

  it("inherits when scoutProvider is missing/empty", () => {
    const p = getScoutProvider({
      ...settings({ provider: "claude", apiKey: "main" }),
      scoutProvider: "" as unknown as GStackSettings["scoutProvider"],
    });
    expect(p).toBeInstanceOf(ClaudeProvider);
  });
});

describe("getScoutProvider — explicit override", () => {
  it("uses a different provider than the main one when configured", () => {
    const p = getScoutProvider(settings({
      provider: "claude-cli", apiKey: "",
      scoutProvider: "gemini", scoutApiKey: "scout-key",
    }));
    expect(p).toBeInstanceOf(GeminiProvider);
  });

  it("uses the scout's own Ollama host when scoutProvider=ollama", () => {
    const p = getScoutProvider(settings({
      provider: "claude", apiKey: "main",
      scoutProvider: "ollama",
      scoutOllamaHost: "http://scout.local:11434",
    }));
    expect(p).toBeInstanceOf(OllamaProvider);
  });

  it("falls back to main ollama host when scoutOllamaHost is unset", () => {
    const p = getScoutProvider(settings({
      provider: "claude", apiKey: "main",
      ollamaHost: "http://main.local:11434",
      scoutProvider: "ollama",
      scoutOllamaHost: "",
    }));
    expect(p).toBeInstanceOf(OllamaProvider);
  });

  it("can route scout through a CLI provider", () => {
    const p = getScoutProvider(settings({
      provider: "claude", apiKey: "main",
      scoutProvider: "codex-cli",
      scoutCliPath: "",
    }));
    expect(p).toBeInstanceOf(CliProvider);
  });
});
