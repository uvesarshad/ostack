import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { isSafeCliPath, isSafeModelName } from "./providers/cli";
import { getProvider } from "./providers/provider-interface";

export type ProviderId =
  | "claude"
  | "openai"
  | "gemini"
  | "ollama"
  | "grok"
  | "claude-cli"
  | "codex-cli"
  | "gemini-cli";

export interface GStackSettings {
  provider: ProviderId;
  apiKey: string;
  model: string;
  ollamaHost: string;
  maxTokens: number;
  outputMode: "inline" | "new-note";
  scoutEnabled: boolean;
  scoutModel: string;
  // Scout can run on a different provider than the main one — e.g. main = claude-cli,
  // scout = gemini API. "inherit" means reuse main provider's credentials.
  scoutProvider: ProviderId | "inherit";
  scoutApiKey: string;
  scoutCliPath: string;
  scoutOllamaHost: string;
  contextDecayDays: number;
  compactionThreshold: number;
  cliPath: string;
  // Agent skills (mode: agent in SKILL.md) can be granted write_note / append_note
  // tools. Off by default — a prompt-injected agent should not silently overwrite
  // vault files. When off, write tools return an error the agent reports back.
  allowAgentWrites: boolean;
  // Persisted floating-bar geometry (position + size). Not shown in settings UI.
  barGeometry?: { left: number; top: number; width: number; height: number; vw?: number; vh?: number };
}

export const DEFAULT_SETTINGS: GStackSettings = {
  provider: "claude",
  apiKey: "",
  model: "",
  ollamaHost: "http://localhost:11434",
  maxTokens: 6000,
  outputMode: "inline",
  scoutEnabled: true,
  scoutModel: "gemini-2.0-flash-lite",
  scoutProvider: "inherit",
  scoutApiKey: "",
  scoutCliPath: "",
  scoutOllamaHost: "http://localhost:11434",
  contextDecayDays: 14,
  compactionThreshold: 8000,
  cliPath: "",
  allowAgentWrites: false,
};

const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: "Claude (API key)",
  openai: "OpenAI (API key)",
  gemini: "Gemini (API key)",
  grok: "Grok / xAI (API key)",
  ollama: "Ollama (local)",
  "claude-cli": "Claude Code CLI (subscription)",
  "codex-cli": "Codex CLI (subscription)",
  "gemini-cli": "Gemini CLI (subscription)",
};

const API_KEY_LINKS: Record<ProviderId, string> = {
  claude: "Get your key at anthropic.com/api",
  openai: "Get your key at platform.openai.com/api-keys",
  gemini: "Get your key at aistudio.google.com",
  grok: "Get your key at x.ai (xAI console)",
  ollama: "No API key needed for local models.",
  "claude-cli": "Uses your Claude Code CLI auth (run `claude login` in terminal first).",
  "codex-cli": "Uses your Codex CLI auth (run `codex login` in terminal first).",
  "gemini-cli": "Uses your Gemini CLI auth (run `gemini auth` in terminal first).",
};

const MODEL_PLACEHOLDERS: Record<ProviderId, string> = {
  claude: "claude-sonnet-4-6",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
  grok: "grok-2-latest",
  ollama: "llama3.2",
  "claude-cli": "sonnet",
  "codex-cli": "gpt-5",
  "gemini-cli": "gemini-2.5-pro",
};

function isCliProvider(p: ProviderId): boolean {
  return p === "claude-cli" || p === "codex-cli" || p === "gemini-cli";
}

function isApiKeyProvider(p: ProviderId): boolean {
  return p === "claude" || p === "openai" || p === "gemini" || p === "grok";
}

interface PluginWithSettings extends Plugin {
  settings: GStackSettings;
  saveSettings(): Promise<void>;
}

export class GStackSettingTab extends PluginSettingTab {
  plugin: PluginWithSettings;

  constructor(app: App, plugin: PluginWithSettings) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- Provider ---
    new Setting(containerEl).setName("Provider").setHeading();

    const providerSetting = new Setting(containerEl)
      .setName("AI provider")
      .setDesc("Which AI service runs your skills.");

    let apiKeySetting: Setting;
    let apiKeyDisclaimerEl: HTMLElement;
    let apiKeyTextField: { setDesc: (s: string) => void } | null = null;
    let ollamaHostSetting: Setting;
    let cliPathSetting: Setting;

    providerSetting.addDropdown((dd) => {
      for (const [value, label] of Object.entries(PROVIDER_LABELS)) {
        dd.addOption(value, label);
      }
      dd.setValue(this.plugin.settings.provider);
      dd.onChange(async (value) => {
        this.plugin.settings.provider = value as ProviderId;
        await this.plugin.saveSettings();
        this.updateProviderUI(
          value as ProviderId,
          apiKeySetting,
          apiKeyDisclaimerEl,
          ollamaHostSetting,
          cliPathSetting
        );
        if (apiKeyTextField) {
          apiKeySetting.setDesc(API_KEY_LINKS[value as ProviderId]);
        }
        const placeholder = MODEL_PLACEHOLDERS[value as ProviderId];
        modelTextField?.setPlaceholder(`Default (${placeholder})`);
      });
    });

    apiKeySetting = new Setting(containerEl)
      .setName("API key")
      .setDesc(API_KEY_LINKS[this.plugin.settings.provider]);

    let modelTextField: { setPlaceholder(s: string): unknown } | null = null;

    apiKeySetting.addText((text) => {
      text
        .setPlaceholder("Paste your API key here")
        .setValue(this.plugin.settings.apiKey);
      text.inputEl.type = "password";
      text.onChange(async (value) => {
        this.plugin.settings.apiKey = value;
        await this.plugin.saveSettings();
      });
      apiKeyTextField = text as unknown as { setDesc: (s: string) => void };
    });

    apiKeyDisclaimerEl = containerEl.createEl("p", {
      cls: "gstack-api-disclaimer",
      text: "⚠ Security notice: API keys are stored in plaintext at .obsidian/plugins/ogstack/data.json inside your vault. Obsidian Sync excludes plugin data by default, but third-party sync (Git, Dropbox, iCloud, etc.) will carry the key — exclude this file if you share the vault.",
    });

    const modelSetting = new Setting(containerEl)
      .setName("Model")
      .setDesc(
        `Leave blank for provider default (${MODEL_PLACEHOLDERS[this.plugin.settings.provider]}).`
      );

    modelSetting.addText((text) => {
      modelTextField = text;
      text
        .setPlaceholder(`Default (${MODEL_PLACEHOLDERS[this.plugin.settings.provider]})`)
        .setValue(this.plugin.settings.model);
      text.onChange(async (value) => {
        const trimmed = value.trim();
        if (!isSafeModelName(trimmed)) {
          modelSetting.setDesc("Model name rejected — allowed characters: letters, digits, ._:-/");
          modelSetting.settingEl.classList.add("mod-warning");
          return;
        }
        modelSetting.setDesc(`Leave blank for provider default (${MODEL_PLACEHOLDERS[this.plugin.settings.provider]}).`);
        modelSetting.settingEl.classList.remove("mod-warning");
        this.plugin.settings.model = trimmed;
        await this.plugin.saveSettings();
      });
    });

    ollamaHostSetting = new Setting(containerEl)
      .setName("Ollama host")
      .setDesc(
        "URL of your local Ollama server. Streams tokens as the model generates."
      );

    ollamaHostSetting.addText((text) => {
      text
        .setPlaceholder("http://localhost:11434")
        .setValue(this.plugin.settings.ollamaHost);

      text.inputEl.addEventListener("blur", async () => {
        const val = text.inputEl.value;
        if (val && !val.startsWith("http://") && !val.startsWith("https://")) {
          ollamaHostSetting.setDesc(
            "Host must start with http:// or https://"
          );
          ollamaHostSetting.settingEl.classList.add("mod-warning");
          return;
        }
        ollamaHostSetting.setDesc(
          "URL of your local Ollama server. Streams tokens as the model generates."
        );
        ollamaHostSetting.settingEl.classList.remove("mod-warning");
        this.plugin.settings.ollamaHost = val;
        await this.plugin.saveSettings();
      });
    });

    // Test-connection button — sends a tiny ping through the configured
    // provider and reports back. Helps users verify keys + reachability
    // without running a real skill.
    const testSetting = new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Send a short ping through the configured provider to verify credentials and reachability.");
    const testResult = containerEl.createEl("p", { cls: "gstack-test-connection-result" });
    testSetting.addButton((btn) => {
      btn.setButtonText("Test").onClick(async () => {
        btn.setDisabled(true);
        testResult.textContent = "Testing…";
        testResult.className = "gstack-test-connection-result";
        try {
          const adapter = this.app.vault.adapter as { getBasePath?: () => string; basePath?: string };
          const cwd = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : adapter.basePath;
          const provider = getProvider(this.plugin.settings, cwd);
          const stream = provider.stream({ systemPrompt: "Reply with only the word 'pong'.", userMessage: "ping" });
          let sawAnything = false;
          for await (const _token of stream) {
            sawAnything = true;
            break; // we just need the first token
          }
          if (sawAnything) {
            testResult.textContent = "✓ Connection OK — provider responded.";
            testResult.className = "gstack-test-connection-result gstack-test-connection-ok";
          } else {
            testResult.textContent = "⚠ Connected but no tokens streamed back. Check the model name.";
            testResult.className = "gstack-test-connection-result gstack-test-connection-warn";
          }
        } catch (err: unknown) {
          const e = err as { status?: number; body?: string; message?: string };
          const detail = e.status === 401
            ? "invalid API key"
            : e.status === 0 || !e.status
              ? (e.body ?? e.message ?? "could not reach provider")
              : `HTTP ${e.status} — ${e.body ?? e.message ?? ""}`;
          testResult.textContent = `✕ ${detail}`;
          testResult.className = "gstack-test-connection-result gstack-test-connection-err";
        } finally {
          btn.setDisabled(false);
        }
      });
    });

    cliPathSetting = new Setting(containerEl)
      .setName("CLI binary path")
      .setDesc("Optional. Leave blank to use the system PATH (recommended). Override only if the CLI is installed in a non-standard location. Spaces and shell metacharacters are not allowed.");

    cliPathSetting.addText((text) => {
      text
        .setPlaceholder("auto-detect from PATH")
        .setValue(this.plugin.settings.cliPath)
        .onChange(async (value) => {
          const trimmed = value.trim();
          if (!isSafeCliPath(trimmed)) {
            cliPathSetting.setDesc("Path rejected — contains spaces or shell metacharacters. Move the binary somewhere safe, or use PATH.");
            cliPathSetting.settingEl.classList.add("mod-warning");
            return;
          }
          cliPathSetting.setDesc("Optional. Leave blank to use the system PATH (recommended). Override only if the CLI is installed in a non-standard location. Spaces and shell metacharacters are not allowed.");
          cliPathSetting.settingEl.classList.remove("mod-warning");
          this.plugin.settings.cliPath = trimmed;
          await this.plugin.saveSettings();
        });
    });

    this.updateProviderUI(
      this.plugin.settings.provider,
      apiKeySetting,
      apiKeyDisclaimerEl,
      ollamaHostSetting,
      cliPathSetting
    );

    // --- Context ---
    new Setting(containerEl).setName("Context").setHeading();

    const maxTokensSetting = new Setting(containerEl)
      .setName("Token budget")
      .setDesc(
        "How many tokens of linked notes to include. Your active note is always included in full."
      );

    maxTokensSetting.addSlider((slider) => {
      const valueEl = maxTokensSetting.settingEl.createEl("span", {
        text: String(this.plugin.settings.maxTokens),
      });
      valueEl.style.marginLeft = "8px";
      slider
        .setLimits(1000, 16000, 500)
        .setValue(this.plugin.settings.maxTokens)
        .onChange(async (value) => {
          valueEl.innerText = String(value);
          this.plugin.settings.maxTokens = value;
          await this.plugin.saveSettings();
        });
    });

    new Setting(containerEl)
      .setName("Context Scout")
      .setDesc(
        "Before the main model runs, a fast small model scores each candidate note's relevance — keeping stale or off-topic notes out of context. Recommended on."
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.scoutEnabled).onChange(async (value) => {
          this.plugin.settings.scoutEnabled = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Scout model")
      .setDesc("The model used for relevance scoring. gemini-2.0-flash-lite is recommended (low cost, 8s timeout).")
      .addText((text) => {
        text
          .setPlaceholder("gemini-2.0-flash-lite")
          .setValue(this.plugin.settings.scoutModel)
          .onChange(async (value) => {
            this.plugin.settings.scoutModel = value;
            await this.plugin.saveSettings();
          });
      });

    // Scout provider — defaults to inheriting from main, but can be set independently
    // so users running e.g. Claude CLI for chat can still scout with a cheap API model.
    let scoutApiKeySetting: Setting;
    let scoutCliPathSetting: Setting;
    let scoutOllamaSetting: Setting;

    new Setting(containerEl)
      .setName("Scout provider")
      .setDesc("Which provider runs the scout. Use \"Inherit\" to reuse your main provider's credentials, or pick a separate one (e.g. cheap Gemini key) when the main provider is a CLI.")
      .addDropdown((dd) => {
        dd.addOption("inherit", "Inherit from main provider");
        for (const [value, label] of Object.entries(PROVIDER_LABELS)) {
          dd.addOption(value, label);
        }
        dd.setValue(this.plugin.settings.scoutProvider);
        dd.onChange(async (value) => {
          this.plugin.settings.scoutProvider = value as ProviderId | "inherit";
          await this.plugin.saveSettings();
          this.updateScoutUI(
            this.plugin.settings.scoutProvider,
            scoutApiKeySetting,
            scoutCliPathSetting,
            scoutOllamaSetting
          );
        });
      });

    scoutApiKeySetting = new Setting(containerEl)
      .setName("Scout API key")
      .setDesc("API key for the scout provider (only when scout uses a different provider than main).")
      .addText((text) => {
        text
          .setPlaceholder("Paste scout API key")
          .setValue(this.plugin.settings.scoutApiKey);
        text.inputEl.type = "password";
        text.onChange(async (value) => {
          this.plugin.settings.scoutApiKey = value;
          await this.plugin.saveSettings();
        });
      });

    scoutCliPathSetting = new Setting(containerEl)
      .setName("Scout CLI path")
      .setDesc("Optional CLI binary path for scout. Leave blank to use PATH.")
      .addText((text) => {
        text
          .setPlaceholder("auto-detect from PATH")
          .setValue(this.plugin.settings.scoutCliPath)
          .onChange(async (value) => {
            this.plugin.settings.scoutCliPath = value.trim();
            await this.plugin.saveSettings();
          });
      });

    scoutOllamaSetting = new Setting(containerEl)
      .setName("Scout Ollama host")
      .setDesc("Ollama URL for scout, if scout uses Ollama.")
      .addText((text) => {
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.scoutOllamaHost)
          .onChange(async (value) => {
            this.plugin.settings.scoutOllamaHost = value.trim();
            await this.plugin.saveSettings();
          });
      });

    this.updateScoutUI(
      this.plugin.settings.scoutProvider,
      scoutApiKeySetting,
      scoutCliPathSetting,
      scoutOllamaSetting
    );

    const decaySetting = new Setting(containerEl)
      .setName("Context decay")
      .setDesc("Notes older than this many days are down-scored when assembling context.");

    decaySetting.addSlider((slider) => {
      const valueEl = decaySetting.settingEl.createEl("span", {
        text: `${this.plugin.settings.contextDecayDays} days`,
      });
      valueEl.style.marginLeft = "8px";
      slider
        .setLimits(1, 90, 1)
        .setValue(this.plugin.settings.contextDecayDays)
        .onChange(async (value) => {
          valueEl.innerText = `${value} days`;
          this.plugin.settings.contextDecayDays = value;
          await this.plugin.saveSettings();
        });
    });

    // --- Output ---
    new Setting(containerEl).setName("Output").setHeading();

    new Setting(containerEl)
      .setName("Default output mode")
      .setDesc(
        "Where skill output lands. Individual skills can override this via their SKILL.md output: field. Inline streams into the current note at cursor. New note creates a separate file in the same folder."
      )
      .addDropdown((dd) => {
        dd.addOption("inline", "Inline (at cursor)");
        dd.addOption("new-note", "New note");
        dd.setValue(this.plugin.settings.outputMode);
        dd.onChange(async (value) => {
          this.plugin.settings.outputMode = value as GStackSettings["outputMode"];
          await this.plugin.saveSettings();
        });
      });

    // --- Agent safety ---
    new Setting(containerEl).setName("Agent safety").setHeading();

    new Setting(containerEl)
      .setName("Allow agent file writes")
      .setDesc(
        "When ON, agent skills (mode: agent) can call write_note and append_note to create or overwrite notes. When OFF (default), those tools return an error and the agent reports back without writing. Recommended OFF — a prompt-injected agent should not silently modify your vault."
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.allowAgentWrites).onChange(async (value) => {
          this.plugin.settings.allowAgentWrites = value;
          await this.plugin.saveSettings();
        });
      });
  }

  private updateProviderUI(
    provider: ProviderId,
    apiKeySetting: Setting,
    disclaimerEl: HTMLElement,
    ollamaHostSetting: Setting,
    cliPathSetting: Setting
  ): void {
    const showApiKey = isApiKeyProvider(provider);
    const showOllama = provider === "ollama";
    const showCli = isCliProvider(provider);
    apiKeySetting.settingEl.classList.toggle("gstack-hidden", !showApiKey);
    disclaimerEl.classList.toggle("gstack-hidden", !showApiKey);
    ollamaHostSetting.settingEl.classList.toggle("gstack-hidden", !showOllama);
    cliPathSetting.settingEl.classList.toggle("gstack-hidden", !showCli);
  }

  private updateScoutUI(
    scoutProvider: ProviderId | "inherit",
    apiKeySetting: Setting,
    cliPathSetting: Setting,
    ollamaSetting: Setting
  ): void {
    // When inheriting, hide all scout-specific credential fields
    if (scoutProvider === "inherit") {
      apiKeySetting.settingEl.classList.add("gstack-hidden");
      cliPathSetting.settingEl.classList.add("gstack-hidden");
      ollamaSetting.settingEl.classList.add("gstack-hidden");
      return;
    }
    const showApiKey = isApiKeyProvider(scoutProvider);
    const showOllama = scoutProvider === "ollama";
    const showCli = isCliProvider(scoutProvider);
    apiKeySetting.settingEl.classList.toggle("gstack-hidden", !showApiKey);
    cliPathSetting.settingEl.classList.toggle("gstack-hidden", !showCli);
    ollamaSetting.settingEl.classList.toggle("gstack-hidden", !showOllama);
  }
}
