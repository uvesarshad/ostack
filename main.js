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
var import_obsidian7 = require("obsidian");

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

// src/skill-loader.ts
var import_obsidian2 = require("obsidian");
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
var CUSTOM_SKILLS_FOLDER = ".gstack/skills";
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
      new import_obsidian2.Notice(`gstack: custom skill "${skill.name}" conflicts with a built-in skill \u2014 rename it`);
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
  async function loadBuiltinSkills() {
    const skillNames = ["research", "campaign", "plan", "outline", "review"];
    for (const name of skillNames) {
      const path = `${pluginDir}/skills/${name}/SKILL.md`;
      try {
        const content = await app.vault.adapter.read(path);
        const skill = parseSKILL(content, path);
        if (skill)
          registerSkill(skill, true);
      } catch (e) {
        console.warn(`gstack: could not load built-in skill "${name}" from ${path}`);
      }
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
    const { files } = await app.vault.adapter.list(CUSTOM_SKILLS_FOLDER);
    const skillFiles = files.filter((f) => f.endsWith("/SKILL.md"));
    for (const filePath of skillFiles) {
      try {
        const content = await app.vault.adapter.read(filePath);
        const skill = parseSKILL(content, filePath);
        if (skill)
          registerSkill(skill, false);
      } catch (e) {
        console.warn(`gstack: could not read custom skill at ${filePath}`);
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
      await loadBuiltinSkills();
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
  return path.startsWith(CUSTOM_SKILLS_FOLDER) && path.endsWith("SKILL.md");
}

// src/skill-runner.ts
var import_obsidian6 = require("obsidian");

// src/context-builder.ts
var import_obsidian3 = require("obsidian");
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
    new import_obsidian3.Notice("gstack: open a note first");
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
      if (!file || !(file instanceof import_obsidian3.TFile))
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
    new import_obsidian3.Notice("gstack: large vault \u2014 context capped at 200 notes");
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
    var _a, _b;
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
          messages: [{ role: "user", content: request.userMessage }],
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
    const reader = (_a = response.body) == null ? void 0 : _a.getReader();
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
        buffer = (_b = lines.pop()) != null ? _b : "";
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
    var _a, _b, _c, _d;
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
          contents: [
            { role: "user", parts: [{ text: request.userMessage }] }
          ]
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
    const reader = (_a = response.body) == null ? void 0 : _a.getReader();
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
        buffer = (_b = lines.pop()) != null ? _b : "";
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
          const content = (_c = candidates == null ? void 0 : candidates[0]) == null ? void 0 : _c.content;
          const parts = content == null ? void 0 : content.parts;
          const text = (_d = parts == null ? void 0 : parts[0]) == null ? void 0 : _d.text;
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
var import_obsidian4 = require("obsidian");
var OllamaProvider = class {
  constructor(host, model) {
    this.host = host;
    this.model = model;
  }
  async *stream(request) {
    const url = `${this.host.replace(/\/$/, "")}/api/generate`;
    let result;
    try {
      result = await (0, import_obsidian4.requestUrl)({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt: `${request.systemPrompt}

${request.userMessage}`,
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
    if (typeof p.response === "string") {
      yield p.response;
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
    var _a, _b, _c;
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
            { role: "user", content: request.userMessage }
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
    const reader = (_a = response.body) == null ? void 0 : _a.getReader();
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
        buffer = (_b = lines.pop()) != null ? _b : "";
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
          const delta = (_c = choices == null ? void 0 : choices[0]) == null ? void 0 : _c.delta;
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

// src/output-router.ts
var import_obsidian5 = require("obsidian");
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
    new import_obsidian5.Notice("gstack: open a note first");
    return;
  }
  let cursor = editor.getCursor();
  try {
    for await (const token of tokens) {
      const currentEditor = getEditor();
      if (!currentEditor) {
        new import_obsidian5.Notice("gstack: output interrupted \u2014 note was closed");
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
    new import_obsidian5.Notice("gstack: output interrupted \u2014 note was closed");
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
    new import_obsidian5.Notice(`gstack: could not create output note \u2014 ${msg}`);
    return;
  }
  const leaf = app.workspace.getLeaf("split");
  const typedLeaf = leaf;
  await typedLeaf.openFile(file);
  const editor = (_c = (_a = typedLeaf.view) == null ? void 0 : _a.editor) != null ? _c : (_b = app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView)) == null ? void 0 : _b.editor;
  if (!editor) {
    new import_obsidian5.Notice("gstack: could not open output note editor");
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
    new import_obsidian5.Notice("gstack: output interrupted \u2014 note was closed");
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
function replaceNotice(prev, msg, duration) {
  prev == null ? void 0 : prev.hide();
  return new import_obsidian6.Notice(msg, duration);
}
async function runSkill(skill, app, settings) {
  var _a, _b, _c;
  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) {
    new import_obsidian6.Notice("gstack: open a note first");
    return;
  }
  const outputMode = (_a = skill.output) != null ? _a : settings.outputMode;
  if (outputMode === "inline") {
    if (inlineMutex.get(activeFile.path)) {
      new import_obsidian6.Notice(`gstack: ${skill.name} is already running on this note`);
      return;
    }
    inlineMutex.set(activeFile.path, true);
  }
  if (!settings.apiKey && settings.provider !== "ollama") {
    if (outputMode === "inline")
      inlineMutex.delete(activeFile.path);
    new import_obsidian6.Notice("gstack: add your API key in Settings \u2192 gstack");
    return;
  }
  let notice = null;
  try {
    let getEditor = function() {
      var _a2;
      const view = app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
      return (_a2 = view == null ? void 0 : view.editor) != null ? _a2 : null;
    };
    notice = replaceNotice(notice, "gstack: building context\u2026");
    const ctx = await buildVaultContext(
      app,
      activeFile,
      settings,
      skill.maxDepth,
      (_b = skill.maxTokens) != null ? _b : settings.maxTokens
    );
    if (!ctx) {
      notice.hide();
      return;
    }
    let finalCtx = ctx;
    if (settings.scoutEnabled && ctx.candidates.length > 0) {
      notice = replaceNotice(notice, "gstack: scoring relevance\u2026");
      const scoutResults = await scoutContext(ctx.candidates, ctx, app, settings);
      if (scoutResults && scoutResults.length > 0) {
        finalCtx = applyScoutResults(ctx, scoutResults);
      }
    }
    notice = replaceNotice(notice, `gstack: running ${skill.name}\u2026`);
    const vaultContextStr = formatVaultContext(finalCtx);
    if (!skill.systemPrompt.includes("{{VAULT_CONTEXT}}")) {
      console.warn(`gstack: SKILL.md for ${skill.name} has no {{VAULT_CONTEXT}} \u2014 context will not be injected`);
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
    notice = replaceNotice(notice, "gstack: done", 2e3);
  } catch (err) {
    notice == null ? void 0 : notice.hide();
    const e = err;
    if (e.name === "AbortError" || e.message === "timeout") {
      new import_obsidian6.Notice("gstack: response timed out after 120s \u2014 try a smaller token budget", 6e3);
    } else if (e.status === 401) {
      new import_obsidian6.Notice("gstack: invalid API key \u2014 check Settings \u2192 gstack", 5e3);
    } else if (e.status === 0) {
      if (settings.provider === "ollama") {
        new import_obsidian6.Notice(`gstack: Ollama not reachable at ${settings.ollamaHost} \u2014 is it running?`, 5e3);
      } else {
        new import_obsidian6.Notice(`gstack: could not reach ${settings.provider} \u2014 check your connection`, 5e3);
      }
    } else if (e.status && e.status >= 400) {
      new import_obsidian6.Notice(`gstack: provider error ${e.status} \u2014 ${(_c = e.body) != null ? _c : "unknown error"}`, 5e3);
    } else {
      new import_obsidian6.Notice(`gstack: could not reach ${settings.provider} \u2014 check your connection`, 5e3);
    }
  } finally {
    if (outputMode === "inline") {
      inlineMutex.delete(activeFile.path);
    }
  }
}

// src/main.ts
var GStackPlugin = class extends import_obsidian7.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.skillLoader = null;
  }
  async onload() {
    var _a;
    await this.loadSettings();
    this.addSettingTab(new GStackSettingTab(this.app, this));
    const pluginDir = (_a = this.manifest.dir) != null ? _a : `.obsidian/plugins/${this.manifest.id}`;
    this.skillLoader = createSkillLoader(
      this.app,
      pluginDir,
      (skill) => {
        const commandId = skill.name;
        const displayName = `gs: ${titleCase(skill.name)}`;
        this.addCommand({
          id: commandId,
          name: displayName,
          editorCallback: (_editor, _view) => {
            runSkill(skill, this.app, this.settings);
          }
        });
        return () => {
          this.app.commands.removeCommand(
            `${this.manifest.id}:${commandId}`
          );
        };
      }
    );
    await this.skillLoader.loadAll();
  }
  onunload() {
    var _a;
    (_a = this.skillLoader) == null ? void 0 : _a.destroy();
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
