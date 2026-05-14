var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => GStackPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian10 = require("obsidian");

// src/chat-store.ts
var ChatStore = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.sessions = [];
  }
  async load() {
    var _a;
    const data = await this.plugin.loadData();
    this.sessions = (_a = data == null ? void 0 : data.chatSessions) != null ? _a : [];
  }
  async persist() {
    var _a;
    const current = (_a = await this.plugin.loadData()) != null ? _a : {};
    current.chatSessions = this.sessions;
    await this.plugin.saveData(current);
  }
  getSessions() {
    return [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  getSessionsForNote(notePath) {
    return this.sessions.filter((s) => s.notePath === notePath).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  getSession(id) {
    return this.sessions.find((s) => s.id === id);
  }
  async createSession(notePath, noteTitle) {
    const session = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      notePath,
      noteTitle,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
    this.sessions.push(session);
    await this.persist();
    return session;
  }
  async addMessage(sessionId, role, content) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session)
      throw new Error(`Session ${sessionId} not found`);
    const msg = { role, content, timestamp: Date.now() };
    session.messages.push(msg);
    session.updatedAt = Date.now();
    await this.persist();
    return msg;
  }
  async updateLastAssistantMessage(sessionId, content) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session)
      return;
    const last = session.messages[session.messages.length - 1];
    if ((last == null ? void 0 : last.role) === "assistant") {
      last.content = content;
      session.updatedAt = Date.now();
      await this.persist();
    }
  }
  async deleteSession(id) {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    await this.persist();
  }
};

// src/settings.ts
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  provider: "claude",
  apiKey: "",
  model: "",
  ollamaHost: "http://localhost:11434",
  maxTokens: 6e3,
  outputMode: "inline",
  scoutEnabled: true,
  scoutModel: "gemini-2.0-flash-lite",
  contextDecayDays: 14
};
var PROVIDER_LABELS = {
  claude: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
  ollama: "Ollama (local)"
};
var API_KEY_LINKS = {
  claude: "Get your key at anthropic.com/api",
  openai: "Get your key at platform.openai.com/api-keys",
  gemini: "Get your key at aistudio.google.com",
  ollama: "No API key needed for local models."
};
var MODEL_PLACEHOLDERS = {
  claude: "claude-sonnet-4-6",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
  ollama: "llama3.2"
};
var GStackSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Provider").setHeading();
    const providerSetting = new import_obsidian.Setting(containerEl).setName("AI provider").setDesc("Which AI service runs your skills.");
    let apiKeySetting;
    let apiKeyDisclaimerEl;
    let apiKeyTextField = null;
    let ollamaHostSetting;
    providerSetting.addDropdown((dd) => {
      for (const [value, label] of Object.entries(PROVIDER_LABELS)) {
        dd.addOption(value, label);
      }
      dd.setValue(this.plugin.settings.provider);
      dd.onChange(async (value) => {
        this.plugin.settings.provider = value;
        await this.plugin.saveSettings();
        this.updateProviderUI(
          value,
          apiKeySetting,
          apiKeyDisclaimerEl,
          ollamaHostSetting
        );
        if (apiKeyTextField) {
          apiKeySetting.setDesc(API_KEY_LINKS[value]);
        }
        const placeholder = MODEL_PLACEHOLDERS[value];
        modelTextField == null ? void 0 : modelTextField.setPlaceholder(`Default (${placeholder})`);
      });
    });
    apiKeySetting = new import_obsidian.Setting(containerEl).setName("API key").setDesc(API_KEY_LINKS[this.plugin.settings.provider]);
    let modelTextField = null;
    apiKeySetting.addText((text) => {
      text.setPlaceholder("Paste your API key here").setValue(this.plugin.settings.apiKey);
      text.inputEl.type = "password";
      text.onChange(async (value) => {
        this.plugin.settings.apiKey = value;
        await this.plugin.saveSettings();
      });
      apiKeyTextField = text;
    });
    apiKeyDisclaimerEl = containerEl.createEl("p", {
      cls: "gstack-api-disclaimer",
      text: "\u26A0 Security notice: API keys are stored in plaintext in your vault's data.json. Do not sync this vault to untrusted services or share it publicly."
    });
    const modelSetting = new import_obsidian.Setting(containerEl).setName("Model").setDesc(
      `Leave blank for provider default (${MODEL_PLACEHOLDERS[this.plugin.settings.provider]}).`
    );
    modelSetting.addText((text) => {
      modelTextField = text;
      text.setPlaceholder(`Default (${MODEL_PLACEHOLDERS[this.plugin.settings.provider]})`).setValue(this.plugin.settings.model);
      text.onChange(async (value) => {
        this.plugin.settings.model = value;
        await this.plugin.saveSettings();
      });
    });
    ollamaHostSetting = new import_obsidian.Setting(containerEl).setName("Ollama host").setDesc(
      "URL of your local Ollama server. Note: Ollama responses appear after generation completes \u2014 no streaming in v1."
    );
    ollamaHostSetting.addText((text) => {
      text.setPlaceholder("http://localhost:11434").setValue(this.plugin.settings.ollamaHost);
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
          "URL of your local Ollama server. Note: Ollama responses appear after generation completes \u2014 no streaming in v1."
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
    new import_obsidian.Setting(containerEl).setName("Context").setHeading();
    const maxTokensSetting = new import_obsidian.Setting(containerEl).setName("Token budget").setDesc(
      "How many tokens of linked notes to include. Your active note is always included in full."
    );
    maxTokensSetting.addSlider((slider) => {
      const valueEl = maxTokensSetting.settingEl.createEl("span", {
        text: String(this.plugin.settings.maxTokens)
      });
      valueEl.style.marginLeft = "8px";
      slider.setLimits(1e3, 16e3, 500).setValue(this.plugin.settings.maxTokens).onChange(async (value) => {
        valueEl.innerText = String(value);
        this.plugin.settings.maxTokens = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Context Scout").setDesc(
      "Before the main model runs, a fast small model scores each candidate note's relevance \u2014 keeping stale or off-topic notes out of context. Recommended on."
    ).addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.scoutEnabled).onChange(async (value) => {
        this.plugin.settings.scoutEnabled = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Scout model").setDesc("The model used for relevance scoring. gemini-2.0-flash-lite is recommended (low cost, 8s timeout).").addText((text) => {
      text.setPlaceholder("gemini-2.0-flash-lite").setValue(this.plugin.settings.scoutModel).onChange(async (value) => {
        this.plugin.settings.scoutModel = value;
        await this.plugin.saveSettings();
      });
    });
    const decaySetting = new import_obsidian.Setting(containerEl).setName("Context decay").setDesc("Notes older than this many days are down-scored when assembling context.");
    decaySetting.addSlider((slider) => {
      const valueEl = decaySetting.settingEl.createEl("span", {
        text: `${this.plugin.settings.contextDecayDays} days`
      });
      valueEl.style.marginLeft = "8px";
      slider.setLimits(1, 90, 1).setValue(this.plugin.settings.contextDecayDays).onChange(async (value) => {
        valueEl.innerText = `${value} days`;
        this.plugin.settings.contextDecayDays = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Output").setHeading();
    new import_obsidian.Setting(containerEl).setName("Default output mode").setDesc(
      "Where skill output lands. Individual skills can override this via their SKILL.md output: field. Inline streams into the current note at cursor. New note creates a separate file in the same folder."
    ).addDropdown((dd) => {
      dd.addOption("inline", "Inline (at cursor)");
      dd.addOption("new-note", "New note");
      dd.setValue(this.plugin.settings.outputMode);
      dd.onChange(async (value) => {
        this.plugin.settings.outputMode = value;
        await this.plugin.saveSettings();
      });
    });
  }
  updateProviderUI(provider, apiKeySetting, disclaimerEl, ollamaHostSetting) {
    const isOllama = provider === "ollama";
    apiKeySetting.settingEl.classList.toggle("gstack-hidden", isOllama);
    disclaimerEl.classList.toggle("gstack-hidden", isOllama);
    ollamaHostSetting.settingEl.classList.toggle("gstack-hidden", !isOllama);
  }
};

// src/sidebar-view.ts
var import_obsidian6 = require("obsidian");

// src/context-builder.ts
var import_obsidian2 = require("obsidian");
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function scoreFile(depth, mtime, decayDays) {
  const daysSince = (Date.now() - mtime) / 864e5;
  return 1 / depth * 0.6 + Math.exp(-daysSince / decayDays) * 0.4;
}
var BFS_NODE_CAP = 200;
var MAX_DEPTH_CEILING = 5;
async function buildVaultContext(app, activeFile, settings, maxDepthOverride = 3, maxTokensOverride) {
  var _a, _b;
  if (!activeFile) {
    new import_obsidian2.Notice("gstack: open a note first");
    return null;
  }
  const maxDepth = Math.min(maxDepthOverride, MAX_DEPTH_CEILING);
  const effectiveMaxTokens = maxTokensOverride != null ? maxTokensOverride : settings.maxTokens;
  const tokenBudget = Math.floor(effectiveMaxTokens * 0.8);
  const activeContent = await app.vault.cachedRead(activeFile);
  const activeTokens = estimateTokens(activeContent);
  if (activeTokens >= tokenBudget) {
    return {
      activeNote: { path: activeFile.path, content: activeContent },
      linkedNotes: [],
      tokenCount: activeTokens,
      candidates: []
    };
  }
  const visited = /* @__PURE__ */ new Set([activeFile.path]);
  const queue = [];
  const candidates = [];
  const initialLinks = (_a = app.metadataCache.resolvedLinks[activeFile.path]) != null ? _a : {};
  for (const linkedPath of Object.keys(initialLinks)) {
    if (!visited.has(linkedPath)) {
      queue.push({ path: linkedPath, depth: 1 });
    }
  }
  let capReached = false;
  while (queue.length > 0) {
    const batch = queue.splice(0, queue.length);
    for (const { path, depth } of batch) {
      if (visited.has(path))
        continue;
      visited.add(path);
      const file = app.vault.getAbstractFileByPath(path);
      if (!file || !(file instanceof import_obsidian2.TFile))
        continue;
      const score = scoreFile(depth, file.stat.mtime, settings.contextDecayDays);
      candidates.push({ file, score, depth });
      if (candidates.length >= BFS_NODE_CAP) {
        capReached = true;
        break;
      }
      if (depth < maxDepth) {
        const links = (_b = app.metadataCache.resolvedLinks[path]) != null ? _b : {};
        for (const nextPath of Object.keys(links)) {
          if (!visited.has(nextPath)) {
            queue.push({ path: nextPath, depth: depth + 1 });
          }
        }
      }
    }
    if (capReached)
      break;
  }
  if (capReached) {
    new import_obsidian2.Notice("gstack: large vault \u2014 context capped at 200 notes");
  }
  candidates.sort((a, b) => b.score - a.score);
  let remaining = tokenBudget - activeTokens;
  const linkedNotes = [];
  const readResults = await Promise.allSettled(
    candidates.map((c) => app.vault.cachedRead(c.file))
  );
  for (let i = 0; i < candidates.length; i++) {
    const result = readResults[i];
    if (result.status === "rejected")
      continue;
    const content = result.value;
    const tokens = estimateTokens(content);
    if (tokens > remaining)
      continue;
    remaining -= tokens;
    linkedNotes.push({
      path: candidates[i].file.path,
      content,
      score: candidates[i].score,
      depth: candidates[i].depth
    });
  }
  const totalTokens = activeTokens + linkedNotes.reduce((sum, n) => sum + estimateTokens(n.content), 0);
  return {
    activeNote: { path: activeFile.path, content: activeContent },
    linkedNotes,
    tokenCount: totalTokens,
    candidates
  };
}
function formatVaultContext(ctx) {
  var _a, _b, _c, _d, _e;
  const activeTitle = (_b = (_a = ctx.activeNote.path.split("/").pop()) == null ? void 0 : _a.replace(/\.md$/, "")) != null ? _b : ctx.activeNote.path;
  const parts = [
    `<active-note title="${escapeAttr(activeTitle)}">
${ctx.activeNote.content}
</active-note>`
  ];
  for (const note of ctx.linkedNotes) {
    const title = (_d = (_c = note.path.split("/").pop()) == null ? void 0 : _c.replace(/\.md$/, "")) != null ? _d : note.path;
    const score = note.score.toFixed(2);
    const annotation = (_e = note.annotation) != null ? _e : "";
    if (note.summaryOnly && annotation) {
      parts.push(
        `<context title="${escapeAttr(title)}" score="${score}" depth="${note.depth}" annotation="${escapeAttr(annotation)}" summary-only="true">${annotation}</context>`
      );
    } else {
      const annotationAttr = annotation ? ` annotation="${escapeAttr(annotation)}"` : "";
      parts.push(
        `<context title="${escapeAttr(title)}" score="${score}" depth="${note.depth}"${annotationAttr}>
${note.content}
</context>`
      );
    }
  }
  return parts.join("\n\n");
}
function escapeAttr(s) {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// src/providers/claude.ts
var ClaudeProvider = class {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model;
  }
  async *stream(request) {
    var _a, _b, _c;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12e4);
    let response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          system: request.systemPrompt,
          messages: request.messages ? request.messages.map((m) => ({ role: m.role, content: m.content })) : [{ role: "user", content: (_a = request.userMessage) != null ? _a : "" }],
          stream: true
        }),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        throw new Error("timeout");
      }
      throw err;
    }
    if (!response.ok) {
      clearTimeout(timeout);
      const body = await response.text();
      throw { status: response.status, body };
    }
    const reader = (_b = response.body) == null ? void 0 : _b.getReader();
    if (!reader) {
      clearTimeout(timeout);
      return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done)
          break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = (_c = lines.pop()) != null ? _c : "";
        for (const line of lines) {
          if (!line.startsWith("data: "))
            continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]")
            return;
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            continue;
          }
          const p = parsed;
          if (p.type === "content_block_delta") {
            const delta = p.delta;
            if ((delta == null ? void 0 : delta.type) === "text_delta" && typeof delta.text === "string") {
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
};

// src/providers/gemini.ts
var GeminiProvider = class {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model;
  }
  async *stream(request) {
    var _a, _b, _c, _d, _e;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12e4);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: request.systemPrompt }]
          },
          contents: request.messages ? request.messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
          })) : [{ role: "user", parts: [{ text: (_a = request.userMessage) != null ? _a : "" }] }]
        }),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        throw new Error("timeout");
      }
      throw err;
    }
    if (!response.ok) {
      clearTimeout(timeout);
      const body = await response.text();
      throw { status: response.status, body };
    }
    const reader = (_b = response.body) == null ? void 0 : _b.getReader();
    if (!reader) {
      clearTimeout(timeout);
      return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done)
          break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = (_c = lines.pop()) != null ? _c : "";
        for (const line of lines) {
          if (!line.startsWith("data: "))
            continue;
          const data = line.slice(6).trim();
          if (!data)
            continue;
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            continue;
          }
          const p = parsed;
          const candidates = p.candidates;
          const content = (_d = candidates == null ? void 0 : candidates[0]) == null ? void 0 : _d.content;
          const parts = content == null ? void 0 : content.parts;
          const text = (_e = parts == null ? void 0 : parts[0]) == null ? void 0 : _e.text;
          if (typeof text === "string" && text) {
            yield text;
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }
  }
};

// src/providers/ollama.ts
var import_obsidian3 = require("obsidian");
var OllamaProvider = class {
  constructor(host, model) {
    this.host = host;
    this.model = model;
  }
  async *stream(request) {
    var _a;
    const url = `${this.host.replace(/\/$/, "")}/api/chat`;
    let result;
    try {
      result = await (0, import_obsidian3.requestUrl)({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: request.systemPrompt },
            ...request.messages ? request.messages.map((m) => ({ role: m.role, content: m.content })) : [{ role: "user", content: (_a = request.userMessage) != null ? _a : "" }]
          ],
          stream: false
        })
      });
    } catch (err) {
      throw { status: 0, body: String(err) };
    }
    if (result.status < 200 || result.status >= 300) {
      throw { status: result.status, body: result.text };
    }
    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch (e) {
      throw { status: 200, body: "Ollama returned non-JSON response" };
    }
    const p = parsed;
    const message = p.message;
    if (typeof (message == null ? void 0 : message.content) === "string") {
      yield message.content;
    }
  }
};

// src/providers/openai.ts
var OpenAIProvider = class {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model;
  }
  async *stream(request) {
    var _a, _b, _c, _d;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12e4);
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: request.systemPrompt },
            ...request.messages ? request.messages.map((m) => ({ role: m.role, content: m.content })) : [{ role: "user", content: (_a = request.userMessage) != null ? _a : "" }]
          ],
          stream: true
        }),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        throw new Error("timeout");
      }
      throw err;
    }
    if (!response.ok) {
      clearTimeout(timeout);
      const body = await response.text();
      throw { status: response.status, body };
    }
    const reader = (_b = response.body) == null ? void 0 : _b.getReader();
    if (!reader) {
      clearTimeout(timeout);
      return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done)
          break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = (_c = lines.pop()) != null ? _c : "";
        for (const line of lines) {
          if (!line.startsWith("data: "))
            continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]")
            return;
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            continue;
          }
          const p = parsed;
          const choices = p.choices;
          const delta = (_d = choices == null ? void 0 : choices[0]) == null ? void 0 : _d.delta;
          if (typeof (delta == null ? void 0 : delta.content) === "string" && delta.content) {
            yield delta.content;
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }
  }
};

// src/providers/provider-interface.ts
function getProvider(settings) {
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
function getScoutProvider(settings) {
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

// src/context-scout.ts
var SCOUT_CANDIDATE_CAP = 50;
var SCOUT_PREVIEW_CHARS = 200;
var SCOUT_TIMEOUT_MS = 8e3;
async function scoutContext(candidates, ctx, app, settings) {
  var _a, _b;
  const topCandidates = candidates.slice(0, SCOUT_CANDIDATE_CAP);
  if (topCandidates.length === 0)
    return null;
  const activeTitle = (_b = (_a = ctx.activeNote.path.split("/").pop()) == null ? void 0 : _a.replace(/\.md$/, "")) != null ? _b : ctx.activeNote.path;
  const activePreview = ctx.activeNote.content.slice(0, SCOUT_PREVIEW_CHARS);
  const candidateList = topCandidates.map((c, i) => {
    var _a2, _b2, _c, _d;
    const title = (_b2 = (_a2 = c.file.path.split("/").pop()) == null ? void 0 : _a2.replace(/\.md$/, "")) != null ? _b2 : c.file.path;
    const preview = ((_d = (_c = ctx.linkedNotes.find((n) => n.path === c.file.path)) == null ? void 0 : _c.content) != null ? _d : "").slice(0, SCOUT_PREVIEW_CHARS);
    return `${i + 1}. "${title}" \u2014 ${preview || "[no preview]"}`;
  }).join("\n");
  const systemPrompt = `You are a relevance scorer. The user is working on a note titled "${activeTitle}".
Active note preview: ${activePreview}

Below are candidate linked notes. Score each for relevance to the active note on a scale of 0.0 to 1.0 and provide a one-line annotation.

Return ONLY a JSON array with this exact structure:
[{"path": "<exact path>", "score": <0.0-1.0>, "annotation": "<one line>"}]

Candidate notes:
${candidateList}

Paths for reference:
${topCandidates.map((c) => `${topCandidates.indexOf(c) + 1}. ${c.file.path}`).join("\n")}`;
  const provider = getScoutProvider(settings);
  let raceResult;
  try {
    raceResult = await Promise.race([
      collectStream(provider, systemPrompt),
      new Promise((resolve) => setTimeout(() => resolve(null), SCOUT_TIMEOUT_MS))
    ]);
  } catch (e) {
    return null;
  }
  if (raceResult === null)
    return null;
  try {
    const jsonMatch = raceResult.match(/\[[\s\S]*\]/);
    if (!jsonMatch)
      return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed))
      return null;
    return parsed.filter(
      (r) => typeof r.path === "string" && typeof r.score === "number" && typeof r.annotation === "string"
    );
  } catch (e) {
    return null;
  }
}
async function collectStream(provider, systemPrompt) {
  let result = "";
  for await (const chunk of provider.stream({
    systemPrompt,
    userMessage: "Score the candidate notes now."
  })) {
    result += chunk;
  }
  return result;
}
function applyScoutResults(ctx, scoutResults, highScoreThreshold = 0.5) {
  const scoreMap = new Map(scoutResults.map((r) => [r.path, r]));
  const updatedNotes = ctx.linkedNotes.map((note) => {
    const scout = scoreMap.get(note.path);
    if (!scout)
      return note;
    return {
      ...note,
      score: scout.score,
      annotation: `Scout: ${scout.annotation}`,
      summaryOnly: scout.score < highScoreThreshold
    };
  });
  updatedNotes.sort((a, b) => b.score - a.score);
  return { ...ctx, linkedNotes: updatedNotes };
}

// src/chat-runner.ts
var CHAT_SYSTEM_PROMPT = `You are a helpful AI assistant embedded in Obsidian. The user's vault notes are provided below as context.

Help the user think through ideas, answer questions about their notes, and assist with writing and research. Be conversational, direct, and grounded in the notes when relevant.

{{VAULT_CONTEXT}}`;
async function runChatMessage(userText, history, app, settings, activeFile, onToken, onDone, onError) {
  try {
    let systemPrompt = CHAT_SYSTEM_PROMPT;
    if (activeFile) {
      const maxCtx = Math.min(settings.maxTokens, 4e3);
      const ctx = await buildVaultContext(app, activeFile, settings, 2, maxCtx);
      if (ctx) {
        let finalCtx = ctx;
        if (settings.scoutEnabled && ctx.candidates.length > 0) {
          const results = await scoutContext(ctx.candidates, ctx, app, settings);
          if (results && results.length > 0)
            finalCtx = applyScoutResults(ctx, results);
        }
        systemPrompt = systemPrompt.replace("{{VAULT_CONTEXT}}", formatVaultContext(finalCtx));
      } else {
        systemPrompt = systemPrompt.replace("{{VAULT_CONTEXT}}", "(No linked notes found.)");
      }
    } else {
      systemPrompt = systemPrompt.replace("{{VAULT_CONTEXT}}", "(No active note open.)");
    }
    const mentionedContent = await resolveMentions(userText, app);
    if (mentionedContent) {
      systemPrompt += `

${mentionedContent}`;
    }
    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userText }
    ];
    const provider = getProvider(settings);
    const stream = provider.stream({ systemPrompt, messages });
    for await (const token of stream) {
      onToken(token);
    }
    onDone();
  } catch (err) {
    const e = err;
    if (e.status === 401) {
      onError("Invalid API key \u2014 check Settings \u2192 ogstack");
    } else if (e.status === 0) {
      onError(`Cannot reach ${settings.provider}`);
    } else {
      onError("Something went wrong");
    }
  }
}
async function resolveMentions(text, app) {
  const linkRegex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
  const names = [...text.matchAll(linkRegex)].map((m) => m[1].trim());
  if (names.length === 0)
    return "";
  const snippets = [];
  for (const name of names) {
    const file = app.vault.getFiles().find(
      (f) => f.extension === "md" && f.basename.toLowerCase() === name.toLowerCase()
    );
    if (file) {
      try {
        const content = await app.vault.cachedRead(file);
        snippets.push(`<mentioned-note title="${file.basename}">
${content}
</mentioned-note>`);
      } catch (e) {
      }
    }
  }
  return snippets.join("\n\n");
}

// src/skill-runner.ts
var import_obsidian5 = require("obsidian");

// src/floating-input.ts
var FloatingInput = class {
  constructor(config) {
    this.inputWrap = null;
    this.inputEl = null;
    this.suggestEl = null;
    this.selectedIdx = -1;
    this.filteredSkills = [];
    this.hideTimer = null;
    this.onSkillRun = null;
    var _a;
    this.wrap = document.createElement("div");
    this.wrap.className = config.mode === "input" ? "gstack-fi-backdrop" : "gstack-fi-progress-wrap";
    if (config.mode === "input") {
      this.onSkillRun = config.onSkillRun;
      this.wrap.addEventListener("click", (e) => {
        if (e.target === this.wrap)
          config.onClose();
      });
    }
    this.panel = document.createElement("div");
    this.panel.className = "gstack-fi-panel";
    this.wrap.appendChild(this.panel);
    if (config.mode === "input") {
      this.buildInputUI(config);
    }
    this.statusEl = document.createElement("div");
    this.statusEl.className = "gstack-fi-status";
    this.statusEl.style.display = "none";
    this.panel.appendChild(this.statusEl);
    document.body.appendChild(this.wrap);
    if (config.mode === "input") {
      this.renderSuggestions([...config.skills.values()].slice(0, 6));
      (_a = this.inputEl) == null ? void 0 : _a.focus();
    }
  }
  buildInputUI(config) {
    this.inputWrap = document.createElement("div");
    this.inputWrap.className = "gstack-fi-input-wrap";
    const icon = document.createElement("span");
    icon.className = "gstack-fi-icon";
    icon.textContent = "\u2726";
    this.inputWrap.appendChild(icon);
    this.inputEl = document.createElement("input");
    this.inputEl.className = "gstack-fi-input";
    this.inputEl.type = "text";
    this.inputEl.placeholder = "Ask ogstack or type /command\u2026";
    this.inputEl.addEventListener("input", () => this.onInput(config));
    this.inputEl.addEventListener("keydown", (e) => this.onKeydown(e, config));
    this.inputWrap.appendChild(this.inputEl);
    const esc = document.createElement("kbd");
    esc.className = "gstack-fi-esc";
    esc.textContent = "esc";
    this.inputWrap.appendChild(esc);
    this.panel.appendChild(this.inputWrap);
    this.suggestEl = document.createElement("div");
    this.suggestEl.className = "gstack-fi-suggestions";
    this.panel.appendChild(this.suggestEl);
  }
  onInput(config) {
    var _a, _b;
    const val = (_b = (_a = this.inputEl) == null ? void 0 : _a.value) != null ? _b : "";
    if (val.startsWith("/")) {
      const q = val.slice(1).toLowerCase();
      const matched = [...config.skills.values()].filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      );
      this.renderSuggestions(matched);
    } else {
      this.renderSuggestions([]);
    }
    this.selectedIdx = -1;
  }
  onKeydown(e, config) {
    var _a, _b;
    if (e.key === "Escape") {
      e.preventDefault();
      config.onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.selectedIdx = Math.min(this.selectedIdx + 1, this.filteredSkills.length - 1);
      this.updateSelection();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      this.selectedIdx = Math.max(this.selectedIdx - 1, -1);
      this.updateSelection();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const val = (_b = (_a = this.inputEl) == null ? void 0 : _a.value.trim()) != null ? _b : "";
      if (this.selectedIdx >= 0 && this.filteredSkills[this.selectedIdx]) {
        config.onSkillRun(this.filteredSkills[this.selectedIdx]);
      } else if (val.startsWith("/")) {
        const skill = config.skills.get(val.slice(1));
        if (skill)
          config.onSkillRun(skill);
      } else if (val) {
        config.onFreeQuery(val);
      }
    }
  }
  renderSuggestions(skills) {
    if (!this.suggestEl)
      return;
    this.filteredSkills = skills;
    this.suggestEl.innerHTML = "";
    if (skills.length === 0) {
      this.suggestEl.classList.remove("visible");
      return;
    }
    this.suggestEl.classList.add("visible");
    skills.forEach((skill, i) => {
      const item = document.createElement("div");
      item.className = "gstack-fi-suggest-item" + (i === this.selectedIdx ? " selected" : "");
      const name = document.createElement("span");
      name.className = "gstack-fi-suggest-name";
      name.textContent = `/${skill.name}`;
      const desc = document.createElement("span");
      desc.className = "gstack-fi-suggest-desc";
      desc.textContent = skill.description;
      item.appendChild(name);
      item.appendChild(desc);
      item.addEventListener("mouseenter", () => {
        this.selectedIdx = i;
        this.updateSelection();
      });
      item.addEventListener("click", () => {
        var _a;
        return (_a = this.onSkillRun) == null ? void 0 : _a.call(this, skill);
      });
      this.suggestEl.appendChild(item);
    });
  }
  updateSelection() {
    var _a;
    (_a = this.suggestEl) == null ? void 0 : _a.querySelectorAll(".gstack-fi-suggest-item").forEach((el, i) => {
      el.classList.toggle("selected", i === this.selectedIdx);
    });
  }
  setRunning(message) {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.inputWrap)
      this.inputWrap.style.display = "none";
    if (this.suggestEl)
      this.suggestEl.classList.remove("visible");
    this.statusEl.style.display = "flex";
    this.statusEl.className = "gstack-fi-status loading";
    this.statusEl.innerHTML = `<div class="gstack-fi-spinner"></div><span>${message}</span>`;
  }
  setDone(message = "done \u2713") {
    this.statusEl.className = "gstack-fi-status done";
    this.statusEl.innerHTML = `<span class="gstack-fi-check">\u2713</span><span>${message}</span>`;
    this.hideTimer = setTimeout(() => this.destroy(), 2e3);
  }
  setError(message) {
    this.statusEl.className = "gstack-fi-status error";
    this.statusEl.innerHTML = `<span class="gstack-fi-x">\u2715</span><span>${message}</span>`;
    this.wrap.addEventListener("click", () => this.destroy(), { once: true });
    this.hideTimer = setTimeout(() => this.destroy(), 5e3);
  }
  destroy() {
    if (this.hideTimer)
      clearTimeout(this.hideTimer);
    this.wrap.remove();
  }
};

// src/output-router.ts
var import_obsidian4 = require("obsidian");
async function routeOutput(tokens, ctx, app, getEditor) {
  if (ctx.outputMode === "inline") {
    await routeInline(tokens, getEditor);
  } else {
    await routeNewNote(tokens, ctx, app);
  }
}
async function routeInline(tokens, getEditor) {
  const editor = getEditor();
  if (!editor) {
    new import_obsidian4.Notice("gstack: open a note first");
    return;
  }
  let cursor = editor.getCursor();
  try {
    for await (const token of tokens) {
      const currentEditor = getEditor();
      if (!currentEditor) {
        new import_obsidian4.Notice("gstack: output interrupted \u2014 note was closed");
        return;
      }
      currentEditor.replaceRange(token, cursor);
      const lines = token.split("\n");
      if (lines.length === 1) {
        cursor = { line: cursor.line, ch: cursor.ch + token.length };
      } else {
        cursor = {
          line: cursor.line + lines.length - 1,
          ch: lines[lines.length - 1].length
        };
      }
    }
  } catch (e) {
    new import_obsidian4.Notice("gstack: output interrupted \u2014 note was closed");
  }
}
async function routeNewNote(tokens, ctx, app) {
  var _a, _b, _c;
  const now = /* @__PURE__ */ new Date();
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const folderPath = ctx.activeNotePath.includes("/") ? ctx.activeNotePath.slice(0, ctx.activeNotePath.lastIndexOf("/")) : "";
  const baseName = `${ctx.activeNoteBasename} \u2014 ${capitalize(ctx.skill.name)}`;
  const primaryPath = folderPath ? `${folderPath}/${baseName}.md` : `${baseName}.md`;
  const finalPath = await app.vault.adapter.exists(primaryPath) ? folderPath ? `${folderPath}/${baseName} ${timestamp}.md` : `${baseName} ${timestamp}.md` : primaryPath;
  let file;
  try {
    file = await app.vault.create(finalPath, "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    new import_obsidian4.Notice(`gstack: could not create output note \u2014 ${msg}`);
    return;
  }
  const leaf = app.workspace.getLeaf("split");
  const typedLeaf = leaf;
  await typedLeaf.openFile(file);
  const editor = (_c = (_a = typedLeaf.view) == null ? void 0 : _a.editor) != null ? _c : (_b = app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView)) == null ? void 0 : _b.editor;
  if (!editor) {
    new import_obsidian4.Notice("gstack: could not open output note editor");
    return;
  }
  let cursor = editor.getCursor();
  try {
    for await (const token of tokens) {
      editor.replaceRange(token, cursor);
      const lines = token.split("\n");
      if (lines.length === 1) {
        cursor = { line: cursor.line, ch: cursor.ch + token.length };
      } else {
        cursor = {
          line: cursor.line + lines.length - 1,
          ch: lines[lines.length - 1].length
        };
      }
    }
  } catch (e) {
    new import_obsidian4.Notice("gstack: output interrupted \u2014 note was closed");
  }
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// src/skill-runner.ts
var inlineMutex = /* @__PURE__ */ new Map();
async function runSkill(skill, app, settings, reporter) {
  var _a, _b;
  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) {
    new import_obsidian5.Notice("ogstack: open a note first");
    return;
  }
  const outputMode = (_a = skill.output) != null ? _a : settings.outputMode;
  if (outputMode === "inline") {
    if (inlineMutex.get(activeFile.path)) {
      new import_obsidian5.Notice(`ogstack: ${skill.name} is already running on this note`);
      return;
    }
    inlineMutex.set(activeFile.path, true);
  }
  if (!settings.apiKey && settings.provider !== "ollama") {
    if (outputMode === "inline")
      inlineMutex.delete(activeFile.path);
    new import_obsidian5.Notice("ogstack: add your API key in Settings \u2192 ogstack");
    return;
  }
  const bar = reporter != null ? reporter : new FloatingInput({ mode: "progress" });
  try {
    let getEditor = function() {
      var _a2;
      const view = app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
      return (_a2 = view == null ? void 0 : view.editor) != null ? _a2 : null;
    };
    bar.setRunning("ogstack: building context\u2026");
    const ctx = await buildVaultContext(
      app,
      activeFile,
      settings,
      skill.maxDepth,
      (_b = skill.maxTokens) != null ? _b : settings.maxTokens
    );
    if (!ctx) {
      bar.destroy();
      return;
    }
    let finalCtx = ctx;
    if (settings.scoutEnabled && ctx.candidates.length > 0) {
      bar.setRunning("ogstack: scoring relevance\u2026");
      const scoutResults = await scoutContext(ctx.candidates, ctx, app, settings);
      if (scoutResults && scoutResults.length > 0) {
        finalCtx = applyScoutResults(ctx, scoutResults);
      }
    }
    bar.setRunning(`ogstack: running ${skill.name}\u2026`);
    const vaultContextStr = formatVaultContext(finalCtx);
    if (!skill.systemPrompt.includes("{{VAULT_CONTEXT}}")) {
      console.warn(`ogstack: SKILL.md for ${skill.name} has no {{VAULT_CONTEXT}} placeholder`);
    }
    const systemPrompt = skill.systemPrompt.replace("{{VAULT_CONTEXT}}", vaultContextStr);
    const provider = getProvider(settings);
    const tokenStream = provider.stream({
      systemPrompt,
      userMessage: "Execute this skill now."
    });
    const activeNotePath = activeFile.path;
    const activeNoteBasename = activeFile.basename;
    await routeOutput(
      tokenStream,
      { activeNotePath, activeNoteBasename, skill, outputMode },
      app,
      getEditor
    );
    bar.setDone("ogstack: done \u2713");
  } catch (err) {
    const e = err;
    let msg;
    if (e.name === "AbortError" || e.message === "timeout") {
      msg = "timed out after 120s \u2014 try a smaller token budget";
    } else if (e.status === 401) {
      msg = "invalid API key \u2014 check Settings \u2192 ogstack";
    } else if (e.status === 0) {
      msg = settings.provider === "ollama" ? `Ollama not reachable at ${settings.ollamaHost}` : `could not reach ${settings.provider}`;
    } else if (e.status && e.status >= 400) {
      msg = `provider error ${e.status}`;
    } else {
      msg = `could not reach ${settings.provider}`;
    }
    bar.setError(`ogstack: ${msg}`);
  } finally {
    if (outputMode === "inline") {
      inlineMutex.delete(activeFile.path);
    }
  }
}

// src/sidebar-view.ts
var SIDEBAR_VIEW_TYPE = "ogstack-sidebar";
var OgstackSidebarView = class extends import_obsidian6.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.screen = { name: "sessions" };
    this.streamingContent = "";
  }
  getViewType() {
    return SIDEBAR_VIEW_TYPE;
  }
  getDisplayText() {
    return "ogstack";
  }
  getIcon() {
    return "wand-2";
  }
  async onOpen() {
    await this.render();
  }
  async render() {
    const root = this.containerEl.children[1];
    root.empty();
    root.className = "gstack-chat";
    if (this.screen.name === "sessions") {
      this.renderSessionsScreen(root);
    } else {
      await this.renderChatScreen(root, this.screen.sessionId);
    }
  }
  // ── Sessions screen ──────────────────────────────────────────
  renderSessionsScreen(root) {
    const header = root.createDiv({ cls: "gstack-chat-header" });
    header.createEl("span", { text: "ogstack", cls: "gstack-chat-title" });
    const newBtn = header.createEl("button", { cls: "gstack-chat-icon-btn", text: "+" });
    newBtn.title = "New chat for active note";
    newBtn.addEventListener("click", () => this.startNewChat());
    const sessions = this.plugin.chatStore.getSessions();
    const body = root.createDiv({ cls: "gstack-chat-body" });
    if (sessions.length === 0) {
      this.renderSessionsEmpty(body);
      return;
    }
    const list = body.createDiv({ cls: "gstack-session-list" });
    for (const session of sessions) {
      this.renderSessionItem(list, session);
    }
  }
  renderSessionsEmpty(container) {
    const empty = container.createDiv({ cls: "gstack-chat-empty" });
    empty.createEl("div", { text: "\u2726", cls: "gstack-chat-empty-icon" });
    empty.createEl("p", { text: "No conversations yet.", cls: "gstack-chat-empty-title" });
    empty.createEl("p", { text: "Open a note with linked notes, then click + to start a chat about it.", cls: "gstack-chat-empty-sub" });
    const tips = empty.createDiv({ cls: "gstack-chat-empty-tips" });
    const rows = [
      ["/ commands", "Run built-in skills like /research or /plan"],
      ["@ mentions", "Tag any vault note to pull it into context"],
      ["Chat history", "Conversations are saved per note"]
    ];
    for (const [label, desc] of rows) {
      const row = tips.createDiv({ cls: "gstack-chat-tip-row" });
      row.createEl("span", { text: label, cls: "gstack-chat-tip-label" });
      row.createEl("span", { text: desc, cls: "gstack-chat-tip-desc" });
    }
  }
  renderSessionItem(container, session) {
    const item = container.createDiv({ cls: "gstack-session-item" });
    const info = item.createDiv({ cls: "gstack-session-info" });
    info.createEl("div", { text: session.noteTitle || "Untitled", cls: "gstack-session-title" });
    const last = session.messages[session.messages.length - 1];
    const preview = last ? last.content.slice(0, 72) + (last.content.length > 72 ? "\u2026" : "") : "No messages yet";
    info.createEl("div", { text: preview, cls: "gstack-session-preview" });
    const meta = item.createDiv({ cls: "gstack-session-meta" });
    meta.createEl("span", { text: relativeTime(session.updatedAt), cls: "gstack-session-time" });
    const del = meta.createEl("button", { cls: "gstack-session-del", text: "\xD7" });
    del.title = "Delete";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      await this.plugin.chatStore.deleteSession(session.id);
      this.render();
    });
    item.addEventListener("click", () => {
      this.screen = { name: "chat", sessionId: session.id };
      this.render();
    });
  }
  // ── Chat screen ──────────────────────────────────────────────
  async renderChatScreen(root, sessionId) {
    const session = this.plugin.chatStore.getSession(sessionId);
    if (!session) {
      this.screen = { name: "sessions" };
      this.renderSessionsScreen(root);
      return;
    }
    const header = root.createDiv({ cls: "gstack-chat-header" });
    const back = header.createEl("button", { cls: "gstack-chat-icon-btn", text: "\u2190" });
    back.addEventListener("click", () => {
      this.screen = { name: "sessions" };
      this.render();
    });
    header.createEl("span", { text: session.noteTitle || "Chat", cls: "gstack-chat-title" });
    const body = root.createDiv({ cls: "gstack-chat-body" });
    const msgs = body.createDiv({ cls: "gstack-chat-messages" });
    if (session.messages.length === 0) {
      this.renderChatEmpty(msgs);
    }
    for (const msg of session.messages) {
      await this.appendMessage(msgs, msg.role, msg.content, false);
    }
    setTimeout(() => {
      msgs.scrollTop = msgs.scrollHeight;
    }, 10);
    const inputArea = root.createDiv({ cls: "gstack-chat-input-area" });
    this.buildInputArea(inputArea, session, msgs);
  }
  renderChatEmpty(container) {
    const el = container.createDiv({ cls: "gstack-chat-intro" });
    el.createEl("div", { text: "\u2726 Chat with your vault", cls: "gstack-chat-intro-title" });
    const tips = [
      ["Ask", "anything about your linked notes"],
      ["/command", "run /research, /plan, /review, \u2026"],
      ["@[[Note]]", "pull a specific note into context"],
      ["Shift+Enter", "newline \xB7 Enter to send"]
    ];
    const grid = el.createDiv({ cls: "gstack-chat-intro-grid" });
    for (const [key, val] of tips) {
      const row = grid.createDiv({ cls: "gstack-chat-intro-row" });
      row.createEl("kbd", { text: key, cls: "gstack-chat-intro-key" });
      row.createEl("span", { text: val, cls: "gstack-chat-intro-val" });
    }
  }
  async appendMessage(container, role, content, streaming) {
    const el = container.createDiv({ cls: `gstack-msg gstack-msg-${role}` });
    if (streaming) {
      el.createEl("span", { cls: "gstack-msg-cursor", text: "\u25CF" });
    } else if (role === "assistant") {
      await import_obsidian6.MarkdownRenderer.render(this.plugin.app, content, el, "", this);
    } else {
      this.renderUserMessage(el, content);
    }
    return el;
  }
  renderUserMessage(el, content) {
    const parts = content.split(/(\[\[[^\]]+\]\])/g);
    for (const part of parts) {
      if (part.startsWith("[[") && part.endsWith("]]")) {
        el.createEl("span", { text: part, cls: "gstack-msg-mention" });
      } else if (part) {
        el.createEl("span", { text: part });
      }
    }
  }
  // ── Input area ───────────────────────────────────────────────
  buildInputArea(container, session, msgs) {
    const skills = this.plugin.getSkills();
    const suggestEl = container.createDiv({ cls: "gstack-chat-suggest" });
    let filteredEntries = [];
    let selectedIdx = -1;
    let currentTrigger = null;
    let triggerPos = -1;
    const textarea = container.createEl("textarea", {
      cls: "gstack-chat-textarea",
      placeholder: "Message ogstack\u2026  /skill  @[[note]]  Shift+Enter = newline"
    });
    textarea.rows = 2;
    const footer = container.createDiv({ cls: "gstack-chat-footer" });
    const hint = footer.createEl("span", { text: "Enter to send \xB7 Shift+Enter for newline", cls: "gstack-chat-hint-text" });
    hint.style.display = "none";
    textarea.addEventListener("focus", () => {
      hint.style.display = "";
    });
    textarea.addEventListener("blur", () => {
      hint.style.display = "none";
    });
    const sendBtn = footer.createEl("button", { cls: "gstack-chat-send-btn", text: "Send" });
    const setDisabled = (v) => {
      textarea.disabled = v;
      sendBtn.disabled = v;
    };
    const clearSuggest = () => {
      suggestEl.empty();
      suggestEl.classList.remove("visible");
      filteredEntries = [];
      selectedIdx = -1;
      currentTrigger = null;
      triggerPos = -1;
    };
    const updateSelection = () => {
      suggestEl.querySelectorAll(".gstack-chat-suggest-item").forEach((el, i) => {
        el.classList.toggle("selected", i === selectedIdx);
      });
    };
    const applyEntry = (entry) => {
      var _a;
      const tv = textarea;
      const before = tv.value.slice(0, triggerPos);
      const after = tv.value.slice((_a = tv.selectionStart) != null ? _a : tv.value.length);
      if (entry.type === "skill") {
        tv.value = before + `/${entry.skill.name} ` + after;
      } else {
        tv.value = before + `[[${entry.file.basename}]]` + after;
      }
      clearSuggest();
      textarea.focus();
    };
    const renderSuggest = (entries) => {
      filteredEntries = entries;
      suggestEl.empty();
      if (entries.length === 0) {
        clearSuggest();
        return;
      }
      suggestEl.classList.add("visible");
      entries.forEach((entry, i) => {
        const item = suggestEl.createDiv({ cls: "gstack-chat-suggest-item" + (i === selectedIdx ? " selected" : "") });
        if (entry.type === "skill") {
          item.createEl("span", { text: `/${entry.skill.name}`, cls: "gstack-chat-suggest-name" });
          item.createEl("span", { text: entry.skill.description, cls: "gstack-chat-suggest-desc" });
        } else {
          item.createEl("span", { text: `@${entry.file.basename}`, cls: "gstack-chat-suggest-name gstack-chat-suggest-note" });
          item.createEl("span", { text: entry.file.path, cls: "gstack-chat-suggest-desc" });
        }
        item.addEventListener("click", () => applyEntry(entry));
      });
    };
    textarea.addEventListener("input", () => {
      var _a;
      const tv = textarea;
      const cursor = (_a = tv.selectionStart) != null ? _a : 0;
      const text = tv.value.slice(0, cursor);
      const slashMatch = text.match(/(?:^|[\s\n])(\/)([^\s]*)$/);
      if (slashMatch) {
        triggerPos = cursor - slashMatch[1].length - slashMatch[2].length;
        currentTrigger = "/";
        const q = slashMatch[2].toLowerCase();
        const matched = [...skills.values()].filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)).slice(0, 6).map((s) => ({ type: "skill", skill: s }));
        renderSuggest(matched);
        return;
      }
      const atMatch = text.match(/(?:^|[\s\n])@([^\s\n@]*)$/);
      if (atMatch) {
        triggerPos = cursor - 1 - atMatch[1].length;
        currentTrigger = "@";
        const q = atMatch[1].toLowerCase();
        const files = this.plugin.app.vault.getFiles().filter((f) => f.extension === "md" && f.basename.toLowerCase().includes(q)).slice(0, 6).map((f) => ({ type: "note", file: f }));
        renderSuggest(files);
        return;
      }
      clearSuggest();
    });
    const send = async () => {
      const tv = textarea;
      const text = tv.value.trim();
      if (!text)
        return;
      tv.value = "";
      clearSuggest();
      setDisabled(true);
      if (text.startsWith("/")) {
        const skillName = text.slice(1).split(/\s/)[0].trim();
        const skill = skills.get(skillName);
        if (skill) {
          await this.plugin.chatStore.addMessage(session.id, "user", text);
          await this.appendMessage(msgs, "user", text, false);
          const runningEl = await this.appendMessage(msgs, "assistant", "", true);
          runningEl.querySelector(".gstack-msg-cursor").textContent = `Running /${skillName}\u2026`;
          msgs.scrollTop = msgs.scrollHeight;
          await runSkill(skill, this.plugin.app, this.plugin.settings);
          runningEl.remove();
          const done = `Ran /${skillName} \u2014 output written to your note.`;
          await this.appendMessage(msgs, "assistant", done, false);
          await this.plugin.chatStore.addMessage(session.id, "assistant", done);
          msgs.scrollTop = msgs.scrollHeight;
          setDisabled(false);
          textarea.focus();
          return;
        }
      }
      await this.plugin.chatStore.addMessage(session.id, "user", text);
      await this.appendMessage(msgs, "user", text, false);
      const assistantEl = msgs.createDiv({ cls: "gstack-msg gstack-msg-assistant" });
      assistantEl.createEl("span", { cls: "gstack-msg-cursor", text: "\u25CF" });
      msgs.scrollTop = msgs.scrollHeight;
      this.streamingContent = "";
      const activeFile = this.plugin.app.workspace.getActiveFile();
      const historySnapshot = session.messages.slice(0, -1);
      await runChatMessage(
        text,
        historySnapshot,
        this.plugin.app,
        this.plugin.settings,
        activeFile,
        (token) => {
          this.streamingContent += token;
          assistantEl.textContent = this.streamingContent;
          msgs.scrollTop = msgs.scrollHeight;
        },
        async () => {
          assistantEl.empty();
          await import_obsidian6.MarkdownRenderer.render(this.plugin.app, this.streamingContent, assistantEl, "", this);
          await this.plugin.chatStore.addMessage(session.id, "assistant", this.streamingContent);
          this.streamingContent = "";
          msgs.scrollTop = msgs.scrollHeight;
          setDisabled(false);
          textarea.focus();
        },
        (errMsg) => {
          assistantEl.empty();
          assistantEl.createEl("span", { text: `Error: ${errMsg}`, cls: "gstack-msg-error" });
          setDisabled(false);
        }
      );
    };
    textarea.addEventListener("keydown", (e) => {
      const ke = e;
      if (ke.key === "Escape" && filteredEntries.length > 0) {
        ke.preventDefault();
        clearSuggest();
        return;
      }
      if (ke.key === "ArrowUp" && filteredEntries.length > 0) {
        ke.preventDefault();
        selectedIdx = Math.max(selectedIdx - 1, 0);
        updateSelection();
        return;
      }
      if (ke.key === "ArrowDown" && filteredEntries.length > 0) {
        ke.preventDefault();
        selectedIdx = Math.min(selectedIdx + 1, filteredEntries.length - 1);
        updateSelection();
        return;
      }
      if (ke.key === "Enter" && !ke.shiftKey) {
        ke.preventDefault();
        if (selectedIdx >= 0 && filteredEntries[selectedIdx]) {
          applyEntry(filteredEntries[selectedIdx]);
          return;
        }
        send();
        return;
      }
    });
    sendBtn.addEventListener("click", send);
    setTimeout(() => textarea.focus(), 50);
  }
  // ── Public API ───────────────────────────────────────────────
  async startNewChat() {
    var _a, _b;
    const active = this.plugin.app.workspace.getActiveFile();
    const session = await this.plugin.chatStore.createSession(
      (_a = active == null ? void 0 : active.path) != null ? _a : "",
      (_b = active == null ? void 0 : active.basename) != null ? _b : "New Chat"
    );
    this.screen = { name: "chat", sessionId: session.id };
    await this.render();
  }
  async openForNote(notePath, noteTitle) {
    let session = this.plugin.chatStore.getSessionsForNote(notePath)[0];
    if (!session) {
      session = await this.plugin.chatStore.createSession(notePath, noteTitle);
    }
    this.screen = { name: "chat", sessionId: session.id };
    await this.render();
  }
  async onClose() {
  }
};
function relativeTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 6e4);
  const h = Math.floor(diff / 36e5);
  const d = Math.floor(diff / 864e5);
  if (m < 1)
    return "just now";
  if (m < 60)
    return `${m}m ago`;
  if (h < 24)
    return `${h}h ago`;
  if (d < 7)
    return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// src/skill-loader.ts
var import_obsidian7 = require("obsidian");

// src/builtin-skills.ts
var BUILTIN_SKILL_FILES = [
  {
    name: "research",
    content: `---
name: research
description: Synthesize your linked notes into a structured research brief
output: inline
max_depth: 3
max_tokens: 6000
---

You are a senior research analyst. The user's vault notes on this topic are provided below.

Your task: synthesize a comprehensive research brief from these notes. Structure your output as:

**Overview**
A 2-3 sentence summary of the topic and what the notes cover.

**Key Findings**
Bullet points of the most important facts, insights, and data points found across the notes.

**Themes & Patterns**
Recurring themes, contradictions, or patterns you notice across the linked notes.

**Gaps & Open Questions**
What is missing, unclear, or would require further research.

**Sources**
A brief list of which notes contributed which key points.

Rules:
- Only use facts and claims present in the notes. Do not invent or assume.
- If notes contradict each other, surface the contradiction explicitly.
- Prioritize recency \u2014 more recently modified notes should carry more weight.
- Be concise. This is a brief, not an essay.

{{VAULT_CONTEXT}}`
  },
  {
    name: "campaign",
    content: `---
name: campaign
description: Turn your product and audience notes into a full campaign plan
output: inline
max_depth: 3
max_tokens: 6000
---

You are a senior marketing strategist. The user has provided their product notes and research below.

Generate a complete campaign plan including:

**Target Audience Summary**
Drawn directly from the notes \u2014 ICP, pain points, motivations. No invented personas.

**Core Message & Positioning**
The single most important thing to communicate and why it matters to this audience.

**Channel Strategy**
Which channels to prioritize and why, based on what the notes reveal about the audience.

**3 Campaign Concepts**
For each concept provide:
- A working title and one-sentence description
- Core message / angle
- Sample headline and body copy direction
- Primary channel and format

**Success Metrics**
What to measure, based on the goals implied in the notes.

Rules:
- Use the specific details from the notes. Do not invent facts not present in the context.
- If the notes lack enough product or audience information, say so explicitly and note what's missing.
- Keep copy direction concrete \u2014 avoid generic marketing language.

{{VAULT_CONTEXT}}`
  },
  {
    name: "plan",
    content: `---
name: plan
description: Draft a project or sprint plan from your goals and context notes
output: inline
max_depth: 3
max_tokens: 6000
---

You are a senior project manager and product strategist. The user's planning notes are provided below.

Generate a structured project plan including:

**Goal & Success Criteria**
What does done look like? Drawn from the notes, made concrete and measurable.

**Scope**
What is in scope. What is explicitly out of scope (if notes suggest it).

**Milestones**
3-7 key milestones with a logical sequence. Each milestone should have a clear deliverable.

**Task Breakdown**
For each milestone, list the key tasks. Keep tasks atomic \u2014 one person, one output.

**Dependencies & Risks**
What must happen before what. Known risks from the notes, with a mitigation suggestion each.

**Open Questions**
Decisions or unknowns from the notes that must be resolved before work can begin.

Rules:
- Ground every milestone and task in the actual goals and context from the notes.
- Do not pad the plan with generic project management boilerplate.
- If the notes are too vague to plan from, say so and list the missing information needed.
- Estimates are optional \u2014 only include them if the notes contain timeline information.

{{VAULT_CONTEXT}}`
  },
  {
    name: "outline",
    content: `---
name: outline
description: Build a document outline from your linked research
output: inline
max_depth: 3
max_tokens: 6000
---

You are a senior editor and content strategist. The user's research notes are provided below.

Generate a complete document outline that:

**Title**
A working title for the document, derived from the notes' main theme.

**Audience & Purpose**
Who this document is for and what it should accomplish \u2014 drawn from the notes.

**Outline**
A hierarchical outline with:
- H1: major sections (4-8)
- H2: subsections within each major section
- For each section: a one-sentence note on what content goes there and which source notes it draws from

**Key Arguments / Claims**
The 3-5 most important points this document must make, drawn from the research.

**Evidence Inventory**
For each key argument: which linked notes provide supporting evidence or data.

**Suggested Format & Length**
Based on the content scope: estimated word count, recommended format (article, report, essay, guide), and any structural recommendations.

Rules:
- The outline must be grounded in what the notes actually contain.
- Do not invent sections for topics not covered in the notes.
- If the research has obvious gaps for the implied document, flag them.
- Write section descriptions in imperative voice: "Explain X" not "This section discusses X."

{{VAULT_CONTEXT}}`
  },
  {
    name: "review",
    content: `---
name: review
description: Get an editorial critique and improvement suggestions for this note
output: inline
max_depth: 2
max_tokens: 4000
---

You are a senior editor. Review the active note and provide a direct, useful critique.

Structure your review as:

**Summary of the Note**
1-2 sentences on what this note is and what it's trying to accomplish.

**Strengths**
What's working well \u2014 specific, not generic praise.

**Issues**
Problems with clarity, logic, structure, completeness, or accuracy. Be direct. For each issue:
- What the problem is
- Why it matters
- A specific suggestion to fix it

**Missing Content**
What should be in this note that isn't \u2014 based on the implied purpose and the linked notes' context.

**Contradictions**
Any claims in the active note that conflict with linked notes.

**Top 3 Priority Edits**
If the user does nothing else: the three changes with the highest impact.

Rules:
- Be honest and direct. Vague positive feedback is not useful.
- Ground all critique in the actual content of the note.
- Use the linked notes as context \u2014 flag when the active note ignores or contradicts them.
- Do not rewrite the note. Critique and guide only.

{{VAULT_CONTEXT}}`
  }
];

// src/skill-loader.ts
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match)
    return null;
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0)
      continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    fm[key] = value;
  }
  return { fm, body: match[2].trim() };
}
function parseSKILL(content, sourcePath) {
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    console.warn(`gstack: malformed SKILL.md frontmatter at ${sourcePath}`);
    return null;
  }
  const { fm, body } = parsed;
  if (!fm.name || !fm.description) {
    console.warn(`gstack: SKILL.md at ${sourcePath} missing required fields (name, description)`);
    return null;
  }
  const output = fm.output === "new-note" ? "new-note" : fm.output === "inline" ? "inline" : void 0;
  const maxDepth = fm.max_depth ? parseInt(fm.max_depth, 10) : 3;
  const maxTokens = fm.max_tokens ? parseInt(fm.max_tokens, 10) : null;
  return {
    name: fm.name,
    description: fm.description,
    output,
    maxDepth: isNaN(maxDepth) ? 3 : maxDepth,
    maxTokens: maxTokens !== null && !isNaN(maxTokens) ? maxTokens : null,
    systemPrompt: body
  };
}
var CUSTOM_SKILLS_FOLDER = "_agent";
var DEBOUNCE_MS = 300;
function createSkillLoader(app, pluginDir, registrar) {
  const registeredSkills = /* @__PURE__ */ new Map();
  const unregisterFns = /* @__PURE__ */ new Map();
  const builtinNames = /* @__PURE__ */ new Set();
  let debounceTimer = null;
  function debounce(fn) {
    if (debounceTimer)
      clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fn, DEBOUNCE_MS);
  }
  function registerSkill(skill, isBuiltin) {
    if (!isBuiltin && builtinNames.has(skill.name)) {
      new import_obsidian7.Notice(`gstack: custom skill "${skill.name}" conflicts with a built-in skill \u2014 rename it`);
      return;
    }
    const unregister = registrar(skill);
    registeredSkills.set(skill.name, skill);
    unregisterFns.set(skill.name, unregister);
    if (isBuiltin)
      builtinNames.add(skill.name);
  }
  function unregisterSkill(name) {
    const fn = unregisterFns.get(name);
    if (fn)
      fn();
    registeredSkills.delete(name);
    unregisterFns.delete(name);
  }
  function loadBuiltinSkills() {
    for (const { name, content } of BUILTIN_SKILL_FILES) {
      const skill = parseSKILL(content, name);
      if (skill)
        registerSkill(skill, true);
    }
  }
  async function loadCustomSkills() {
    const folderExists = await app.vault.adapter.exists(CUSTOM_SKILLS_FOLDER);
    if (!folderExists) {
      try {
        await app.vault.adapter.mkdir(CUSTOM_SKILLS_FOLDER);
      } catch (e) {
      }
      return;
    }
    const { files, folders } = await app.vault.adapter.list(CUSTOM_SKILLS_FOLDER);
    for (const filePath of files.filter((f) => f.endsWith(".md"))) {
      try {
        const content = await app.vault.adapter.read(filePath);
        const skill = parseSKILL(content, filePath);
        if (skill)
          registerSkill(skill, false);
      } catch (e) {
        console.warn(`ogstack: could not read skill at ${filePath}`);
      }
    }
    for (const folderPath of folders) {
      const skillFilePath = `${folderPath}/SKILL.md`;
      try {
        if (!await app.vault.adapter.exists(skillFilePath))
          continue;
        const content = await app.vault.adapter.read(skillFilePath);
        const skill = parseSKILL(content, skillFilePath);
        if (skill)
          registerSkill(skill, false);
      } catch (e) {
        console.warn(`ogstack: could not read skill at ${skillFilePath}`);
      }
    }
  }
  async function reloadCustomSkills() {
    for (const [name] of registeredSkills) {
      if (!builtinNames.has(name))
        unregisterSkill(name);
    }
    await loadCustomSkills();
  }
  const watcherRef = app.vault.on("create", (file) => {
    if (isCustomSkillFile(file.path)) {
      debounce(() => reloadCustomSkills());
    }
  });
  const modifyRef = app.vault.on("modify", (file) => {
    if (isCustomSkillFile(file.path)) {
      debounce(() => reloadCustomSkills());
    }
  });
  const deleteRef = app.vault.on("delete", (file) => {
    if (isCustomSkillFile(file.path)) {
      debounce(() => reloadCustomSkills());
    }
  });
  const renameRef = app.vault.on("rename", (_file, _oldPath) => {
    debounce(() => reloadCustomSkills());
  });
  return {
    async loadAll() {
      loadBuiltinSkills();
      await loadCustomSkills();
    },
    getRegisteredSkills() {
      return registeredSkills;
    },
    destroy() {
      if (debounceTimer)
        clearTimeout(debounceTimer);
      app.vault.offref(watcherRef);
      app.vault.offref(modifyRef);
      app.vault.offref(deleteRef);
      app.vault.offref(renameRef);
    }
  };
}
function isCustomSkillFile(path) {
  if (!path.startsWith(CUSTOM_SKILLS_FOLDER + "/"))
    return false;
  const rel = path.slice(CUSTOM_SKILLS_FOLDER.length + 1);
  if (!rel.includes("/") && rel.endsWith(".md"))
    return true;
  if (rel.endsWith("/SKILL.md"))
    return true;
  return false;
}

// src/persistent-bar.ts
var PersistentBar = class {
  constructor(config) {
    this.state = "idle";
    this.filteredSkills = [];
    this.selectedIdx = -1;
    this.resetTimer = null;
    this.config = config;
    this.container = document.createElement("div");
    this.container.className = "gstack-bar-container";
    this.popup = document.createElement("div");
    this.popup.className = "gstack-bar-popup";
    this.popup.style.display = "none";
    this.container.appendChild(this.popup);
    this.pill = document.createElement("div");
    this.pill.className = "gstack-bar-pill";
    this.shimmer = document.createElement("div");
    this.shimmer.className = "gstack-bar-shimmer";
    this.pill.appendChild(this.shimmer);
    const icon = document.createElement("span");
    icon.className = "gstack-bar-icon";
    icon.textContent = "\u2726";
    this.pill.appendChild(icon);
    this.inputWrap = document.createElement("div");
    this.inputWrap.className = "gstack-bar-input-wrap";
    this.inputEl = document.createElement("input");
    this.inputEl.className = "gstack-bar-input";
    this.inputEl.type = "text";
    this.inputEl.placeholder = "Ask ogstack or /command\u2026";
    this.inputEl.addEventListener("input", () => this.handleInput());
    this.inputEl.addEventListener("keydown", (e) => this.handleKeydown(e));
    this.inputEl.addEventListener("focus", () => this.onFocus());
    this.inputEl.addEventListener("blur", () => setTimeout(() => this.onBlur(), 150));
    this.hintEl = document.createElement("span");
    this.hintEl.className = "gstack-bar-hint";
    this.hintEl.textContent = "/ commands";
    this.inputWrap.appendChild(this.inputEl);
    this.inputWrap.appendChild(this.hintEl);
    this.pill.appendChild(this.inputWrap);
    this.statusWrap = document.createElement("div");
    this.statusWrap.className = "gstack-bar-status-wrap";
    this.statusSpinner = document.createElement("div");
    this.statusSpinner.className = "gstack-bar-spinner";
    this.statusText = document.createElement("span");
    this.statusText.className = "gstack-bar-status-text";
    this.statusWrap.appendChild(this.statusSpinner);
    this.statusWrap.appendChild(this.statusText);
    this.pill.appendChild(this.statusWrap);
    this.container.appendChild(this.pill);
    document.body.appendChild(this.container);
    this.setState("idle");
  }
  show() {
    this.container.classList.add("visible");
  }
  hide() {
    this.container.classList.remove("visible");
    setTimeout(() => this.reset(), 250);
  }
  focusInput() {
    this.show();
    this.inputEl.focus();
  }
  // ── Input handling ──────────────────────────────────────────
  onFocus() {
    this.pill.classList.add("focused");
    this.hintEl.style.display = "none";
    if (!this.inputEl.value) {
      this.showAllSkills();
    }
  }
  onBlur() {
    this.pill.classList.remove("focused");
    this.hintEl.style.display = "";
    this.hidePopup();
  }
  handleInput() {
    const val = this.inputEl.value;
    if (val.startsWith("/")) {
      const q = val.slice(1).toLowerCase();
      const matched = [...this.config.skills.values()].filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      );
      this.renderPopup(matched);
    } else if (val === "") {
      this.showAllSkills();
    } else {
      this.hidePopup();
    }
    this.selectedIdx = -1;
  }
  handleKeydown(e) {
    if (e.key === "Escape") {
      this.inputEl.blur();
      this.hidePopup();
      if (this.state === "idle")
        this.hide();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.selectedIdx = Math.min(this.selectedIdx + 1, this.filteredSkills.length - 1);
      this.updateSelection();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      this.selectedIdx = Math.max(this.selectedIdx - 1, -1);
      this.updateSelection();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const val = this.inputEl.value.trim();
      if (this.selectedIdx >= 0 && this.filteredSkills[this.selectedIdx]) {
        this.runSkill(this.filteredSkills[this.selectedIdx]);
      } else if (val.startsWith("/")) {
        const skill = this.config.skills.get(val.slice(1));
        if (skill)
          this.runSkill(skill);
      } else if (val) {
        this.hidePopup();
        this.inputEl.value = "";
        this.config.onFreeQuery(val);
      }
    }
  }
  runSkill(skill) {
    this.hidePopup();
    this.inputEl.value = "";
    this.config.onSkillRun(skill);
  }
  showAllSkills() {
    this.renderPopup([...this.config.skills.values()]);
  }
  renderPopup(skills) {
    this.filteredSkills = skills;
    this.popup.innerHTML = "";
    if (skills.length === 0) {
      this.hidePopup();
      return;
    }
    this.popup.style.display = "block";
    skills.forEach((skill, i) => {
      const item = document.createElement("div");
      item.className = "gstack-bar-popup-item" + (i === this.selectedIdx ? " selected" : "");
      const name = document.createElement("span");
      name.className = "gstack-bar-popup-name";
      name.textContent = `/${skill.name}`;
      const desc = document.createElement("span");
      desc.className = "gstack-bar-popup-desc";
      desc.textContent = skill.description;
      item.appendChild(name);
      item.appendChild(desc);
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.runSkill(skill);
      });
      item.addEventListener("mouseenter", () => {
        this.selectedIdx = i;
        this.updateSelection();
      });
      this.popup.appendChild(item);
    });
  }
  updateSelection() {
    this.popup.querySelectorAll(".gstack-bar-popup-item").forEach((el, i) => {
      el.classList.toggle("selected", i === this.selectedIdx);
    });
  }
  hidePopup() {
    this.popup.style.display = "none";
    this.filteredSkills = [];
    this.selectedIdx = -1;
  }
  // ── State transitions ───────────────────────────────────────
  setState(state) {
    this.state = state;
    this.pill.className = `gstack-bar-pill ${state}`;
    const isRunning = state === "running";
    this.inputWrap.style.opacity = isRunning ? "0" : "1";
    this.inputWrap.style.pointerEvents = isRunning ? "none" : "";
    this.statusWrap.style.opacity = state === "idle" ? "0" : "1";
    this.statusWrap.style.pointerEvents = state === "idle" ? "none" : "";
    this.statusSpinner.style.display = isRunning ? "" : "none";
  }
  setRunning(message) {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    this.hidePopup();
    this.statusText.textContent = message;
    this.show();
    this.setState("running");
  }
  setDone(message = "done \u2713") {
    this.statusText.textContent = message;
    this.setState("done");
    this.resetTimer = setTimeout(() => this.hide(), 2200);
  }
  setError(message) {
    this.statusText.textContent = message;
    this.setState("error");
    this.resetTimer = setTimeout(() => this.hide(), 5e3);
  }
  reset() {
    this.resetTimer = null;
    this.inputEl.value = "";
    this.setState("idle");
  }
  updateSkills(skills) {
    this.config = { ...this.config, skills };
  }
  destroy() {
    if (this.resetTimer)
      clearTimeout(this.resetTimer);
    this.container.remove();
  }
};

// src/welcome-modal.ts
var import_obsidian8 = require("obsidian");
var WelcomeModal = class extends import_obsidian8.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("gstack-welcome");
    contentEl.createEl("div", { text: "\u2726", cls: "gstack-welcome-icon" });
    contentEl.createEl("h2", { text: "Welcome to ogstack" });
    contentEl.createEl("p", {
      text: "Vault-aware AI skills for Obsidian. Your linked notes become the context automatically.",
      cls: "gstack-welcome-sub"
    });
    const sections = [
      {
        heading: "Getting started",
        items: [
          "Go to Settings \u2192 ogstack and add your API key (Claude, OpenAI, or Gemini).",
          "Open any note with linked notes and press the \u2726 bar at the bottom.",
          "Type / to pick a skill, or ask anything in free text."
        ]
      },
      {
        heading: "Built-in skills",
        items: [
          "/research \u2014 synthesises linked notes into a structured brief",
          "/plan \u2014 drafts a project or sprint plan from your goals",
          "/campaign \u2014 turns product and audience notes into a campaign",
          "/outline \u2014 builds a document outline from linked research",
          "/review \u2014 editorial critique of the active note"
        ]
      },
      {
        heading: "Chat sidebar",
        items: [
          "Click the \u2726 wand icon in the left ribbon to open the chat panel.",
          "Type @ to reference a specific note and pull its content into context.",
          "Chat history is saved per note \u2014 come back anytime."
        ]
      },
      {
        heading: "Custom skills",
        items: [
          "Drop a SKILL.md file into .gstack/skills/your-skill/ inside your vault.",
          "It registers as a live /command within 2 seconds \u2014 no restart needed."
        ]
      }
    ];
    for (const { heading, items } of sections) {
      contentEl.createEl("h4", { text: heading, cls: "gstack-welcome-heading" });
      const ul = contentEl.createEl("ul", { cls: "gstack-welcome-list" });
      for (const item of items) {
        ul.createEl("li", { text: item });
      }
    }
    const footer = contentEl.createDiv({ cls: "gstack-welcome-footer" });
    const btn = footer.createEl("button", { text: "Get started", cls: "gstack-welcome-btn" });
    btn.addEventListener("click", async () => {
      var _a;
      const data = (_a = await this.plugin.loadData()) != null ? _a : {};
      data.hasSeenWelcome = true;
      await this.plugin.saveData(data);
      this.close();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/import-skill-modal.ts
var import_obsidian9 = require("obsidian");
var AGENT_FOLDER = "_agent";
function githubUrlToRaw(url) {
  const blobMatch = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/);
  if (blobMatch)
    return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}`;
  if (url.startsWith("https://raw.githubusercontent.com/"))
    return url;
  return null;
}
function repoOwnerFromUrl(url) {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!m)
    return null;
  return m[1].replace(/\.git$/, "");
}
var ImportSkillModal = class extends import_obsidian9.Modal {
  constructor(app, onImported) {
    super(app);
    this.onImported = onImported;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("gstack-import-modal");
    contentEl.createEl("h2", { text: "Import skills from GitHub" });
    contentEl.createEl("p", {
      text: "Paste a GitHub file URL to import one skill, or a repo URL to import all skills from that repo.",
      cls: "gstack-import-desc"
    });
    const urlInput = contentEl.createEl("input", {
      cls: "gstack-import-url",
      attr: { type: "text", placeholder: "https://github.com/user/repo  or  \u2026/blob/main/skill.md" }
    });
    const status = contentEl.createEl("p", { cls: "gstack-import-status" });
    const btnRow = contentEl.createEl("div", { cls: "gstack-import-btn-row" });
    const btnFile = btnRow.createEl("button", { text: "Import this file", cls: "gstack-import-btn" });
    const btnRepo = btnRow.createEl("button", { text: "Import all from repo", cls: "gstack-import-btn mod-cta" });
    const setStatus = (msg) => {
      status.textContent = msg;
    };
    btnFile.addEventListener("click", async () => {
      const url = urlInput.value.trim();
      if (!url) {
        setStatus("Paste a URL first.");
        return;
      }
      btnFile.disabled = true;
      setStatus("Fetching\u2026");
      try {
        const name = await this.importFile(url);
        setStatus(`\u2713 Imported "${name}" \u2192 ${AGENT_FOLDER}/${name}.md`);
        this.onImported();
        setTimeout(() => this.close(), 1800);
      } catch (e) {
        setStatus(`Error: ${e.message}`);
        btnFile.disabled = false;
      }
    });
    btnRepo.addEventListener("click", async () => {
      const url = urlInput.value.trim();
      if (!url) {
        setStatus("Paste a repo URL first.");
        return;
      }
      btnRepo.disabled = true;
      btnFile.disabled = true;
      setStatus("Fetching repo tree\u2026");
      try {
        const count = await this.importRepo(url, setStatus);
        setStatus(`\u2713 Imported ${count} skill(s) into ${AGENT_FOLDER}/`);
        this.onImported();
        setTimeout(() => this.close(), 2e3);
      } catch (e) {
        setStatus(`Error: ${e.message}`);
        btnRepo.disabled = false;
        btnFile.disabled = false;
      }
    });
  }
  async ensureAgentFolder() {
    if (!await this.app.vault.adapter.exists(AGENT_FOLDER)) {
      await this.app.vault.adapter.mkdir(AGENT_FOLDER);
    }
  }
  async importFile(url) {
    const rawUrl = githubUrlToRaw(url);
    if (!rawUrl)
      throw new Error("Not a recognized GitHub URL");
    const res = await (0, import_obsidian9.requestUrl)({ url: rawUrl });
    if (res.status !== 200)
      throw new Error(`HTTP ${res.status}`);
    const content = res.text;
    const skill = parseSKILL(content, rawUrl);
    if (!skill)
      throw new Error("File has no valid skill frontmatter (name + description required)");
    await this.ensureAgentFolder();
    await this.app.vault.adapter.write(`${AGENT_FOLDER}/${skill.name}.md`, content);
    return skill.name;
  }
  async importRepo(repoUrl, setStatus) {
    var _a, _b;
    const ownerRepo = repoOwnerFromUrl(repoUrl);
    if (!ownerRepo)
      throw new Error("Not a GitHub repo URL");
    const repoRes = await (0, import_obsidian9.requestUrl)({ url: `https://api.github.com/repos/${ownerRepo}` });
    if (repoRes.status === 404)
      throw new Error(`Repo "${ownerRepo}" not found or is private`);
    if (repoRes.status !== 200)
      throw new Error(`GitHub API error ${repoRes.status}`);
    const defaultBranch = (_a = repoRes.json.default_branch) != null ? _a : "main";
    const treeRes = await (0, import_obsidian9.requestUrl)({
      url: `https://api.github.com/repos/${ownerRepo}/git/trees/${defaultBranch}?recursive=1`
    });
    if (treeRes.status !== 200)
      throw new Error(`Could not list repo files (${treeRes.status})`);
    const entries = (_b = treeRes.json.tree) != null ? _b : [];
    const mdPaths = entries.filter((e) => e.type === "blob" && e.path.endsWith(".md")).map((e) => e.path);
    await this.ensureAgentFolder();
    let count = 0;
    for (const filePath of mdPaths) {
      setStatus(`Importing ${count}/${mdPaths.length}: ${filePath}`);
      try {
        const rawUrl = `https://raw.githubusercontent.com/${ownerRepo}/${defaultBranch}/${filePath}`;
        const res = await (0, import_obsidian9.requestUrl)({ url: rawUrl });
        if (res.status !== 200)
          continue;
        const skill = parseSKILL(res.text, filePath);
        if (!skill)
          continue;
        await this.app.vault.adapter.write(`${AGENT_FOLDER}/${skill.name}.md`, res.text);
        count++;
      } catch (e) {
      }
    }
    return count;
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/main.ts
var GStackPlugin = class extends import_obsidian10.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.chatStore = new ChatStore(this);
    this.skillLoader = null;
    this.bar = null;
  }
  async onload() {
    var _a;
    await this.loadSettings();
    await this.chatStore.load();
    this.addSettingTab(new GStackSettingTab(this.app, this));
    this.registerView(SIDEBAR_VIEW_TYPE, (leaf) => new OgstackSidebarView(leaf, this));
    this.addRibbonIcon("wand-2", "ogstack", () => this.toggleSidebar());
    const pluginDir = (_a = this.manifest.dir) != null ? _a : `.obsidian/plugins/${this.manifest.id}`;
    this.skillLoader = createSkillLoader(
      this.app,
      pluginDir,
      (skill) => {
        const commandId = skill.name;
        this.addCommand({
          id: commandId,
          name: `gs: ${titleCase(skill.name)}`,
          callback: () => {
            var _a2;
            runSkill(skill, this.app, this.settings, (_a2 = this.bar) != null ? _a2 : void 0);
          }
        });
        return () => {
          this.app.commands.removeCommand(`${this.manifest.id}:${commandId}`);
        };
      }
    );
    await this.skillLoader.loadAll();
    this.bar = new PersistentBar({
      skills: this.getSkills(),
      onSkillRun: (skill) => {
        var _a2;
        return runSkill(skill, this.app, this.settings, (_a2 = this.bar) != null ? _a2 : void 0);
      },
      onFreeQuery: (text) => this.openChatWithMessage(text)
    });
    this.addCommand({
      id: "show-ai-bar",
      name: "Show AI bar",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "Space" }],
      callback: () => {
        var _a2;
        return (_a2 = this.bar) == null ? void 0 : _a2.focusInput();
      }
    });
    this.addCommand({
      id: "import-skill",
      name: "Import skill from GitHub",
      callback: () => {
        new ImportSkillModal(this.app, () => {
          var _a2;
          (_a2 = this.skillLoader) == null ? void 0 : _a2.loadAll();
          if (this.bar)
            this.bar.updateSkills(this.getSkills());
        }).open();
      }
    });
    const data = await this.loadData();
    if (!(data == null ? void 0 : data.hasSeenWelcome)) {
      new WelcomeModal(this.app, this).open();
    }
  }
  onunload() {
    var _a, _b;
    (_a = this.skillLoader) == null ? void 0 : _a.destroy();
    (_b = this.bar) == null ? void 0 : _b.destroy();
  }
  getSkills() {
    var _a, _b;
    return (_b = (_a = this.skillLoader) == null ? void 0 : _a.getRegisteredSkills()) != null ? _b : /* @__PURE__ */ new Map();
  }
  async toggleSidebar() {
    const existing = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
    if (existing.length > 0) {
      existing[0].detach();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }
  async openChatWithMessage(message) {
    var _a, _b, _c;
    const activeFile = this.app.workspace.getActiveFile();
    const notePath = (_a = activeFile == null ? void 0 : activeFile.path) != null ? _a : "";
    const noteTitle = (_b = activeFile == null ? void 0 : activeFile.basename) != null ? _b : "Chat";
    let leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
    if (leaves.length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
        leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
      }
    }
    const view = (_c = leaves[0]) == null ? void 0 : _c.view;
    if (view) {
      await view.openForNote(notePath, noteTitle);
    }
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
function titleCase(s) {
  return s.split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
