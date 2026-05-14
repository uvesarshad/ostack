import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";

export interface GStackSettings {
  provider: "claude" | "openai" | "gemini" | "ollama";
  apiKey: string;
  model: string;
  ollamaHost: string;
  maxTokens: number;
  outputMode: "inline" | "new-note";
  scoutEnabled: boolean;
  scoutModel: string;
  contextDecayDays: number;
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
  contextDecayDays: 14,
};

const PROVIDER_LABELS: Record<GStackSettings["provider"], string> = {
  claude: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
  ollama: "Ollama (local)",
};

const API_KEY_LINKS: Record<GStackSettings["provider"], string> = {
  claude: "Get your key at anthropic.com/api",
  openai: "Get your key at platform.openai.com/api-keys",
  gemini: "Get your key at aistudio.google.com",
  ollama: "No API key needed for local models.",
};

const MODEL_PLACEHOLDERS: Record<GStackSettings["provider"], string> = {
  claude: "claude-sonnet-4-6",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
  ollama: "llama3.2",
};

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

    providerSetting.addDropdown((dd) => {
      for (const [value, label] of Object.entries(PROVIDER_LABELS)) {
        dd.addOption(value, label);
      }
      dd.setValue(this.plugin.settings.provider);
      dd.onChange(async (value) => {
        this.plugin.settings.provider = value as GStackSettings["provider"];
        await this.plugin.saveSettings();
        this.updateProviderUI(
          value as GStackSettings["provider"],
          apiKeySetting,
          apiKeyDisclaimerEl,
          ollamaHostSetting
        );
        if (apiKeyTextField) {
          apiKeySetting.setDesc(API_KEY_LINKS[value as GStackSettings["provider"]]);
        }
        const placeholder = MODEL_PLACEHOLDERS[value as GStackSettings["provider"]];
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
      text: "⚠ Security notice: API keys are stored in plaintext in your vault's data.json. Do not sync this vault to untrusted services or share it publicly.",
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
        this.plugin.settings.model = value;
        await this.plugin.saveSettings();
      });
    });

    ollamaHostSetting = new Setting(containerEl)
      .setName("Ollama host")
      .setDesc(
        "URL of your local Ollama server. Note: Ollama responses appear after generation completes — no streaming in v1."
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
          "URL of your local Ollama server. Note: Ollama responses appear after generation completes — no streaming in v1."
        );
        ollamaHostSetting.settingEl.classList.remove("mod-warning");
        this.plugin.settings.ollamaHost = val;
        await this.plugin.saveSettings();
      });
    });

    this.updateProviderUI(
      this.plugin.settings.provider,
      apiKeySetting,
      apiKeyDisclaimerEl,
      ollamaHostSetting
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
  }

  private updateProviderUI(
    provider: GStackSettings["provider"],
    apiKeySetting: Setting,
    disclaimerEl: HTMLElement,
    ollamaHostSetting: Setting
  ): void {
    const isOllama = provider === "ollama";
    apiKeySetting.settingEl.classList.toggle("gstack-hidden", isOllama);
    disclaimerEl.classList.toggle("gstack-hidden", isOllama);
    ollamaHostSetting.settingEl.classList.toggle("gstack-hidden", !isOllama);
  }
}
