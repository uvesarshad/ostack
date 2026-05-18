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
var import_obsidian12 = require("obsidian");

// src/bar-chat.ts
var import_obsidian3 = require("obsidian");

// src/providers/retry.ts
var RETRYABLE_STATUSES = /* @__PURE__ */ new Set([429, 503]);
var DEFAULT_BACKOFF_MS = 1e3;
var MAX_BACKOFF_MS = 1e4;
async function fetchWithRetry(url, init, options = {}) {
  var _a, _b;
  const maxRetries = (_a = options.maxRetries) != null ? _a : 1;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init);
    if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries) {
      return response;
    }
    const wait = (_b = parseRetryAfter(response.headers.get("retry-after"))) != null ? _b : DEFAULT_BACKOFF_MS;
    try {
      await response.text();
    } catch (e) {
    }
    await sleep(Math.min(wait, MAX_BACKOFF_MS), options.signal);
  }
  throw new Error("retry loop exhausted");
}
function parseRetryAfter(header) {
  if (!header)
    return null;
  const secs = parseInt(header, 10);
  if (!isNaN(secs) && secs >= 0)
    return secs * 1e3;
  return null;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal == null ? void 0 : signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal == null ? void 0 : signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal == null ? void 0 : signal.addEventListener("abort", onAbort, { once: true });
  });
}

// src/providers/claude.ts
var ClaudeProvider = class {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model;
  }
  // Streaming completion with optional tools. Yields structured events so the
  // agent loop can render text deltas live AND collect full tool_use blocks
  // (which arrive as input_json_delta chunks that we re-assemble).
  async *streamWithTools(systemPrompt, messages, tools, signal) {
    var _a, _b;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 12e4);
    const onCallerAbort = () => timeoutController.abort();
    if (signal) {
      if (signal.aborted)
        timeoutController.abort();
      else
        signal.addEventListener("abort", onCallerAbort, { once: true });
    }
    let response;
    try {
      response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          system: systemPrompt,
          messages,
          tools,
          stream: true
        }),
        signal: timeoutController.signal
      }, { signal: timeoutController.signal });
    } catch (err) {
      clearTimeout(timeoutId);
      signal == null ? void 0 : signal.removeEventListener("abort", onCallerAbort);
      if (err.name === "AbortError") {
        if (signal == null ? void 0 : signal.aborted)
          throw err;
        throw new Error("timeout");
      }
      throw err;
    }
    if (!response.ok) {
      clearTimeout(timeoutId);
      signal == null ? void 0 : signal.removeEventListener("abort", onCallerAbort);
      const body = await response.text();
      throw { status: response.status, body };
    }
    const reader = (_a = response.body) == null ? void 0 : _a.getReader();
    if (!reader) {
      clearTimeout(timeoutId);
      signal == null ? void 0 : signal.removeEventListener("abort", onCallerAbort);
      return;
    }
    const decoder = new TextDecoder();
    const blocks = {};
    let stopReason = "end_turn";
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
          if (!data || data === "[DONE]")
            continue;
          let evt;
          try {
            evt = JSON.parse(data);
          } catch (e) {
            continue;
          }
          const type = evt.type;
          if (type === "content_block_start") {
            const idx = evt.index;
            const cb = evt.content_block;
            if (cb.type === "text") {
              blocks[idx] = { type: "text", partialJson: "" };
            } else if (cb.type === "tool_use") {
              blocks[idx] = { type: "tool_use", id: cb.id, name: cb.name, partialJson: "" };
            }
          } else if (type === "content_block_delta") {
            const idx = evt.index;
            const delta = evt.delta;
            const block = blocks[idx];
            if (!block)
              continue;
            if (delta.type === "text_delta" && typeof delta.text === "string") {
              yield { type: "text", text: delta.text };
            } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
              block.partialJson += delta.partial_json;
            }
          } else if (type === "content_block_stop") {
            const idx = evt.index;
            const block = blocks[idx];
            if ((block == null ? void 0 : block.type) === "tool_use" && block.id && block.name) {
              let input = {};
              try {
                input = block.partialJson ? JSON.parse(block.partialJson) : {};
              } catch (e) {
              }
              yield { type: "tool_use", id: block.id, name: block.name, input };
            }
            delete blocks[idx];
          } else if (type === "message_delta") {
            const delta = evt.delta;
            if (delta == null ? void 0 : delta.stop_reason)
              stopReason = delta.stop_reason;
          } else if (type === "message_stop") {
            yield { type: "stop", stopReason };
            return;
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
      signal == null ? void 0 : signal.removeEventListener("abort", onCallerAbort);
      reader.releaseLock();
    }
  }
  // Non-streaming completion with optional tools. Kept for unit tests and as a
  // fallback path; the agent loop uses streamWithTools.
  async complete(systemPrompt, messages, tools, signal) {
    const body = {
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages
    };
    if (tools && tools.length > 0)
      body.tools = tools;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) {
      const errBody = await response.text();
      throw { status: response.status, body: errBody };
    }
    const json = await response.json();
    return { stopReason: json.stop_reason, content: json.content };
  }
  async *stream(request) {
    var _a, _b, _c;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12e4);
    let response;
    try {
      response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
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
      }, { signal: controller.signal });
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

// src/providers/cli.ts
var BINARY_NAMES = {
  "claude-cli": "claude",
  "codex-cli": "codex",
  "gemini-cli": "gemini"
};
var SHELL_METACHAR_RX = /[\s&|;<>$`"'(){}[\]\\]/;
var MODEL_NAME_RX = /^[a-zA-Z0-9._:\-/]{1,80}$/;
function isSafeCliPath(path) {
  if (typeof path !== "string")
    return false;
  if (path.length === 0)
    return true;
  if (path.length > 260)
    return false;
  return !SHELL_METACHAR_RX.test(path);
}
function isSafeModelName(model) {
  if (typeof model !== "string")
    return false;
  if (model.length === 0)
    return true;
  return MODEL_NAME_RX.test(model);
}
function getChildProcess() {
  const req = typeof require !== "undefined" ? require : window.require;
  if (!req)
    throw new Error("Node.js child_process is not available in this Obsidian build");
  return req("child_process");
}
function nodeRequire() {
  var _a;
  if (typeof require !== "undefined")
    return require;
  const w = window;
  return (_a = w.require) != null ? _a : null;
}
function binaryExistsOnPath(name) {
  const req = nodeRequire();
  if (!req)
    return true;
  let fs;
  try {
    fs = req("fs");
  } catch (e) {
    return true;
  }
  const resolved = resolveBinary(name);
  if (resolved === name && !name.includes("/") && !name.includes("\\"))
    return false;
  try {
    return fs.existsSync(resolved);
  } catch (e) {
    return false;
  }
}
function resolveBinary(binary) {
  var _a, _b, _c;
  const req = nodeRequire();
  if (!req)
    return binary;
  let fs;
  let path;
  try {
    fs = req("fs");
    path = req("path");
  } catch (e) {
    return binary;
  }
  if (path.isAbsolute(binary) || binary.includes("/") || binary.includes("\\")) {
    if (fs.existsSync(binary))
      return binary;
    if (typeof process !== "undefined" && process.platform === "win32") {
      const exts2 = ((_a = process.env.PATHEXT) != null ? _a : ".COM;.EXE;.BAT;.CMD").split(";");
      for (const ext of exts2) {
        const candidate = binary + ext;
        if (fs.existsSync(candidate))
          return candidate;
      }
    }
    return binary;
  }
  if (typeof process === "undefined")
    return binary;
  const pathSep = process.platform === "win32" ? ";" : ":";
  const dirs = ((_b = process.env.PATH) != null ? _b : "").split(pathSep).filter(Boolean);
  const exts = process.platform === "win32" ? ((_c = process.env.PATHEXT) != null ? _c : ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, binary + ext);
      try {
        if (fs.existsSync(candidate))
          return candidate;
      } catch (e) {
      }
    }
  }
  return binary;
}
function buildPrompt(req) {
  const lines = [];
  if (req.systemPrompt) {
    lines.push(`<system>
${req.systemPrompt}
</system>`);
  }
  if (req.messages && req.messages.length > 0) {
    for (const m of req.messages) {
      const tag = m.role === "user" ? "Human" : "Assistant";
      lines.push(`
${tag}: ${m.content}`);
    }
  } else if (req.userMessage) {
    lines.push(`
Human: ${req.userMessage}`);
  }
  return lines.join("");
}
function buildArgs(kind, model) {
  switch (kind) {
    case "claude-cli":
      return ["-p", ...model ? ["--model", model] : [], "--output-format", "text"];
    case "codex-cli":
      return [
        "exec",
        "--skip-git-repo-check",
        "--json",
        "--sandbox",
        "read-only",
        ...model ? ["--model", model] : []
      ];
    case "gemini-cli":
      return ["-p", ...model ? ["--model", model] : []];
  }
}
var CliProvider = class {
  constructor(kind, model, cliPath, cwd) {
    this.kind = kind;
    this.model = model;
    this.cliPath = cliPath;
    this.cwd = cwd;
  }
  async *stream(request) {
    let cp;
    try {
      cp = getChildProcess();
    } catch (err) {
      throw { status: 0, body: err.message };
    }
    if (!isSafeCliPath(this.cliPath)) {
      throw {
        status: 0,
        body: `Unsafe CLI path "${this.cliPath}" \u2014 must not contain spaces or shell metacharacters. Configure in Settings \u2192 ogstack.`
      };
    }
    if (!isSafeModelName(this.model)) {
      throw {
        status: 0,
        body: `Unsafe model name "${this.model}" \u2014 allowed: letters, digits, ._:-/`
      };
    }
    const requestedName = this.cliPath || BINARY_NAMES[this.kind];
    const binary = resolveBinary(requestedName);
    const isBareName = !requestedName.includes("/") && !requestedName.includes("\\");
    const looksUnresolved = isBareName && binary === requestedName;
    if (looksUnresolved && !binaryExistsOnPath(requestedName)) {
      throw {
        status: 0,
        body: `Could not find "${requestedName}" on PATH. 

\u2022 Install: run \`npm install -g @openai/codex\` (or the CLI's installer) in your terminal.
\u2022 Verify: \`${requestedName} --version\` should work in a fresh terminal.
\u2022 Already installed? Quit and reopen Obsidian \u2014 GUI apps cache PATH at launch on Windows/macOS, so a newly-installed CLI isn't visible until you restart.
\u2022 Custom location: set the absolute path in Settings \u2192 ogstack \u2192 CLI binary path.`
      };
    }
    const args = buildArgs(this.kind, this.model);
    const prompt = buildPrompt(request);
    let proc;
    try {
      const spawnOpts = {};
      if (this.cwd)
        spawnOpts.cwd = this.cwd;
      proc = cp.spawn(binary, args, spawnOpts);
    } catch (err) {
      throw { status: 0, body: `Failed to spawn ${binary}: ${err.message}. Run \`${binary} --version\` in your terminal to verify the CLI is installed.` };
    }
    try {
      proc.stdin.write(prompt);
      proc.stdin.end();
    } catch (err) {
      throw { status: 0, body: `Failed to send prompt to ${binary}: ${err.message}` };
    }
    const queue = [];
    let finished = false;
    let errorMsg = "";
    let resolver = null;
    const wake = () => {
      resolver == null ? void 0 : resolver();
      resolver = null;
    };
    const useJsonl = this.kind === "codex-cli";
    let jsonlBuffer = "";
    let emittedFromDeltas = false;
    let lastFullAgentMessage = "";
    const handleJsonlLine = (line) => {
      var _a, _b, _c;
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("{"))
        return;
      let evt;
      try {
        evt = JSON.parse(trimmed);
      } catch (e) {
        return;
      }
      if (evt.type === "item.delta" && ((_a = evt.item) == null ? void 0 : _a.type) === "agent_message" && typeof evt.item.delta === "string") {
        emittedFromDeltas = true;
        queue.push(evt.item.delta);
        wake();
      } else if (evt.type === "item.completed" && ((_b = evt.item) == null ? void 0 : _b.type) === "agent_message" && typeof evt.item.text === "string") {
        lastFullAgentMessage = evt.item.text;
      } else if (evt.type === "error" && ((_c = evt.msg) == null ? void 0 : _c.message)) {
        errorMsg += evt.msg.message + "\n";
      }
    };
    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (!useJsonl) {
        queue.push(text);
        wake();
        return;
      }
      jsonlBuffer += text;
      let nl;
      while ((nl = jsonlBuffer.indexOf("\n")) !== -1) {
        const line = jsonlBuffer.slice(0, nl);
        jsonlBuffer = jsonlBuffer.slice(nl + 1);
        handleJsonlLine(line);
      }
    });
    proc.stdout.on("end", () => {
      if (useJsonl) {
        if (jsonlBuffer.trim().length > 0) {
          handleJsonlLine(jsonlBuffer);
          jsonlBuffer = "";
        }
        if (!emittedFromDeltas && lastFullAgentMessage) {
          queue.push(lastFullAgentMessage);
        }
      }
      finished = true;
      wake();
    });
    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      const cleaned = text.split("\n").filter((l) => !l.includes("Reading prompt from stdin")).join("\n");
      errorMsg += cleaned;
    });
    proc.on("exit", (code) => {
      finished = true;
      if (typeof code === "number" && code !== 0 && !errorMsg) {
        errorMsg = `${binary} exited with code ${code}`;
      }
      wake();
    });
    proc.on("error", (err) => {
      errorMsg = err.message;
      finished = true;
      wake();
    });
    let yieldedAnything = false;
    try {
      while (true) {
        if (queue.length > 0) {
          yieldedAnything = true;
          yield queue.shift();
          continue;
        }
        if (finished) {
          if (!yieldedAnything && errorMsg.trim().length > 0) {
            throw { status: 0, body: errorMsg.trim() };
          }
          return;
        }
        await new Promise((resolve) => {
          resolver = resolve;
        });
      }
    } finally {
      try {
        proc.kill();
      } catch (e) {
      }
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
      response = await fetchWithRetry(url, {
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
      }, { signal: controller.signal });
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

// src/providers/grok.ts
var GrokProvider = class {
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
      response = await fetchWithRetry("https://api.x.ai/v1/chat/completions", {
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
      }, { signal: controller.signal });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === "AbortError")
        throw new Error("timeout");
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

// src/providers/ollama.ts
var OllamaProvider = class {
  constructor(host, model) {
    this.host = host;
    this.model = model;
  }
  async *stream(request) {
    var _a, _b, _c;
    const url = `${this.host.replace(/\/$/, "")}/api/chat`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12e4);
    let response;
    try {
      response = await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: request.systemPrompt },
            ...request.messages ? request.messages.map((m) => ({ role: m.role, content: m.content })) : [{ role: "user", content: (_a = request.userMessage) != null ? _a : "" }]
          ],
          stream: true
        }),
        signal: controller.signal
      }, { signal: controller.signal });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === "AbortError")
        throw new Error("timeout");
      throw { status: 0, body: String(err) };
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
          const trimmed = line.trim();
          if (!trimmed)
            continue;
          let parsed;
          try {
            parsed = JSON.parse(trimmed);
          } catch (e) {
            continue;
          }
          const p = parsed;
          const message = p.message;
          if (typeof (message == null ? void 0 : message.content) === "string" && message.content) {
            yield message.content;
          }
          if (p.done === true)
            return;
        }
      }
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
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
      response = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
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
      }, { signal: controller.signal });
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
function getProvider(settings, cwd) {
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
      return new CliProvider(settings.provider, model, settings.cliPath, cwd);
  }
}
function getScoutProvider(settings, cwd) {
  const scoutModel = settings.scoutModel || "gemini-2.0-flash-lite";
  const useInherit = settings.scoutProvider === "inherit" || !settings.scoutProvider;
  const scoutProviderId = useInherit ? settings.provider : settings.scoutProvider;
  const scoutApiKey = useInherit ? settings.apiKey : settings.scoutApiKey;
  const scoutCliPath = useInherit ? settings.cliPath : settings.scoutCliPath;
  const scoutOllamaHost = useInherit ? settings.ollamaHost : settings.scoutOllamaHost || settings.ollamaHost;
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
      return new CliProvider(scoutProviderId, scoutModel, scoutCliPath, cwd);
  }
}

// src/context-builder.ts
var import_obsidian = require("obsidian");
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
    new import_obsidian.Notice("gstack: open a note first");
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
      if (!file || !(file instanceof import_obsidian.TFile))
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
    new import_obsidian.Notice("gstack: large vault \u2014 context capped at 200 notes");
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
${escapeForFraming(ctx.activeNote.content)}
</active-note>`
  ];
  for (const note of ctx.linkedNotes) {
    const title = (_d = (_c = note.path.split("/").pop()) == null ? void 0 : _c.replace(/\.md$/, "")) != null ? _d : note.path;
    const score = note.score.toFixed(2);
    const annotation = (_e = note.annotation) != null ? _e : "";
    if (note.summaryOnly && annotation) {
      parts.push(
        `<context title="${escapeAttr(title)}" score="${score}" depth="${note.depth}" annotation="${escapeAttr(annotation)}" summary-only="true">${escapeForFraming(annotation)}</context>`
      );
    } else {
      const annotationAttr = annotation ? ` annotation="${escapeAttr(annotation)}"` : "";
      parts.push(
        `<context title="${escapeAttr(title)}" score="${score}" depth="${note.depth}"${annotationAttr}>
${escapeForFraming(note.content)}
</context>`
      );
    }
  }
  return parts.join("\n\n");
}
function escapeAttr(s) {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
var FRAMING_RX = /<\/?(?:context|active-note|mentioned-note)\b/gi;
function escapeForFraming(content) {
  return content.replace(FRAMING_RX, (m) => m.replace("<", "&lt;"));
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
  const adapter = app.vault.adapter;
  const cwd = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : adapter.basePath;
  const provider = getScoutProvider(settings, cwd);
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

// src/tools/vault-tools.ts
var import_obsidian2 = require("obsidian");
var VAULT_TOOLS = {
  read_note: {
    name: "read_note",
    description: "Read the full contents of a note from the vault. Returns the markdown text.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the note relative to vault root, including .md extension." }
      },
      required: ["path"]
    }
  },
  write_note: {
    name: "write_note",
    description: "Create a new note or overwrite an existing one with the given content. Use carefully \u2014 overwrites without warning.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the note relative to vault root, including .md extension." },
        content: { type: "string", description: "The full markdown content of the note." }
      },
      required: ["path", "content"]
    }
  },
  append_note: {
    name: "append_note",
    description: "Append content to the end of an existing note. Creates the note if it doesn't exist.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the note relative to vault root, including .md extension." },
        content: { type: "string", description: "Markdown content to append." }
      },
      required: ["path", "content"]
    }
  },
  list_notes: {
    name: "list_notes",
    description: "List markdown notes in a folder (or vault root). Returns relative paths, one per line.",
    input_schema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Folder path relative to vault root. Omit or pass empty string for the entire vault." }
      },
      required: []
    }
  },
  search_vault: {
    name: "search_vault",
    description: "Search note contents for a case-insensitive substring. Returns up to 20 matches as 'path: snippet' lines.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring to search for." }
      },
      required: ["query"]
    }
  },
  get_active_note: {
    name: "get_active_note",
    description: "Return the path and contents of the note the user currently has open. Empty if no note is active.",
    input_schema: {
      type: "object",
      properties: {},
      required: []
    }
  }
};
var ALL_TOOL_NAMES = Object.keys(VAULT_TOOLS);
var READ_NOTE_CHAR_CAP = 12e3;
var SEARCH_VAULT_CHAR_CAP = 4e3;
var GET_ACTIVE_NOTE_CHAR_CAP = 12e3;
var SEARCH_VAULT_FILE_CAP = 2e3;
function truncateWithMarker(content, cap, label = "note") {
  if (content.length <= cap)
    return content;
  return `${content.slice(0, cap)}

[truncated: ${label} continues \u2014 ${content.length - cap} more chars]`;
}
function resolveTools(allowed) {
  const names = !allowed || allowed.length === 0 ? ALL_TOOL_NAMES : allowed;
  return names.map((n) => VAULT_TOOLS[n]).filter((t) => !!t);
}
var WRITE_DISABLED_MSG = 'ERROR: agent file writes are disabled. Enable Settings \u2192 ogstack \u2192 Agent safety \u2192 "Allow agent file writes" to grant write access.';
async function executeVaultTool(app, name, input, options = {}) {
  var _a, _b, _c, _d, _e, _f, _g, _h;
  const allowWrites = (_a = options.allowWrites) != null ? _a : false;
  switch (name) {
    case "read_note":
      return await readNote(app, String((_b = input.path) != null ? _b : ""));
    case "write_note":
      if (!allowWrites)
        return WRITE_DISABLED_MSG;
      return await writeNote(app, String((_c = input.path) != null ? _c : ""), String((_d = input.content) != null ? _d : ""));
    case "append_note":
      if (!allowWrites)
        return WRITE_DISABLED_MSG;
      return await appendNote(app, String((_e = input.path) != null ? _e : ""), String((_f = input.content) != null ? _f : ""));
    case "list_notes":
      return await listNotes(app, String((_g = input.folder) != null ? _g : ""));
    case "search_vault":
      return await searchVault(app, String((_h = input.query) != null ? _h : ""));
    case "get_active_note":
      return await getActiveNote(app);
    default:
      return `ERROR: unknown tool "${name}"`;
  }
}
async function readNote(app, path) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof import_obsidian2.TFile))
    return `ERROR: note not found: ${path}`;
  const content = await app.vault.read(file);
  return truncateWithMarker(content, READ_NOTE_CHAR_CAP, path);
}
async function writeNote(app, path, content) {
  if (!path)
    return "ERROR: path is required";
  await ensureParentFolder(app, path);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof import_obsidian2.TFile) {
    await app.vault.modify(existing, content);
    return `wrote ${path} (${content.length} chars, overwritten)`;
  }
  await app.vault.create(path, content);
  return `created ${path} (${content.length} chars)`;
}
async function appendNote(app, path, content) {
  if (!path)
    return "ERROR: path is required";
  await ensureParentFolder(app, path);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof import_obsidian2.TFile) {
    const current = await app.vault.read(existing);
    const sep = current.endsWith("\n") ? "" : "\n";
    await app.vault.modify(existing, current + sep + content);
    return `appended to ${path} (+${content.length} chars)`;
  }
  await app.vault.create(path, content);
  return `created ${path} (${content.length} chars)`;
}
async function listNotes(app, folder) {
  const files = app.vault.getMarkdownFiles();
  const filtered = folder ? files.filter((f) => f.path.startsWith(folder.endsWith("/") ? folder : folder + "/") || f.path === folder) : files;
  if (filtered.length === 0)
    return folder ? `no notes in ${folder}` : "no notes in vault";
  const capped = filtered.slice(0, 200);
  const lines = capped.map((f) => f.path).join("\n");
  return capped.length < filtered.length ? `${lines}
(... ${filtered.length - capped.length} more truncated)` : lines;
}
async function searchVault(app, query) {
  if (!query)
    return "ERROR: query is required";
  const needle = query.toLowerCase();
  const allFiles = app.vault.getMarkdownFiles();
  const filesToScan = allFiles.slice(0, SEARCH_VAULT_FILE_CAP);
  const fileScanTruncated = allFiles.length > SEARCH_VAULT_FILE_CAP;
  const matches = [];
  for (const f of filesToScan) {
    if (matches.length >= 20)
      break;
    let content;
    try {
      content = await app.vault.cachedRead(f);
    } catch (e) {
      continue;
    }
    const idx = content.toLowerCase().indexOf(needle);
    if (idx === -1)
      continue;
    const start = Math.max(0, idx - 40);
    const end = Math.min(content.length, idx + query.length + 80);
    const snippet = content.slice(start, end).replace(/\s+/g, " ").trim();
    matches.push(`${f.path}: \u2026${snippet}\u2026`);
  }
  if (matches.length === 0) {
    return fileScanTruncated ? `no matches for "${query}" (note: only first ${SEARCH_VAULT_FILE_CAP} of ${allFiles.length} notes scanned \u2014 narrow the query or read specific paths)` : `no matches for "${query}"`;
  }
  let result = matches.join("\n");
  if (fileScanTruncated) {
    result += `
[scan truncated: only first ${SEARCH_VAULT_FILE_CAP} of ${allFiles.length} notes searched]`;
  }
  return truncateWithMarker(result, SEARCH_VAULT_CHAR_CAP, "results");
}
async function getActiveNote(app) {
  const file = app.workspace.getActiveFile();
  if (!file)
    return "no active note";
  const content = await app.vault.read(file);
  return truncateWithMarker(`path: ${file.path}
---
${content}`, GET_ACTIVE_NOTE_CHAR_CAP, file.path);
}
async function ensureParentFolder(app, path) {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0)
    return;
  const folder = path.slice(0, lastSlash);
  const existing = app.vault.getAbstractFileByPath(folder);
  if (existing instanceof import_obsidian2.TFolder)
    return;
  await app.vault.adapter.mkdir(folder);
}

// src/agent-loop.ts
var DEFAULT_MAX_TOOL_ROUNDS = 10;
var HARD_MAX_TOOL_ROUNDS = 40;
async function* runClaudeAgent(args) {
  var _a, _b, _c, _d;
  const { app, apiKey, model, systemPrompt, userMessage, priorMessages, allowedTools, signal } = args;
  const allowWrites = (_a = args.allowWrites) != null ? _a : false;
  const requested = (_b = args.maxRounds) != null ? _b : DEFAULT_MAX_TOOL_ROUNDS;
  const maxRounds = Math.max(1, Math.min(requested, HARD_MAX_TOOL_ROUNDS));
  const tools = resolveTools(allowedTools).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema
  }));
  const provider = new ClaudeProvider(apiKey, model);
  const messages = [];
  for (const m of priorMessages != null ? priorMessages : []) {
    messages.push({ role: m.role, content: m.content });
  }
  messages.push({ role: "user", content: userMessage });
  for (let round = 0; round < maxRounds; round++) {
    if (signal == null ? void 0 : signal.aborted)
      return;
    const turnAssistantContent = [];
    const pendingTextChunks = [];
    const pendingToolCalls = [];
    let stopReason = "end_turn";
    try {
      const stream = provider.streamWithTools(
        systemPrompt,
        messages,
        tools,
        signal
      );
      for await (const evt of stream) {
        if (signal == null ? void 0 : signal.aborted)
          return;
        if (evt.type === "text") {
          pendingTextChunks.push(evt.text);
          yield { type: "text_delta", text: evt.text };
        } else if (evt.type === "tool_use") {
          pendingToolCalls.push({ id: evt.id, name: evt.name, input: evt.input });
        } else if (evt.type === "stop") {
          stopReason = evt.stopReason;
        }
      }
    } catch (err) {
      const e = err;
      yield { type: "error", message: (_d = (_c = e.body) != null ? _c : e.message) != null ? _d : "Claude API request failed" };
      return;
    }
    if (pendingTextChunks.length > 0) {
      turnAssistantContent.push({ type: "text", text: pendingTextChunks.join("") });
    }
    for (const tu of pendingToolCalls) {
      turnAssistantContent.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
    }
    if (stopReason !== "tool_use" || pendingToolCalls.length === 0) {
      return;
    }
    messages.push({ role: "assistant", content: turnAssistantContent });
    const toolResultBlocks = [];
    for (const tu of pendingToolCalls) {
      if (signal == null ? void 0 : signal.aborted)
        return;
      yield { type: "tool_call", id: tu.id, name: tu.name, input: tu.input };
      let output;
      let isError = false;
      try {
        output = await executeVaultTool(app, tu.name, tu.input, { allowWrites });
        if (output.startsWith("ERROR:"))
          isError = true;
      } catch (err) {
        output = `ERROR: ${err.message}`;
        isError = true;
      }
      yield { type: "tool_result", id: tu.id, name: tu.name, output, isError };
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: output,
        is_error: isError || void 0
      });
    }
    messages.push({ role: "user", content: toolResultBlocks });
  }
  yield {
    type: "error",
    message: `Agent gave up after ${maxRounds} tool rounds. Try a narrower task, raise max_rounds in the skill's frontmatter (current cap: ${HARD_MAX_TOOL_ROUNDS}), or use a more capable model.`
  };
}

// src/mention-resolver.ts
var WIKI_LINK_RX = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
async function resolveMentions(text, app) {
  const names = [...text.matchAll(WIKI_LINK_RX)].map((m) => m[1].trim());
  if (names.length === 0)
    return "";
  const unique = [...new Set(names)];
  const snippets = [];
  for (const name of unique) {
    const file = app.vault.getFiles().find(
      (f) => f.extension === "md" && f.basename.toLowerCase() === name.toLowerCase()
    );
    if (!file)
      continue;
    try {
      const content = await app.vault.cachedRead(file);
      snippets.push(`<mentioned-note title="${file.basename}">
${escapeForFraming(content)}
</mentioned-note>`);
    } catch (e) {
    }
  }
  return snippets.join("\n\n");
}

// src/bar-chat.ts
var ASK_PATTERN = /<ask>([\s\S]*?)<\/ask>/gi;
var ESTIMATED_TOKENS_PER_CHAR = 0.25;
var SCRATCH_NOTE_PATH = "__ogstack_scratch__";
var ASK_PROTOCOL_PROMPT = `

<!-- OGSTACK ASK PROTOCOL \u2014 MANDATORY -->
This UI does NOT show plain prose questions as interactive controls. If you need an answer from the user, you MUST wrap the question in <ASK>...</ASK> tags. A question written as ordinary prose will be missed and the user will not see a reply box.

# Format

Two shapes are valid:

A) Plain text \u2014 renders as a single textarea:
   <ASK>What is the target launch date?</ASK>

B) JSON with options \u2014 renders as radio buttons (single-select) or checkboxes (multi-select), plus an auto-added "Other" row that reveals a textbox:
   <ASK>{"question": "What kind of business is this?", "type": "single", "options": ["SaaS", "Service-based", "Marketplace", "Content / media"]}</ASK>
   <ASK>{"question": "Which channels are you using today?", "type": "multi", "options": ["Email", "Paid ads", "SEO", "Cold outbound", "Referrals"]}</ASK>

# Wrong vs right

WRONG (the user never sees a control \u2014 they'll just see prose):
  How will you help ecommerce businesses overcome their pain points?

RIGHT (renders as a textarea):
  <ASK>How will you help ecommerce businesses overcome their pain points related to visibility and conversion rates?</ASK>

RIGHT (renders as buttons):
  <ASK>{"question": "What is the primary metric you want to improve?", "type": "single", "options": ["Revenue", "Conversion rate", "Traffic", "Retention"]}</ASK>

# Rules

- Every interrogative directed at the user must live inside <ASK>...</ASK>. No exceptions.
- Prefer the JSON form whenever 2\u20136 distinct answers cover the realistic space. Users click faster than they type.
- Use plain text only when the answer is genuinely freeform (numbers, dates, names, descriptions, long opinions).
- Ask at most 3 ASKs per turn. Batch related questions; don't interleave them with explanations.
- Don't restate the question outside the tag \u2014 the UI shows the inner text.
- Set "allowOther": false only when "Other" makes no sense (e.g. yes/no). "Other" is on by default.
- If you have enough context to proceed, don't ask anything \u2014 just answer.
`;
var _BarChat = class _BarChat extends import_obsidian3.Component {
  constructor(config) {
    var _a;
    super();
    // Session-driven state
    this.currentSessionId = null;
    // Streaming state (transient, not persisted yet)
    this.state = "idle";
    this.streamingAssistantEl = null;
    this.streamingContent = "";
    this.currentSkill = null;
    this.currentSystemPrompt = "";
    // The active-note path at the time currentSystemPrompt was built. We compare
    // this against the current active file before each free-chat turn — if the
    // user switched notes, the system prompt is stale and needs rebuilding so
    // the model sees the right vault context.
    this.currentSystemPromptForNote = null;
    this.abortController = null;
    // Suggestions
    this.filteredEntries = [];
    this.selectedSuggestIdx = -1;
    this.triggerPos = -1;
    this.suggestDebounceTimer = null;
    this.storeUnsubscribe = null;
    this.activeLeafUnregister = null;
    // ── Drag-to-reposition + resize persistence (floating mode only) ────
    this.resizeObserver = null;
    this.dragCleanup = null;
    // ── Render ───────────────────────────────────────────────────────
    // Render coalescing: chatStore.addMessage fires onChange synchronously, and
    // the listener calls renderConversation() un-awaited. Meanwhile handleSend
    // awaits its own renderConversation(). Without serialization, those two
    // async renders interleave: each empty()s the container mid-flight, and
    // MarkdownRenderer.render's await points let messages get appended twice.
    // We allow at most one render in flight, mark subsequent requests dirty,
    // and re-render once when the in-flight one finishes.
    this.renderInFlight = false;
    this.renderDirty = false;
    this.config = config;
    this.embedded = !!config.host;
    this.container = document.createElement("div");
    this.container.className = "gstack-bar2-container" + (this.embedded ? " embedded" : "");
    this.suggestPopup = document.createElement("div");
    this.suggestPopup.className = "gstack-bar2-popup";
    this.suggestPopup.style.display = "none";
    this.suggestPopup.setAttribute("role", "listbox");
    this.suggestPopup.setAttribute("aria-label", "Skill and note suggestions");
    this.card = document.createElement("div");
    this.card.className = "gstack-bar2-card" + (this.embedded ? " embedded" : "");
    this.toolbar = document.createElement("div");
    this.toolbar.className = "gstack-bar2-toolbar";
    this.buildToolbar();
    this.card.appendChild(this.toolbar);
    this.conversationEl = document.createElement("div");
    this.conversationEl.className = "gstack-bar2-conversation";
    this.card.appendChild(this.conversationEl);
    this.inputRow = document.createElement("div");
    this.inputRow.className = "gstack-bar2-input-row";
    this.buildInputRow();
    this.inputRow.appendChild(this.suggestPopup);
    this.card.appendChild(this.inputRow);
    this.container.appendChild(this.card);
    ((_a = config.host) != null ? _a : document.body).appendChild(this.container);
    if (this.embedded)
      this.container.classList.add("visible");
    if (!this.embedded) {
      this.installDragHandle();
      this.installResizePersistence();
      this.restoreGeometry();
    }
    this.storeUnsubscribe = this.config.chatStore.onChange(() => this.onStoreChange());
    const followLeaf = config.followActiveLeaf !== false;
    if (followLeaf) {
      const ref = this.config.app.workspace.on("active-leaf-change", () => this.onActiveLeafChange());
      this.activeLeafUnregister = () => {
        this.config.app.workspace.offref(ref);
      };
    }
    this.applyState();
  }
  // ── Public API ───────────────────────────────────────────────────
  show() {
    this.container.classList.add("visible");
    if (!this.currentSessionId)
      this.attachToActiveNote();
    else
      this.renderConversation();
  }
  hide() {
    if (this.embedded)
      return;
    this.container.classList.remove("visible");
    this.hideSuggestPopup();
  }
  focusInput() {
    this.show();
    setTimeout(() => this.inputEl.focus(), 50);
  }
  isVisible() {
    return this.container.classList.contains("visible");
  }
  // Embedded host calls this to switch sessions from its sessions list.
  async setSession(sessionId) {
    const session = this.config.chatStore.getSession(sessionId);
    if (!session)
      return;
    this.currentSessionId = sessionId;
    this.currentSkill = null;
    this.currentSystemPrompt = "";
    this.currentSystemPromptForNote = null;
    this.setState("idle");
    await this.renderConversation();
    this.updateTitle();
  }
  getCurrentSessionId() {
    return this.currentSessionId;
  }
  updateSettings(settings) {
    this.config.settings = settings;
  }
  destroy() {
    var _a, _b, _c, _d, _e;
    (_a = this.abortController) == null ? void 0 : _a.abort();
    (_b = this.storeUnsubscribe) == null ? void 0 : _b.call(this);
    (_c = this.activeLeafUnregister) == null ? void 0 : _c.call(this);
    if (this.suggestDebounceTimer)
      clearTimeout(this.suggestDebounceTimer);
    (_d = this.resizeObserver) == null ? void 0 : _d.disconnect();
    (_e = this.dragCleanup) == null ? void 0 : _e.call(this);
    this.container.remove();
  }
  installDragHandle() {
    let dragStart = null;
    const onPointerDown = (e) => {
      const target = e.target;
      if (!target)
        return;
      if (target.closest("button, input, textarea, .gstack-bar2-toolbar-btn"))
        return;
      if (e.button !== 0)
        return;
      const rect = this.container.getBoundingClientRect();
      dragStart = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
      this.container.classList.add("dragging");
      this.container.style.left = `${rect.left}px`;
      this.container.style.top = `${rect.top}px`;
      this.container.style.bottom = "auto";
      this.container.style.transform = "none";
      this.toolbar.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onPointerMove = (e) => {
      if (!dragStart)
        return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      const cw = this.container.offsetWidth;
      const ch = this.container.offsetHeight;
      const minX = 60 - cw;
      const minY = 0;
      const maxX = window.innerWidth - 60;
      const maxY = window.innerHeight - 40;
      const left = Math.min(Math.max(dragStart.left + dx, minX), maxX);
      const top = Math.min(Math.max(dragStart.top + dy, minY), maxY);
      this.container.style.left = `${left}px`;
      this.container.style.top = `${top}px`;
    };
    const onPointerUp = (e) => {
      if (!dragStart)
        return;
      dragStart = null;
      this.container.classList.remove("dragging");
      try {
        this.toolbar.releasePointerCapture(e.pointerId);
      } catch (e2) {
      }
      this.persistGeometry();
    };
    this.toolbar.addEventListener("pointerdown", onPointerDown);
    this.toolbar.addEventListener("pointermove", onPointerMove);
    this.toolbar.addEventListener("pointerup", onPointerUp);
    this.toolbar.addEventListener("pointercancel", onPointerUp);
    this.toolbar.style.cursor = "grab";
    this.dragCleanup = () => {
      this.toolbar.removeEventListener("pointerdown", onPointerDown);
      this.toolbar.removeEventListener("pointermove", onPointerMove);
      this.toolbar.removeEventListener("pointerup", onPointerUp);
      this.toolbar.removeEventListener("pointercancel", onPointerUp);
    };
  }
  installResizePersistence() {
    let persistTimer = null;
    this.resizeObserver = new ResizeObserver(() => {
      if (persistTimer)
        clearTimeout(persistTimer);
      persistTimer = setTimeout(() => this.persistGeometry(), 200);
    });
    this.resizeObserver.observe(this.card);
  }
  persistGeometry() {
    try {
      const rect = this.container.getBoundingClientRect();
      const cardRect = this.card.getBoundingClientRect();
      const geom = {
        left: rect.left,
        top: rect.top,
        width: cardRect.width,
        height: cardRect.height,
        // viewport — so we can re-center sensibly if the user resized the
        // window since the last save and the old coordinates are off-screen.
        vw: window.innerWidth,
        vh: window.innerHeight
      };
      localStorage.setItem(_BarChat.GEOMETRY_STORAGE_KEY, JSON.stringify(geom));
    } catch (e) {
    }
  }
  restoreGeometry() {
    try {
      const raw = localStorage.getItem(_BarChat.GEOMETRY_STORAGE_KEY);
      if (!raw)
        return;
      const geom = JSON.parse(raw);
      const offTop = geom.top < 0 || geom.top > window.innerHeight - 40;
      const offLeft = geom.left + 60 > window.innerWidth || geom.left + geom.width < 60;
      if (!offTop && !offLeft) {
        this.container.style.left = `${geom.left}px`;
        this.container.style.top = `${geom.top}px`;
        this.container.style.bottom = "auto";
        this.container.style.transform = "none";
      }
      if (geom.width > 200 && geom.height > 120) {
        this.card.style.width = `${geom.width}px`;
        this.card.style.height = `${geom.height}px`;
      }
    } catch (e) {
    }
  }
  // ── ProgressReporter (back-compat) ───────────────────────────────
  setRunning(message) {
    this.show();
    this.appendStatusMessage(message);
  }
  setDone(_message) {
    this.show();
  }
  setError(message) {
    this.show();
    this.appendStatusMessage(`\u2715 ${message}`, true);
    this.setState("error");
  }
  // ── Skill execution ──────────────────────────────────────────────
  async runSkill(skill) {
    var _a, _b;
    this.show();
    this.currentSkill = skill;
    const activeFile = this.config.app.workspace.getActiveFile();
    if (!activeFile) {
      this.appendStatusMessage("Open a note first.", true);
      return;
    }
    if (!this.config.settings.apiKey && !isLocalOrCliProvider(this.config.settings.provider)) {
      this.appendStatusMessage("Add your API key in Settings \u2192 ogstack", true);
      return;
    }
    await this.ensureSession(activeFile);
    const prepEl = this.appendStatusMessage(`Preparing /${skill.name}\u2026`);
    let systemPrompt;
    try {
      const ctx = await buildVaultContext(
        this.config.app,
        activeFile,
        this.config.settings,
        skill.maxDepth,
        (_a = skill.maxTokens) != null ? _a : this.config.settings.maxTokens
      );
      if (!ctx) {
        prepEl.textContent = "\u2715 Could not build context.";
        return;
      }
      let finalCtx = ctx;
      if (this.config.settings.scoutEnabled && ctx.candidates.length > 0) {
        prepEl.textContent = "Scoring context relevance\u2026";
        const results = await scoutContext(ctx.candidates, ctx, this.config.app, this.config.settings);
        if (results && results.length > 0)
          finalCtx = applyScoutResults(ctx, results);
      }
      const vaultStr = formatVaultContext(finalCtx);
      systemPrompt = skill.systemPrompt.replace("{{VAULT_CONTEXT}}", vaultStr);
      systemPrompt += ASK_PROTOCOL_PROMPT;
    } catch (err) {
      prepEl.textContent = `\u2715 ${(_b = err.message) != null ? _b : "Failed to prepare"}`;
      return;
    }
    prepEl.remove();
    this.currentSystemPrompt = systemPrompt;
    await this.config.chatStore.addMessage(this.currentSessionId, "user", `/${skill.name}`);
    this.renderConversation();
    if (skill.agent) {
      await this.config.chatStore.setAgentSkill(this.currentSessionId, skill.name);
      await this.runAgentTurn(skill);
    } else {
      await this.config.chatStore.setAgentSkill(this.currentSessionId, void 0);
      await this.streamAssistantTurn();
    }
    if (skill.autoInsert && this.state === "done") {
      const session = this.currentSession();
      const lastMsg = session == null ? void 0 : session.messages[session.messages.length - 1];
      if ((lastMsg == null ? void 0 : lastMsg.role) === "assistant" && extractAsks(lastMsg.content).length === 0) {
        await this.insertIntoNote(stripAsks(lastMsg.content), "cursor");
      }
    }
  }
  // ── Session attach / switch ──────────────────────────────────────
  async attachToActiveNote() {
    const activeFile = this.config.app.workspace.getActiveFile();
    await this.ensureSession(activeFile);
    this.renderConversation();
  }
  async ensureSession(activeFile) {
    var _a, _b;
    const notePath = (_a = activeFile == null ? void 0 : activeFile.path) != null ? _a : SCRATCH_NOTE_PATH;
    const noteTitle = (_b = activeFile == null ? void 0 : activeFile.basename) != null ? _b : "Scratch";
    const existing = this.config.chatStore.getSessionsForNote(notePath)[0];
    if (existing) {
      this.currentSessionId = existing.id;
    } else {
      const created = await this.config.chatStore.createSession(notePath, noteTitle);
      this.currentSessionId = created.id;
    }
    this.updateTitle();
  }
  async onActiveLeafChange() {
    var _a;
    if (!this.isVisible())
      return;
    if (this.state === "streaming" || this.state === "waiting-ask")
      return;
    const activeFile = this.config.app.workspace.getActiveFile();
    const notePath = (_a = activeFile == null ? void 0 : activeFile.path) != null ? _a : SCRATCH_NOTE_PATH;
    const current = this.currentSession();
    if (current && current.notePath === notePath)
      return;
    await this.ensureSession(activeFile);
    this.renderConversation();
  }
  onStoreChange() {
    if (this.state === "streaming" || this.state === "waiting-ask")
      return;
    this.renderConversation();
  }
  currentSession() {
    if (!this.currentSessionId)
      return void 0;
    return this.config.chatStore.getSession(this.currentSessionId);
  }
  // ── Streaming loop ───────────────────────────────────────────────
  async streamAssistantTurn(systemPromptOverride) {
    var _a;
    if (!this.currentSessionId)
      return;
    this.setState("streaming");
    this.streamingContent = "";
    this.streamingAssistantEl = this.conversationEl.createDiv({ cls: "gstack-bar2-msg gstack-bar2-msg-assistant gstack-bar2-msg-streaming" });
    this.renderStreamingText(this.streamingAssistantEl, "");
    this.scrollToBottom();
    const history = this.buildLLMHistory();
    const provider = getProvider(this.config.settings, getVaultBasePath(this.config.app));
    const controller = new AbortController();
    this.abortController = controller;
    try {
      const stream = provider.stream({
        systemPrompt: (_a = systemPromptOverride != null ? systemPromptOverride : this.currentSystemPrompt) != null ? _a : await this.buildFreeChatSystemPrompt(),
        messages: history
      });
      for await (const token of stream) {
        if (controller.signal.aborted)
          break;
        this.streamingContent += token;
        if (this.streamingAssistantEl) {
          this.renderStreamingText(this.streamingAssistantEl, this.streamingContent);
        }
        this.scrollToBottom();
      }
      await this.finalizeAssistantTurn();
    } catch (err) {
      const e = err;
      const errText = formatProviderError(e, this.config.settings.provider);
      if (this.streamingAssistantEl) {
        this.streamingAssistantEl.empty();
        this.streamingAssistantEl.createSpan({ text: errText, cls: "gstack-bar2-msg-error" });
      }
      this.setState("error");
    } finally {
      if (this.abortController === controller)
        this.abortController = null;
    }
  }
  // Agent skill turn. Three paths:
  //   - "claude" (API)       → our streaming agent loop with vault tools
  //   - "claude-cli" / "codex-cli" → fall through to normal streaming; the CLI
  //                            is itself an agent with its own native tools
  //   - anything else        → tell the user to switch provider
  // For the agent-loop path we collect structured tool calls and persist them
  // separately from the assistant text so the bubble re-renders correctly
  // after a reload.
  // `kickoffMessage` is what the model sees as the latest user turn. For the
  // initial skill invocation this is "Run skill: /name" (default). For follow-up
  // turns in an already-active agent session, the caller passes the user's
  // actual new message so the agent continues the conversation naturally.
  async runAgentTurn(skill, kickoffMessage) {
    var _a;
    if (!this.currentSessionId)
      return;
    const provider = this.config.settings.provider;
    if (provider === "claude-cli" || provider === "codex-cli") {
      await this.streamAssistantTurn();
      return;
    }
    if (provider !== "claude") {
      this.appendStatusMessage(
        `Skill "${skill.name}" is an agent. Use the Claude API, Claude CLI, or Codex CLI provider (Settings \u2192 ogstack).`,
        true
      );
      return;
    }
    this.setState("streaming");
    const bubble = this.conversationEl.createDiv({
      cls: "gstack-bar2-msg gstack-bar2-msg-assistant gstack-bar2-msg-streaming"
    });
    const toolsEl = bubble.createDiv({ cls: "gstack-bar2-agent-tools" });
    const textEl = bubble.createDiv({ cls: "gstack-bar2-agent-text" });
    this.scrollToBottom();
    const controller = new AbortController();
    this.abortController = controller;
    const textChunks = [];
    const toolCalls = [];
    const inflight = /* @__PURE__ */ new Map();
    try {
      const events = runClaudeAgent({
        app: this.config.app,
        apiKey: this.config.settings.apiKey,
        model: this.config.settings.model || "claude-sonnet-4-6",
        systemPrompt: this.currentSystemPrompt,
        userMessage: kickoffMessage != null ? kickoffMessage : `Run skill: /${skill.name}`,
        priorMessages: this.buildLLMHistory().slice(0, -1),
        // exclude the latest user turn we're sending as userMessage
        allowedTools: skill.allowedTools,
        signal: controller.signal,
        allowWrites: this.config.settings.allowAgentWrites,
        maxRounds: skill.maxRounds
      });
      for await (const evt of events) {
        if (controller.signal.aborted)
          break;
        if (evt.type === "text_delta") {
          textChunks.push(evt.text);
          textEl.textContent = textChunks.join("");
        } else if (evt.type === "tool_call") {
          const summary = `\u{1F527} ${evt.name}(${formatToolInput(evt.input)})`;
          const line = toolsEl.createDiv({ cls: "gstack-bar2-agent-tool-call", text: summary });
          const idx = toolCalls.length;
          toolCalls.push({ id: evt.id, name: evt.name, input: evt.input, output: "", isError: false });
          inflight.set(evt.id, { idx, el: line });
        } else if (evt.type === "tool_result") {
          const entry = inflight.get(evt.id);
          if (entry) {
            toolCalls[entry.idx].output = evt.output;
            toolCalls[entry.idx].isError = evt.isError;
            entry.el.appendChild(document.createTextNode(evt.isError ? " \u2715" : " \u2713"));
            if (evt.isError)
              entry.el.addClass("gstack-bar2-agent-tool-error");
            entry.el.title = evt.output.length > 200 ? evt.output.slice(0, 200) + "\u2026" : evt.output;
            inflight.delete(evt.id);
          }
        } else if (evt.type === "error") {
          const isLimit = /gave up after \d+ tool rounds/.test(evt.message);
          if (isLimit) {
            const block = textEl.createDiv({ cls: "gstack-bar2-msg-error gstack-bar2-agent-limit" });
            block.createDiv({ text: "\u26A0 Agent stopped at the tool-round limit.", cls: "gstack-bar2-agent-limit-title" });
            block.createDiv({ text: evt.message, cls: "gstack-bar2-agent-limit-detail" });
          } else {
            textEl.createSpan({ text: `\u2715 ${evt.message}`, cls: "gstack-bar2-msg-error" });
          }
        }
        this.scrollToBottom();
      }
      if (controller.signal.aborted) {
        textEl.createSpan({ text: " (stopped)", cls: "gstack-bar2-msg-status" });
      }
      await this.config.chatStore.addMessage(
        this.currentSessionId,
        "assistant",
        textChunks.join(""),
        toolCalls.length > 0 ? toolCalls : void 0
      );
      this.setState("done");
      await this.renderConversation();
    } catch (err) {
      const msg = (_a = err.message) != null ? _a : "Agent failed";
      textEl.createSpan({ text: `\u2715 ${msg}`, cls: "gstack-bar2-msg-error" });
      this.setState("error");
    } finally {
      if (this.abortController === controller)
        this.abortController = null;
    }
  }
  async finalizeAssistantTurn() {
    if (!this.currentSessionId)
      return;
    const content = this.streamingContent;
    this.streamingContent = "";
    this.streamingAssistantEl = null;
    await this.config.chatStore.addMessage(this.currentSessionId, "assistant", content);
    const asks = extractAsks(content);
    this.setState(asks.length > 0 ? "waiting-ask" : "done");
    await this.renderConversation();
    this.maybePromptCompaction();
  }
  async renderConversation() {
    if (this.renderInFlight) {
      this.renderDirty = true;
      return;
    }
    this.renderInFlight = true;
    try {
      await this.doRenderConversation();
      while (this.renderDirty) {
        this.renderDirty = false;
        await this.doRenderConversation();
      }
    } finally {
      this.renderInFlight = false;
    }
  }
  async doRenderConversation() {
    const session = this.currentSession();
    this.conversationEl.empty();
    this.updateTitle();
    if (!session || session.messages.length === 0) {
      this.applyState();
      return;
    }
    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i];
      const isLast = i === session.messages.length - 1;
      await this.renderStoredMessage(msg, isLast);
    }
    this.applyState();
    this.scrollToBottom();
  }
  async renderStoredMessage(msg, isLast) {
    if (msg.role === "user") {
      const el2 = this.conversationEl.createDiv({ cls: "gstack-bar2-msg gstack-bar2-msg-user" });
      el2.textContent = msg.content;
      return;
    }
    const el = this.conversationEl.createDiv({ cls: "gstack-bar2-msg gstack-bar2-msg-assistant" });
    const asks = extractAsks(msg.content);
    const visible = stripAsks(msg.content);
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      this.renderPersistedToolCalls(el, msg.toolCalls);
    }
    const contentEl = el.createDiv({ cls: "gstack-bar2-msg-content" });
    if (visible) {
      await import_obsidian3.MarkdownRenderer.render(this.config.app, visible, contentEl, "", this);
    }
    if (visible) {
      this.renderActionButtons(el, visible);
    }
    if (isLast && asks.length > 0 && this.state === "waiting-ask") {
      this.renderAskUI(el, asks);
    }
  }
  renderStreamingText(el, content) {
    el.textContent = stripAsks(content);
  }
  renderPersistedToolCalls(parent, calls) {
    const toolsEl = parent.createDiv({ cls: "gstack-bar2-agent-tools" });
    for (const t of calls) {
      const summary = `\u{1F527} ${t.name}(${formatToolInput(t.input)}) ${t.isError ? "\u2715" : "\u2713"}`;
      const line = toolsEl.createDiv({
        cls: "gstack-bar2-agent-tool-call" + (t.isError ? " gstack-bar2-agent-tool-error" : ""),
        text: summary
      });
      line.title = t.output.length > 200 ? t.output.slice(0, 200) + "\u2026" : t.output;
    }
  }
  renderActionButtons(parent, content) {
    const actions = parent.createDiv({ cls: "gstack-bar2-msg-actions" });
    const insertBtn = actions.createEl("button", { cls: "gstack-bar2-action-btn", text: "Insert at cursor" });
    insertBtn.addEventListener("click", () => this.insertIntoNote(content, "cursor"));
    const appendBtn = actions.createEl("button", { cls: "gstack-bar2-action-btn", text: "Append" });
    appendBtn.addEventListener("click", () => this.insertIntoNote(content, "end"));
    const copyBtn = actions.createEl("button", { cls: "gstack-bar2-action-btn", text: "Copy" });
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(content);
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1500);
    });
  }
  renderAskUI(parent, asks) {
    const askContainer = parent.createDiv({ cls: "gstack-bar2-ask" });
    askContainer.createDiv({
      cls: "gstack-bar2-ask-header",
      text: asks.length > 1 ? `${asks.length} questions` : "1 question"
    });
    const specs = asks.map(parseAskBody);
    const readers = [];
    let firstFocusable = null;
    const submit = async () => doSubmit();
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const row = askContainer.createDiv({ cls: `gstack-bar2-ask-row gstack-bar2-ask-${spec.type}` });
      const qEl = row.createDiv({ cls: "gstack-bar2-ask-question" });
      void import_obsidian3.MarkdownRenderer.render(this.config.app, spec.question, qEl, "", this);
      if (spec.type === "text") {
        const ta = row.createEl("textarea", { cls: "gstack-bar2-ask-input" });
        ta.rows = 1;
        ta.placeholder = "Your answer\u2026 (Enter to send, Shift+Enter for newline)";
        ta.addEventListener("input", () => {
          ta.style.height = "auto";
          ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
        });
        ta.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            void submit();
          }
        });
        readers.push(() => ta.value.trim());
        if (!firstFocusable)
          firstFocusable = ta;
        continue;
      }
      const groupName = `gstack-ask-${Date.now()}-${i}`;
      const optionsList = row.createDiv({ cls: "gstack-bar2-ask-options" });
      const aiOtherIdx = spec.options.findIndex((o) => isOtherLikeOption(o));
      const aiHasOther = aiOtherIdx !== -1;
      const showOtherRow = !aiHasOther && spec.allowOther;
      const inputs = [];
      let aiOtherInput = null;
      for (let oi = 0; oi < spec.options.length; oi++) {
        const opt = spec.options[oi];
        const id = `${groupName}-${oi}`;
        const isAiOther = oi === aiOtherIdx;
        const optionRow = optionsList.createEl("label", {
          cls: "gstack-bar2-ask-option" + (isAiOther ? " gstack-bar2-ask-option-other" : "")
        });
        optionRow.setAttribute("for", id);
        const input = optionRow.createEl("input", {
          attr: {
            type: spec.type === "single" ? "radio" : "checkbox",
            name: groupName,
            value: opt,
            id
          }
        });
        optionRow.createEl("span", { text: opt, cls: "gstack-bar2-ask-option-label" });
        inputs.push(input);
        if (isAiOther)
          aiOtherInput = input;
        if (!firstFocusable)
          firstFocusable = input;
      }
      let otherInput = aiOtherInput;
      let otherText = null;
      let otherTextWrap = null;
      if (aiHasOther || showOtherRow) {
        if (showOtherRow) {
          const id = `${groupName}-other`;
          const otherRow = optionsList.createEl("label", {
            cls: "gstack-bar2-ask-option gstack-bar2-ask-option-other"
          });
          otherRow.setAttribute("for", id);
          otherInput = otherRow.createEl("input", {
            attr: { type: spec.type === "single" ? "radio" : "checkbox", name: groupName, value: "__other__", id }
          });
          otherRow.createEl("span", { text: "Other", cls: "gstack-bar2-ask-option-label" });
        }
        otherTextWrap = optionsList.createDiv({ cls: "gstack-bar2-ask-other-input-wrap" });
        otherText = otherTextWrap.createEl("textarea", {
          cls: "gstack-bar2-ask-input gstack-bar2-ask-other-input"
        });
        otherText.rows = 1;
        otherText.placeholder = "Type your answer\u2026 (Enter to send)";
        otherTextWrap.style.display = "none";
        const syncOther = () => {
          const show = !!(otherInput == null ? void 0 : otherInput.checked);
          if (otherTextWrap)
            otherTextWrap.style.display = show ? "" : "none";
          if (show)
            otherText == null ? void 0 : otherText.focus();
        };
        otherInput == null ? void 0 : otherInput.addEventListener("change", syncOther);
        if (spec.type === "single") {
          for (const inp of inputs) {
            if (inp !== otherInput)
              inp.addEventListener("change", syncOther);
          }
        }
        otherText.addEventListener("input", () => {
          otherText.style.height = "auto";
          otherText.style.height = Math.min(otherText.scrollHeight, 120) + "px";
        });
        otherText.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            void submit();
          }
        });
      }
      for (const inp of inputs) {
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        });
      }
      readers.push(() => {
        var _a, _b;
        const picked = [];
        for (const inp of inputs) {
          if (!inp.checked)
            continue;
          if (inp === aiOtherInput) {
            const txt = (_a = otherText == null ? void 0 : otherText.value.trim()) != null ? _a : "";
            picked.push(txt ? `${inp.value}: ${txt}` : inp.value);
          } else {
            picked.push(inp.value);
          }
        }
        if (!aiHasOther && showOtherRow && (otherInput == null ? void 0 : otherInput.checked)) {
          const otherVal = (_b = otherText == null ? void 0 : otherText.value.trim()) != null ? _b : "";
          picked.push(otherVal ? `Other: ${otherVal}` : "Other");
        }
        return picked.join("; ");
      });
    }
    const submitBtn = askContainer.createEl("button", { cls: "gstack-bar2-ask-submit", text: "Send answers" });
    const doSubmit = async () => {
      if (submitBtn.disabled)
        return;
      const answers = readers.map((read, idx) => {
        const a = read();
        return `**Q: ${specs[idx].question}**
A: ${a || "(no answer)"}`;
      });
      submitBtn.disabled = true;
      askContainer.querySelectorAll("input, textarea").forEach((el) => {
        el.disabled = true;
      });
      if (!this.currentSessionId)
        return;
      const answerText = answers.join("\n\n");
      const mentionBlock = await resolveMentions(answerText, this.config.app);
      const systemPromptForTurn = mentionBlock ? `${this.currentSystemPrompt}

${mentionBlock}` : this.currentSystemPrompt;
      await this.config.chatStore.addMessage(this.currentSessionId, "user", answerText);
      await this.renderConversation();
      await this.streamAssistantTurn(systemPromptForTurn);
    };
    submitBtn.addEventListener("click", () => void doSubmit());
    setTimeout(() => firstFocusable == null ? void 0 : firstFocusable.focus(), 50);
  }
  // ── Toolbar / input ──────────────────────────────────────────────
  buildToolbar() {
    if (this.embedded && this.config.onClose) {
      const backBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn gstack-bar2-toolbar-back", text: "\u2190" });
      backBtn.title = "Back to chats";
      backBtn.setAttribute("aria-label", "Back to chats");
      backBtn.addEventListener("click", () => {
        var _a, _b;
        return (_b = (_a = this.config).onClose) == null ? void 0 : _b.call(_a);
      });
    }
    this.titleEl = this.toolbar.createDiv({ cls: "gstack-bar2-toolbar-title", text: "ogstack" });
    const newBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "+ New chat" });
    newBtn.title = "Start a new conversation for the active note";
    newBtn.setAttribute("aria-label", "Start new chat");
    newBtn.addEventListener("click", () => this.startNewChat());
    const compactBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "Compact \u2191" });
    compactBtn.title = "Summarize older messages to save tokens";
    compactBtn.setAttribute("aria-label", "Compact conversation");
    compactBtn.addEventListener("click", () => this.compactConversation());
    const saveBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "Save to note" });
    saveBtn.title = "Append the whole conversation as a markdown transcript to the bound note";
    saveBtn.setAttribute("aria-label", "Save chat to note");
    saveBtn.addEventListener("click", () => this.exportTranscript());
    if (!this.embedded) {
      const openSidebarBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "Open in sidebar" });
      openSidebarBtn.title = "Continue this chat in the right sidebar";
      openSidebarBtn.setAttribute("aria-label", "Open chat in sidebar");
      openSidebarBtn.addEventListener("click", () => this.openInSidebar());
      const closeBtn = this.toolbar.createEl("button", { cls: "gstack-bar2-toolbar-btn gstack-bar2-toolbar-close", text: "\xD7" });
      closeBtn.title = "Hide";
      closeBtn.setAttribute("aria-label", "Close chat");
      closeBtn.addEventListener("click", () => this.hide());
    }
  }
  updateTitle() {
    var _a;
    const session = this.currentSession();
    if (!this.titleEl)
      return;
    const baseTitle = (_a = session == null ? void 0 : session.noteTitle) != null ? _a : "ogstack";
    const display = baseTitle === "Scratch" ? "Scratch chat" : baseTitle;
    this.titleEl.empty();
    this.titleEl.createSpan({ text: display });
    if (session == null ? void 0 : session.agentSkillName) {
      this.titleEl.createSpan({
        text: ` \xB7 agent: /${session.agentSkillName}`,
        cls: "gstack-bar2-toolbar-agent-tag"
      });
    }
  }
  async startNewChat() {
    var _a, _b;
    if (this.state === "streaming")
      this.stopStream();
    const activeFile = this.config.app.workspace.getActiveFile();
    const notePath = (_a = activeFile == null ? void 0 : activeFile.path) != null ? _a : SCRATCH_NOTE_PATH;
    const noteTitle = (_b = activeFile == null ? void 0 : activeFile.basename) != null ? _b : "Scratch";
    const session = await this.config.chatStore.createSession(notePath, noteTitle);
    this.currentSessionId = session.id;
    this.currentSkill = null;
    this.currentSystemPrompt = "";
    this.currentSystemPromptForNote = null;
    await this.config.chatStore.setAgentSkill(session.id, void 0);
    this.setState("idle");
    this.updateTitle();
    await this.renderConversation();
    this.inputEl.focus();
  }
  async openInSidebar() {
    const session = this.currentSession();
    if (!session)
      return;
    const workspace = this.config.app.workspace;
    const leaf = workspace.getRightLeaf(false);
    if (!leaf)
      return;
    await leaf.setViewState({ type: "ogstack-sidebar", active: true });
    workspace.revealLeaf(leaf);
  }
  buildInputRow() {
    this.inputEl = this.inputRow.createEl("textarea", { cls: "gstack-bar2-input" });
    this.inputEl.placeholder = "Ask, /skill, or @[[note]]\u2026";
    this.inputEl.rows = 1;
    this.inputEl.addEventListener("input", () => {
      this.autoResize();
      if (this.suggestDebounceTimer)
        clearTimeout(this.suggestDebounceTimer);
      this.suggestDebounceTimer = setTimeout(() => this.handleInputForSuggest(), 70);
    });
    this.inputEl.addEventListener("keydown", (e) => this.handleKeydown(e));
    this.sendBtn = this.inputRow.createEl("button", { cls: "gstack-bar2-send", text: "\u2191" });
    this.sendBtn.title = "Send (Enter)";
    this.sendBtn.setAttribute("aria-label", "Send message");
    this.sendBtn.addEventListener("click", () => this.handleSend());
    this.stopBtn = this.inputRow.createEl("button", { cls: "gstack-bar2-stop", text: "\u25A0" });
    this.stopBtn.title = "Stop";
    this.stopBtn.setAttribute("aria-label", "Stop generation");
    this.stopBtn.style.display = "none";
    this.stopBtn.addEventListener("click", () => this.stopStream());
    this.inputEl.setAttribute("aria-label", "Chat message input");
  }
  autoResize() {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + "px";
  }
  // ── Input → action ───────────────────────────────────────────────
  async handleSend() {
    var _a;
    const text = this.inputEl.value.trim();
    if (!text || this.state === "streaming")
      return;
    if (text.startsWith("/")) {
      const skillName = text.slice(1).split(/\s/)[0];
      const skill = this.config.getSkills().get(skillName);
      if (skill) {
        this.inputEl.value = "";
        this.autoResize();
        this.hideSuggestPopup();
        await this.runSkill(skill);
        return;
      }
    }
    this.inputEl.value = "";
    this.autoResize();
    this.hideSuggestPopup();
    const activeFile = this.config.app.workspace.getActiveFile();
    await this.ensureSession(activeFile);
    const session = this.currentSession();
    const stuckAgentSkillName = session == null ? void 0 : session.agentSkillName;
    if (stuckAgentSkillName) {
      const agentSkill = this.config.getSkills().get(stuckAgentSkillName);
      if (agentSkill) {
        await this.config.chatStore.addMessage(this.currentSessionId, "user", text);
        await this.renderConversation();
        await this.runAgentTurn(agentSkill, text);
        return;
      }
    }
    const activePath = (_a = activeFile == null ? void 0 : activeFile.path) != null ? _a : null;
    const isFreeChat = !this.currentSkill;
    const noteChanged = isFreeChat && this.currentSystemPromptForNote !== activePath;
    if (isFreeChat && ((session == null ? void 0 : session.messages.length) === 0 || noteChanged)) {
      this.currentSystemPrompt = await this.buildFreeChatSystemPrompt();
      this.currentSystemPromptForNote = activePath;
    }
    const mentionBlock = await resolveMentions(text, this.config.app);
    const systemPromptForTurn = mentionBlock ? `${this.currentSystemPrompt}

${mentionBlock}` : this.currentSystemPrompt;
    await this.config.chatStore.addMessage(this.currentSessionId, "user", text);
    await this.renderConversation();
    await this.streamAssistantTurn(systemPromptForTurn);
  }
  async buildFreeChatSystemPrompt() {
    const activeFile = this.config.app.workspace.getActiveFile();
    const base = "You are a concise AI assistant embedded in Obsidian. Help the user think through their notes. When listing or formatting, use markdown.";
    if (!activeFile)
      return base + ASK_PROTOCOL_PROMPT + "\n\n(No active note open.)";
    try {
      const ctx = await buildVaultContext(this.config.app, activeFile, this.config.settings, 2, Math.min(this.config.settings.maxTokens, 4e3));
      if (!ctx)
        return base + ASK_PROTOCOL_PROMPT;
      return base + ASK_PROTOCOL_PROMPT + "\n\n" + formatVaultContext(ctx);
    } catch (e) {
      return base + ASK_PROTOCOL_PROMPT;
    }
  }
  handleKeydown(e) {
    if (this.filteredEntries.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.selectedSuggestIdx = Math.min(this.selectedSuggestIdx + 1, this.filteredEntries.length - 1);
        this.updateSuggestSelection();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.selectedSuggestIdx = Math.max(this.selectedSuggestIdx - 1, 0);
        this.updateSuggestSelection();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (this.selectedSuggestIdx >= 0) {
          this.applySuggestEntry(this.filteredEntries[this.selectedSuggestIdx]);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.hideSuggestPopup();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (this.state === "streaming")
        this.stopStream();
      else
        this.hide();
    }
  }
  handleInputForSuggest() {
    var _a;
    const cursor = (_a = this.inputEl.selectionStart) != null ? _a : 0;
    const text = this.inputEl.value.slice(0, cursor);
    const slashMatch = text.match(/(?:^|[\s\n])(\/)([^\s]*)$/);
    if (slashMatch) {
      this.triggerPos = cursor - slashMatch[1].length - slashMatch[2].length;
      const q = slashMatch[2].toLowerCase();
      const entries = [...this.config.getSkills().values()].filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)).slice(0, 8).map((s) => ({ kind: "skill", skill: s }));
      this.renderSuggestPopup(entries);
      return;
    }
    const atMatch = text.match(/(?:^|[\s\n])@([^\s\n@]*)$/);
    if (atMatch) {
      this.triggerPos = cursor - 1 - atMatch[1].length;
      const q = atMatch[1].toLowerCase();
      const entries = this.config.app.vault.getFiles().filter((f) => f.extension === "md" && f.basename.toLowerCase().includes(q)).slice(0, 8).map((f) => ({ kind: "note", file: f }));
      this.renderSuggestPopup(entries);
      return;
    }
    this.hideSuggestPopup();
  }
  renderSuggestPopup(entries) {
    this.filteredEntries = entries;
    this.selectedSuggestIdx = entries.length > 0 ? 0 : -1;
    this.suggestPopup.empty();
    if (entries.length === 0) {
      this.suggestPopup.style.display = "none";
      return;
    }
    this.suggestPopup.style.display = "";
    entries.forEach((entry, i) => {
      const item = this.suggestPopup.createDiv({ cls: "gstack-bar2-popup-item" + (i === this.selectedSuggestIdx ? " selected" : "") });
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(i === this.selectedSuggestIdx));
      if (entry.kind === "skill") {
        item.createEl("span", { text: `/${entry.skill.name}`, cls: "gstack-bar2-popup-name" });
        item.createEl("span", { text: entry.skill.description, cls: "gstack-bar2-popup-desc" });
      } else {
        item.createEl("span", { text: `@${entry.file.basename}`, cls: "gstack-bar2-popup-name gstack-bar2-popup-note" });
        item.createEl("span", { text: entry.file.path, cls: "gstack-bar2-popup-desc" });
      }
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.applySuggestEntry(entry);
      });
    });
  }
  updateSuggestSelection() {
    this.suggestPopup.querySelectorAll(".gstack-bar2-popup-item").forEach((el, i) => {
      const isSel = i === this.selectedSuggestIdx;
      el.classList.toggle("selected", isSel);
      el.setAttribute("aria-selected", String(isSel));
    });
  }
  applySuggestEntry(entry) {
    var _a;
    const before = this.inputEl.value.slice(0, this.triggerPos);
    const after = this.inputEl.value.slice((_a = this.inputEl.selectionStart) != null ? _a : this.inputEl.value.length);
    if (entry.kind === "skill") {
      this.inputEl.value = before + `/${entry.skill.name} ` + after;
    } else {
      this.inputEl.value = before + `[[${entry.file.basename}]]` + after;
    }
    this.hideSuggestPopup();
    this.inputEl.focus();
    this.autoResize();
  }
  hideSuggestPopup() {
    this.suggestPopup.style.display = "none";
    this.filteredEntries = [];
    this.selectedSuggestIdx = -1;
  }
  // ── State ────────────────────────────────────────────────────────
  setState(state) {
    var _a, _b;
    const wasStreaming = this.state === "streaming";
    this.state = state;
    this.applyState();
    const isStreaming = state === "streaming";
    if (wasStreaming !== isStreaming) {
      const label = this.currentSkill ? `/${this.currentSkill.name}` : "thinking";
      (_b = (_a = this.config).onStreamingChange) == null ? void 0 : _b.call(_a, isStreaming, label);
    }
  }
  applyState() {
    this.card.dataset.state = this.state;
    const showStop = this.state === "streaming";
    this.stopBtn.style.display = showStop ? "" : "none";
    this.sendBtn.style.display = showStop ? "none" : "";
    this.inputEl.disabled = this.state === "streaming";
    const session = this.currentSession();
    const hasConvo = !!session && session.messages.length > 0;
    this.toolbar.style.display = "";
    this.conversationEl.style.display = "";
    if (hasConvo)
      this.card.classList.add("has-conversation");
    else
      this.card.classList.remove("has-conversation");
  }
  stopStream() {
    var _a;
    (_a = this.abortController) == null ? void 0 : _a.abort();
    this.abortController = null;
    this.setState("done");
  }
  // ── Helpers ──────────────────────────────────────────────────────
  scrollToBottom() {
    requestAnimationFrame(() => {
      this.conversationEl.scrollTop = this.conversationEl.scrollHeight;
    });
  }
  appendStatusMessage(text, isError = false) {
    const el = this.conversationEl.createDiv({
      cls: "gstack-bar2-msg gstack-bar2-msg-status" + (isError ? " gstack-bar2-msg-error" : ""),
      text
    });
    this.setState(isError ? "error" : "streaming");
    this.scrollToBottom();
    return el;
  }
  buildLLMHistory() {
    const session = this.currentSession();
    if (!session)
      return [{ role: "user", content: "Begin." }];
    const history = session.messages.map((m) => ({ role: m.role, content: m.content }));
    if (history.length === 0 || history.every((h) => h.role === "assistant")) {
      history.push({ role: "user", content: "Begin." });
    }
    return history;
  }
  // Route insert/append to the note the chat session is bound to, NOT whatever
  // note happens to be focused right now. Users often click between notes while
  // an assistant reply is on screen — without this routing, "Insert at cursor"
  // would silently dump the content into the wrong file.
  // Build a markdown transcript of the current session and append it to the
  // bound note. Strips ASK tags (UI affordances, not user-readable content)
  // and renders agent tool calls as a code-fenced sidebar so the saved record
  // still shows what the agent did.
  async exportTranscript() {
    var _a;
    const session = this.currentSession();
    if (!session || session.messages.length === 0) {
      new import_obsidian3.Notice("ogstack: nothing to save \u2014 this chat is empty");
      return;
    }
    const title = session.noteTitle || "Chat";
    const stamp = new Date((_a = session.updatedAt) != null ? _a : Date.now()).toLocaleString();
    const lines = [`## ogstack chat \u2014 ${title}`, `*${stamp}*`, ""];
    for (const msg of session.messages) {
      if (msg.role === "user") {
        lines.push("**You:**", "", msg.content.trim(), "");
        continue;
      }
      lines.push("**Assistant:**", "");
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        lines.push("```text");
        for (const t of msg.toolCalls) {
          const status = t.isError ? "\u2715" : "\u2713";
          lines.push(`${status} ${t.name}(${formatToolInputForLog(t.input)})`);
        }
        lines.push("```", "");
      }
      const visible = stripAsks(msg.content).trim();
      if (visible) {
        lines.push(visible, "");
      }
    }
    const transcript = lines.join("\n").trimEnd() + "\n";
    await this.insertIntoNote(transcript, "end");
  }
  async insertIntoNote(content, mode) {
    var _a, _b, _c, _d, _e, _f;
    const session = this.currentSession();
    const targetPath = session == null ? void 0 : session.notePath;
    const isScratch = !targetPath || targetPath === SCRATCH_NOTE_PATH;
    let editor = null;
    let openedTargetNote = false;
    if (!isScratch && targetPath) {
      const targetFile = this.config.app.vault.getAbstractFileByPath(targetPath);
      if (targetFile instanceof import_obsidian3.TFile) {
        const activeView = this.config.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView);
        if (activeView && ((_a = activeView.file) == null ? void 0 : _a.path) === targetPath) {
          editor = activeView.editor;
        } else {
          const leaf = this.config.app.workspace.getLeaf(false);
          try {
            await leaf.openFile(targetFile);
            openedTargetNote = true;
            const reopenedView = this.config.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView);
            editor = (_b = reopenedView == null ? void 0 : reopenedView.editor) != null ? _b : null;
          } catch (e) {
            editor = null;
          }
        }
      }
    }
    if (!editor) {
      editor = (_d = (_c = this.config.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView)) == null ? void 0 : _c.editor) != null ? _d : null;
    }
    if (!editor) {
      await navigator.clipboard.writeText(content);
      new import_obsidian3.Notice("ogstack: no editor open \u2014 content copied to clipboard");
      return;
    }
    if (mode === "cursor") {
      editor.replaceRange(content, editor.getCursor());
    } else {
      const lastLine = editor.lastLine();
      const lastLineLen = editor.getLine(lastLine).length;
      const insert = (lastLineLen > 0 ? "\n\n" : "") + content;
      editor.replaceRange(insert, { line: lastLine, ch: lastLineLen });
    }
    if (openedTargetNote && !isScratch && targetPath) {
      const name = (_f = (_e = targetPath.split("/").pop()) == null ? void 0 : _e.replace(/\.md$/, "")) != null ? _f : targetPath;
      new import_obsidian3.Notice(`ogstack: inserted into ${name}`);
    }
  }
  // ── Compaction ───────────────────────────────────────────────────
  estimateTokens() {
    const session = this.currentSession();
    if (!session)
      return 0;
    return Math.floor(
      session.messages.reduce((sum, m) => sum + m.content.length, 0) * ESTIMATED_TOKENS_PER_CHAR
    );
  }
  maybePromptCompaction() {
    const tokens = this.estimateTokens();
    if (tokens < this.config.settings.compactionThreshold)
      return;
    if (this.toolbar.querySelector(".gstack-bar2-compact-prompt"))
      return;
    const prompt = this.toolbar.createDiv({ cls: "gstack-bar2-compact-prompt" });
    prompt.createSpan({ text: `Chat is getting long (~${tokens} tokens).` });
    const yes = prompt.createEl("button", { cls: "gstack-bar2-toolbar-btn mod-cta", text: "Compact" });
    yes.addEventListener("click", async () => {
      prompt.remove();
      await this.compactConversation();
    });
    const dismiss = prompt.createEl("button", { cls: "gstack-bar2-toolbar-btn", text: "Dismiss" });
    dismiss.addEventListener("click", () => prompt.remove());
  }
  async compactConversation() {
    const session = this.currentSession();
    if (!session || session.messages.length < 4)
      return;
    const toSummarize = session.messages.slice(0, -2);
    const recent = session.messages.slice(-2);
    const text = toSummarize.map((m, i) => {
      var _a;
      const tag = `turn-${i + 1} ${m.role}`;
      const toolLines = ((_a = m.toolCalls) != null ? _a : []).map((t) => `  [tool: ${t.name}(${formatToolInputForLog(t.input)}) \u2192 ${t.isError ? "ERROR" : truncateForLog(t.output, 200)}]`).join("\n");
      const body = toolLines ? `${toolLines}
${m.content}` : m.content;
      return `[${tag}]
${body}
[/${tag}]`;
    }).join("\n\n");
    const compactionPrompt = `Summarize the following conversation into a compact set of key points. Preserve all decisions, facts the user shared, conclusions reached, AND every distinct vault note already explored or modified by agent tools (so the agent doesn't re-read them later). Be brief.

${text}`;
    const statusEl = this.appendStatusMessage("Compacting older messages\u2026");
    try {
      const provider = getProvider(this.config.settings, getVaultBasePath(this.config.app));
      let summary = "";
      const stream = provider.stream({
        systemPrompt: "You compress conversations losslessly into concise bullet points.",
        userMessage: compactionPrompt
      });
      for await (const token of stream)
        summary += token;
      statusEl.remove();
      await this.config.chatStore.replaceSessionMessages(session.id, [
        { role: "assistant", content: `**[Earlier conversation, compacted]**

${summary}`, timestamp: Date.now() },
        ...recent
      ]);
      this.setState("done");
      await this.renderConversation();
    } catch (err) {
      statusEl.textContent = `\u2715 Compaction failed: ${err.message}`;
    }
  }
};
_BarChat.GEOMETRY_STORAGE_KEY = "ogstack:bar:geometry:v1";
var BarChat = _BarChat;
function isOtherLikeOption(label) {
  const s = label.trim().toLowerCase();
  if (!s)
    return false;
  const head = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return head === "other" || head === "something else" || head === "none of the above" || head === "n/a" || head === "na";
}
function parseAskBody(body) {
  const trimmed = body.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed);
      const q = typeof obj.question === "string" ? obj.question.trim() : "";
      if (q) {
        const rawType = obj.type;
        const type = rawType === "multi" || rawType === "multiple" || rawType === "checkbox" ? "multi" : rawType === "single" || rawType === "radio" || rawType === "choice" ? "single" : "text";
        const options = Array.isArray(obj.options) ? obj.options.map((o) => String(o)).filter((s) => s.length > 0) : [];
        const finalType = type === "text" && options.length > 0 ? "single" : type;
        const allowOther = options.length > 0 && obj.allowOther !== false;
        return { question: q, type: finalType, options, allowOther };
      }
    } catch (e) {
    }
  }
  return { question: trimmed, type: "text", options: [], allowOther: false };
}
function extractAsks(text) {
  const out = [];
  ASK_PATTERN.lastIndex = 0;
  let m;
  while ((m = ASK_PATTERN.exec(text)) !== null) {
    const q = m[1].trim();
    if (q)
      out.push(q);
  }
  return out;
}
function formatToolInputForLog(input) {
  const keys = Object.keys(input);
  if (keys.length === 0)
    return "";
  return keys.map((k) => {
    const v = input[k];
    const s = typeof v === "string" ? truncateForLog(v, 40) : JSON.stringify(v);
    return `${k}=${s}`;
  }).join(", ");
}
function truncateForLog(s, n) {
  if (s.length <= n)
    return s;
  return s.slice(0, n - 1) + "\u2026";
}
function formatToolInput(input) {
  const keys = Object.keys(input);
  if (keys.length === 0)
    return "";
  return keys.map((k) => {
    const v = input[k];
    const display = typeof v === "string" ? truncate(v, 60) : JSON.stringify(v);
    return `${k}=${display}`;
  }).join(", ");
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
}
function getVaultBasePath(app) {
  const adapter = app.vault.adapter;
  if (typeof adapter.getBasePath === "function")
    return adapter.getBasePath();
  if (typeof adapter.basePath === "string")
    return adapter.basePath;
  return void 0;
}
function stripAsks(text) {
  return text.replace(ASK_PATTERN, "").trim();
}
function isLocalOrCliProvider(p) {
  return p === "ollama" || p === "claude-cli" || p === "codex-cli" || p === "gemini-cli";
}
function formatProviderError(e, provider) {
  var _a, _b, _c;
  if (e.name === "AbortError" || e.message === "timeout")
    return "Timed out after 120s.";
  if (e.status === 401)
    return "Invalid API key \u2014 check Settings \u2192 ogstack.";
  if (e.status === 0)
    return `Cannot reach ${provider}. ${(_a = e.body) != null ? _a : ""}`.trim();
  if (e.status && e.status >= 400)
    return `Provider error ${e.status}: ${(_b = e.body) != null ? _b : "no detail"}`;
  return (_c = e.message) != null ? _c : `Could not reach ${provider}.`;
}

// src/yaml-mini.ts
function parseYamlFrontmatter(input) {
  var _a, _b;
  const out = {};
  const lines = input.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmedFull = stripTrailingComment(rawLine).trim();
    if (trimmedFull === "") {
      i++;
      continue;
    }
    if (/^\s/.test(rawLine)) {
      i++;
      continue;
    }
    const colonIdx = findKeyColon(trimmedFull);
    if (colonIdx <= 0)
      return null;
    const key = trimmedFull.slice(0, colonIdx).trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(key))
      return null;
    if (Object.prototype.hasOwnProperty.call(out, key))
      return null;
    const rawValue = trimmedFull.slice(colonIdx + 1).trim();
    if (rawValue === "|" || rawValue === ">") {
      const folded = rawValue === ">";
      i++;
      const collected = [];
      let baseIndent = -1;
      while (i < lines.length) {
        const ln = lines[i];
        if (ln.trim() === "") {
          collected.push("");
          i++;
          continue;
        }
        const indent = (_b = (_a = ln.match(/^(\s*)/)) == null ? void 0 : _a[1].length) != null ? _b : 0;
        if (indent === 0)
          break;
        if (baseIndent === -1)
          baseIndent = indent;
        if (indent < baseIndent)
          break;
        collected.push(ln.slice(baseIndent));
        i++;
      }
      while (collected.length && collected[collected.length - 1] === "")
        collected.pop();
      out[key] = folded ? collected.join(" ").replace(/\s+/g, " ").trim() : collected.join("\n");
      continue;
    }
    if (rawValue === "") {
      i++;
      const items = [];
      let consumed = false;
      while (i < lines.length) {
        const ln = lines[i];
        if (ln.trim() === "") {
          i++;
          continue;
        }
        if (!/^\s/.test(ln))
          break;
        const m = ln.trim().match(/^-\s*(.*)$/);
        if (m) {
          let v = m[1];
          if (v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'")) {
            v = v.slice(1, -1);
          }
          items.push(v);
          consumed = true;
          i++;
          continue;
        }
        i++;
      }
      out[key] = consumed ? `[${items.join(", ")}]` : "";
      continue;
    }
    const parsed = parseScalar(rawValue);
    if (parsed === null)
      return null;
    out[key] = parsed;
    i++;
  }
  return out;
}
function stripTrailingComment(line) {
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inDouble) {
      escape = true;
      continue;
    }
    if (c === "'" && !inDouble)
      inSingle = !inSingle;
    else if (c === '"' && !inSingle)
      inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1]))
        return line.slice(0, i);
    }
  }
  return line;
}
function findKeyColon(line) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== ":")
      continue;
    if (i + 1 === line.length)
      return i;
    const next = line[i + 1];
    if (next === " " || next === "	")
      return i;
  }
  return -1;
}
function parseScalar(s) {
  if (s === "")
    return "";
  const c = s[0];
  if (c === '"' || c === "'")
    return parseQuoted(s, c);
  return s;
}
function parseQuoted(s, quote) {
  if (s.length < 2 || s[s.length - 1] !== quote)
    return null;
  const body = s.slice(1, -1);
  if (quote === "'") {
    return body.replace(/''/g, "'");
  }
  let out = "";
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      const next = body[i + 1];
      if (next === "n")
        out += "\n";
      else if (next === "t")
        out += "	";
      else if (next === "r")
        out += "\r";
      else
        out += next;
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

// src/chat-store.ts
var CHATS_FOLDER = "_agent/chats";
var SCRATCH_NOTE_PATH2 = "__ogstack_scratch__";
var MSG_DELIM_RX = /<!--\s*ogstack:msg\s+role=(user|assistant)\s+time=(\d+)\s*-->\r?\n?/g;
var TOOLS_BLOCK_RX = /^<!--\s*ogstack:tools\r?\n([\s\S]*?)\r?\n-->\r?\n?/;
var FM_RX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
var ChatStore = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.sessions = [];
    this.sessionPaths = /* @__PURE__ */ new Map();
    // sessionId -> file path
    this.listeners = /* @__PURE__ */ new Set();
  }
  async load() {
    await this.migrateFromDataJsonIfNeeded();
    await this.ensureChatsFolder();
    await this.scanFolder();
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  notify() {
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
      }
    }
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
    const path = this.buildFilePath(session);
    this.sessionPaths.set(session.id, path);
    await this.writeSessionFile(session, path);
    this.notify();
    return session;
  }
  async addMessage(sessionId, role, content, toolCalls) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session)
      throw new Error(`Session ${sessionId} not found`);
    const msg = {
      role,
      content,
      timestamp: Date.now(),
      ...toolCalls && toolCalls.length > 0 ? { toolCalls } : {}
    };
    session.messages.push(msg);
    session.updatedAt = Date.now();
    await this.writeSessionFile(session);
    this.notify();
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
      await this.writeSessionFile(session);
      this.notify();
    }
  }
  // Stick (or unstick) an agent skill on a session. Once stuck, free-text
  // follow-ups continue the agent loop with this skill until cleared or a new
  // skill is run.
  async setAgentSkill(sessionId, skillName) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session)
      return;
    if (session.agentSkillName === skillName)
      return;
    if (skillName)
      session.agentSkillName = skillName;
    else
      delete session.agentSkillName;
    session.updatedAt = Date.now();
    await this.writeSessionFile(session);
    this.notify();
  }
  async replaceSessionMessages(sessionId, messages) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session)
      return;
    session.messages = messages;
    session.updatedAt = Date.now();
    await this.writeSessionFile(session);
    this.notify();
  }
  async deleteSession(id) {
    const path = this.sessionPaths.get(id);
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.sessionPaths.delete(id);
    if (path) {
      try {
        const adapter = this.plugin.app.vault.adapter;
        if (await adapter.exists(path))
          await adapter.remove(path);
      } catch (err) {
        console.warn(`ogstack: could not delete chat file ${path}`, err);
      }
    }
    this.notify();
  }
  // ── File I/O ────────────────────────────────────────────────────
  async ensureChatsFolder() {
    const adapter = this.plugin.app.vault.adapter;
    if (!await adapter.exists("_agent")) {
      try {
        await adapter.mkdir("_agent");
      } catch (e) {
      }
    }
    if (!await adapter.exists(CHATS_FOLDER)) {
      try {
        await adapter.mkdir(CHATS_FOLDER);
      } catch (e) {
      }
    }
  }
  async scanFolder() {
    const adapter = this.plugin.app.vault.adapter;
    if (!await adapter.exists(CHATS_FOLDER))
      return;
    const listing = await adapter.list(CHATS_FOLDER);
    const mdFiles = listing.files.filter((f) => f.endsWith(".md"));
    const results = await Promise.allSettled(
      mdFiles.map(async (filePath) => ({ filePath, content: await adapter.read(filePath) }))
    );
    const loaded = [];
    for (const r of results) {
      if (r.status === "rejected") {
        console.warn("ogstack: could not read a chat file during scan", r.reason);
        continue;
      }
      const { filePath, content } = r.value;
      try {
        const session = parseChatFile(content);
        if (!session)
          continue;
        loaded.push(session);
        this.sessionPaths.set(session.id, filePath);
      } catch (err) {
        console.warn(`ogstack: could not parse chat file ${filePath}`, err);
      }
    }
    this.sessions = loaded;
  }
  buildFilePath(session) {
    const slug = session.notePath === SCRATCH_NOTE_PATH2 || !session.notePath ? "_scratch" : slugify(session.noteTitle || basename(session.notePath));
    return `${CHATS_FOLDER}/${slug}__${session.id}.md`;
  }
  async writeSessionFile(session, explicitPath) {
    var _a;
    const path = (_a = explicitPath != null ? explicitPath : this.sessionPaths.get(session.id)) != null ? _a : this.buildFilePath(session);
    this.sessionPaths.set(session.id, path);
    await this.ensureChatsFolder();
    await this.plugin.app.vault.adapter.write(path, serializeChat(session));
  }
  // ── Migration ──────────────────────────────────────────────────
  async migrateFromDataJsonIfNeeded() {
    const data = await this.plugin.loadData();
    const old = data == null ? void 0 : data.chatSessions;
    if (!old || !Array.isArray(old) || old.length === 0)
      return;
    await this.ensureChatsFolder();
    const adapter = this.plugin.app.vault.adapter;
    let migrated = 0;
    for (const session of old) {
      if (!(session == null ? void 0 : session.id))
        continue;
      const path = `${CHATS_FOLDER}/${session.notePath === SCRATCH_NOTE_PATH2 || !session.notePath ? "_scratch" : slugify(session.noteTitle || basename(session.notePath))}__${session.id}.md`;
      try {
        if (await adapter.exists(path))
          continue;
        await adapter.write(path, serializeChat(session));
        migrated++;
      } catch (err) {
        console.warn(`ogstack: failed migrating session ${session.id}`, err);
      }
    }
    const rest = { ...data != null ? data : {} };
    delete rest.chatSessions;
    await this.plugin.saveData(rest);
    if (migrated > 0) {
      console.log(`ogstack: migrated ${migrated} chat session(s) to ${CHATS_FOLDER}/`);
    }
  }
};
function serializeChat(session) {
  const fmLines = [
    "---",
    "ogstack: chat",
    `id: ${session.id}`,
    `notePath: ${yamlScalar(session.notePath)}`,
    `noteTitle: ${yamlScalar(session.noteTitle)}`,
    `createdAt: ${session.createdAt}`,
    `updatedAt: ${session.updatedAt}`,
    ...session.agentSkillName ? [`agentSkillName: ${yamlScalar(session.agentSkillName)}`] : [],
    "---",
    ""
  ];
  const body = session.messages.map((m) => {
    const header = `<!-- ogstack:msg role=${m.role} time=${m.timestamp} -->
`;
    const tools = m.toolCalls && m.toolCalls.length > 0 ? `<!-- ogstack:tools
${JSON.stringify(m.toolCalls)}
-->
` : "";
    return `${header}${tools}${m.content}
`;
  }).join("\n");
  return fmLines.join("\n") + body;
}
function parseChatFile(content) {
  var _a, _b, _c;
  const fmMatch = content.match(FM_RX);
  if (!fmMatch)
    return null;
  const fmText = fmMatch[1];
  const body = fmMatch[2];
  if (!/^\s*ogstack:\s*chat\s*$/m.test(fmText))
    return null;
  const fm = parseYamlFrontmatter(fmText);
  if (!fm || !fm.id)
    return null;
  const parts = body.split(MSG_DELIM_RX);
  const messages = [];
  for (let i = 1; i + 2 < parts.length || i + 1 < parts.length; i += 3) {
    const role = parts[i];
    const time = parseInt(parts[i + 1], 10);
    let msgBody = ((_a = parts[i + 2]) != null ? _a : "").replace(/[\r\n]+$/, "");
    if (role !== "user" && role !== "assistant")
      continue;
    let toolCalls;
    const toolsMatch = msgBody.match(TOOLS_BLOCK_RX);
    if (toolsMatch) {
      try {
        const parsed = JSON.parse(toolsMatch[1]);
        if (Array.isArray(parsed))
          toolCalls = parsed;
      } catch (e) {
      }
      msgBody = msgBody.slice(toolsMatch[0].length);
    }
    messages.push({
      role,
      content: msgBody,
      timestamp: isNaN(time) ? Date.now() : time,
      ...toolCalls ? { toolCalls } : {}
    });
    if (i + 2 >= parts.length)
      break;
  }
  return {
    id: fm.id,
    notePath: (_b = fm.notePath) != null ? _b : "",
    noteTitle: (_c = fm.noteTitle) != null ? _c : "",
    createdAt: parseInt(fm.createdAt, 10) || Date.now(),
    updatedAt: parseInt(fm.updatedAt, 10) || Date.now(),
    messages,
    ...fm.agentSkillName ? { agentSkillName: fm.agentSkillName } : {}
  };
}
function yamlScalar(s) {
  if (s === "")
    return '""';
  if (/[:#"'\n\r]|^[\s\-?!&*|>%@`]|\s$/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}
function slugify(name) {
  const s = name.toLowerCase().replace(/\.md$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "untitled";
}
function basename(path) {
  var _a;
  const last = (_a = path.split("/").pop()) != null ? _a : path;
  return last.replace(/\.md$/, "");
}

// src/settings.ts
var import_obsidian4 = require("obsidian");
var DEFAULT_SETTINGS = {
  provider: "claude",
  apiKey: "",
  model: "",
  ollamaHost: "http://localhost:11434",
  maxTokens: 6e3,
  outputMode: "inline",
  scoutEnabled: true,
  scoutModel: "gemini-2.0-flash-lite",
  scoutProvider: "inherit",
  scoutApiKey: "",
  scoutCliPath: "",
  scoutOllamaHost: "http://localhost:11434",
  contextDecayDays: 14,
  compactionThreshold: 8e3,
  cliPath: "",
  allowAgentWrites: false
};
var PROVIDER_LABELS = {
  claude: "Claude (API key)",
  openai: "OpenAI (API key)",
  gemini: "Gemini (API key)",
  grok: "Grok / xAI (API key)",
  ollama: "Ollama (local)",
  "claude-cli": "Claude Code CLI (subscription)",
  "codex-cli": "Codex CLI (subscription)",
  "gemini-cli": "Gemini CLI (subscription)"
};
var API_KEY_LINKS = {
  claude: "Get your key at anthropic.com/api",
  openai: "Get your key at platform.openai.com/api-keys",
  gemini: "Get your key at aistudio.google.com",
  grok: "Get your key at x.ai (xAI console)",
  ollama: "No API key needed for local models.",
  "claude-cli": "Uses your Claude Code CLI auth (run `claude login` in terminal first).",
  "codex-cli": "Uses your Codex CLI auth (run `codex login` in terminal first).",
  "gemini-cli": "Uses your Gemini CLI auth (run `gemini auth` in terminal first)."
};
var MODEL_PLACEHOLDERS = {
  claude: "claude-sonnet-4-6",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
  grok: "grok-2-latest",
  ollama: "llama3.2",
  "claude-cli": "sonnet",
  "codex-cli": "gpt-5",
  "gemini-cli": "gemini-2.5-pro"
};
function isCliProvider(p) {
  return p === "claude-cli" || p === "codex-cli" || p === "gemini-cli";
}
function isApiKeyProvider(p) {
  return p === "claude" || p === "openai" || p === "gemini" || p === "grok";
}
var GStackSettingTab = class extends import_obsidian4.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian4.Setting(containerEl).setName("Provider").setHeading();
    const providerSetting = new import_obsidian4.Setting(containerEl).setName("AI provider").setDesc("Which AI service runs your skills.");
    let apiKeySetting;
    let apiKeyDisclaimerEl;
    let apiKeyTextField = null;
    let ollamaHostSetting;
    let cliPathSetting;
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
          ollamaHostSetting,
          cliPathSetting
        );
        if (apiKeyTextField) {
          apiKeySetting.setDesc(API_KEY_LINKS[value]);
        }
        const placeholder = MODEL_PLACEHOLDERS[value];
        modelTextField == null ? void 0 : modelTextField.setPlaceholder(`Default (${placeholder})`);
      });
    });
    apiKeySetting = new import_obsidian4.Setting(containerEl).setName("API key").setDesc(API_KEY_LINKS[this.plugin.settings.provider]);
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
      text: "\u26A0 Security notice: API keys are stored in plaintext at .obsidian/plugins/ogstack/data.json inside your vault. Obsidian Sync excludes plugin data by default, but third-party sync (Git, Dropbox, iCloud, etc.) will carry the key \u2014 exclude this file if you share the vault."
    });
    const modelSetting = new import_obsidian4.Setting(containerEl).setName("Model").setDesc(
      `Leave blank for provider default (${MODEL_PLACEHOLDERS[this.plugin.settings.provider]}).`
    );
    modelSetting.addText((text) => {
      modelTextField = text;
      text.setPlaceholder(`Default (${MODEL_PLACEHOLDERS[this.plugin.settings.provider]})`).setValue(this.plugin.settings.model);
      text.onChange(async (value) => {
        const trimmed = value.trim();
        if (!isSafeModelName(trimmed)) {
          modelSetting.setDesc("Model name rejected \u2014 allowed characters: letters, digits, ._:-/");
          modelSetting.settingEl.classList.add("mod-warning");
          return;
        }
        modelSetting.setDesc(`Leave blank for provider default (${MODEL_PLACEHOLDERS[this.plugin.settings.provider]}).`);
        modelSetting.settingEl.classList.remove("mod-warning");
        this.plugin.settings.model = trimmed;
        await this.plugin.saveSettings();
      });
    });
    ollamaHostSetting = new import_obsidian4.Setting(containerEl).setName("Ollama host").setDesc(
      "URL of your local Ollama server. Streams tokens as the model generates."
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
          "URL of your local Ollama server. Streams tokens as the model generates."
        );
        ollamaHostSetting.settingEl.classList.remove("mod-warning");
        this.plugin.settings.ollamaHost = val;
        await this.plugin.saveSettings();
      });
    });
    const testSetting = new import_obsidian4.Setting(containerEl).setName("Test connection").setDesc("Send a short ping through the configured provider to verify credentials and reachability.");
    const testResult = containerEl.createEl("p", { cls: "gstack-test-connection-result" });
    testSetting.addButton((btn) => {
      btn.setButtonText("Test").onClick(async () => {
        var _a, _b, _c, _d;
        btn.setDisabled(true);
        testResult.textContent = "Testing\u2026";
        testResult.className = "gstack-test-connection-result";
        try {
          const adapter = this.app.vault.adapter;
          const cwd = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : adapter.basePath;
          const provider = getProvider(this.plugin.settings, cwd);
          const stream = provider.stream({ systemPrompt: "Reply with only the word 'pong'.", userMessage: "ping" });
          let sawAnything = false;
          for await (const _token of stream) {
            sawAnything = true;
            break;
          }
          if (sawAnything) {
            testResult.textContent = "\u2713 Connection OK \u2014 provider responded.";
            testResult.className = "gstack-test-connection-result gstack-test-connection-ok";
          } else {
            testResult.textContent = "\u26A0 Connected but no tokens streamed back. Check the model name.";
            testResult.className = "gstack-test-connection-result gstack-test-connection-warn";
          }
        } catch (err) {
          const e = err;
          const detail = e.status === 401 ? "invalid API key" : e.status === 0 || !e.status ? (_b = (_a = e.body) != null ? _a : e.message) != null ? _b : "could not reach provider" : `HTTP ${e.status} \u2014 ${(_d = (_c = e.body) != null ? _c : e.message) != null ? _d : ""}`;
          testResult.textContent = `\u2715 ${detail}`;
          testResult.className = "gstack-test-connection-result gstack-test-connection-err";
        } finally {
          btn.setDisabled(false);
        }
      });
    });
    cliPathSetting = new import_obsidian4.Setting(containerEl).setName("CLI binary path").setDesc("Optional. Leave blank to use the system PATH (recommended). Override only if the CLI is installed in a non-standard location. Spaces and shell metacharacters are not allowed.");
    cliPathSetting.addText((text) => {
      text.setPlaceholder("auto-detect from PATH").setValue(this.plugin.settings.cliPath).onChange(async (value) => {
        const trimmed = value.trim();
        if (!isSafeCliPath(trimmed)) {
          cliPathSetting.setDesc("Path rejected \u2014 contains spaces or shell metacharacters. Move the binary somewhere safe, or use PATH.");
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
    new import_obsidian4.Setting(containerEl).setName("Context").setHeading();
    const maxTokensSetting = new import_obsidian4.Setting(containerEl).setName("Token budget").setDesc(
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
    new import_obsidian4.Setting(containerEl).setName("Context Scout").setDesc(
      "Before the main model runs, a fast small model scores each candidate note's relevance \u2014 keeping stale or off-topic notes out of context. Recommended on."
    ).addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.scoutEnabled).onChange(async (value) => {
        this.plugin.settings.scoutEnabled = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian4.Setting(containerEl).setName("Scout model").setDesc("The model used for relevance scoring. gemini-2.0-flash-lite is recommended (low cost, 8s timeout).").addText((text) => {
      text.setPlaceholder("gemini-2.0-flash-lite").setValue(this.plugin.settings.scoutModel).onChange(async (value) => {
        this.plugin.settings.scoutModel = value;
        await this.plugin.saveSettings();
      });
    });
    let scoutApiKeySetting;
    let scoutCliPathSetting;
    let scoutOllamaSetting;
    new import_obsidian4.Setting(containerEl).setName("Scout provider").setDesc(`Which provider runs the scout. Use "Inherit" to reuse your main provider's credentials, or pick a separate one (e.g. cheap Gemini key) when the main provider is a CLI.`).addDropdown((dd) => {
      dd.addOption("inherit", "Inherit from main provider");
      for (const [value, label] of Object.entries(PROVIDER_LABELS)) {
        dd.addOption(value, label);
      }
      dd.setValue(this.plugin.settings.scoutProvider);
      dd.onChange(async (value) => {
        this.plugin.settings.scoutProvider = value;
        await this.plugin.saveSettings();
        this.updateScoutUI(
          this.plugin.settings.scoutProvider,
          scoutApiKeySetting,
          scoutCliPathSetting,
          scoutOllamaSetting
        );
      });
    });
    scoutApiKeySetting = new import_obsidian4.Setting(containerEl).setName("Scout API key").setDesc("API key for the scout provider (only when scout uses a different provider than main).").addText((text) => {
      text.setPlaceholder("Paste scout API key").setValue(this.plugin.settings.scoutApiKey);
      text.inputEl.type = "password";
      text.onChange(async (value) => {
        this.plugin.settings.scoutApiKey = value;
        await this.plugin.saveSettings();
      });
    });
    scoutCliPathSetting = new import_obsidian4.Setting(containerEl).setName("Scout CLI path").setDesc("Optional CLI binary path for scout. Leave blank to use PATH.").addText((text) => {
      text.setPlaceholder("auto-detect from PATH").setValue(this.plugin.settings.scoutCliPath).onChange(async (value) => {
        this.plugin.settings.scoutCliPath = value.trim();
        await this.plugin.saveSettings();
      });
    });
    scoutOllamaSetting = new import_obsidian4.Setting(containerEl).setName("Scout Ollama host").setDesc("Ollama URL for scout, if scout uses Ollama.").addText((text) => {
      text.setPlaceholder("http://localhost:11434").setValue(this.plugin.settings.scoutOllamaHost).onChange(async (value) => {
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
    const decaySetting = new import_obsidian4.Setting(containerEl).setName("Context decay").setDesc("Notes older than this many days are down-scored when assembling context.");
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
    new import_obsidian4.Setting(containerEl).setName("Output").setHeading();
    new import_obsidian4.Setting(containerEl).setName("Default output mode").setDesc(
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
    new import_obsidian4.Setting(containerEl).setName("Agent safety").setHeading();
    new import_obsidian4.Setting(containerEl).setName("Allow agent file writes").setDesc(
      "When ON, agent skills (mode: agent) can call write_note and append_note to create or overwrite notes. When OFF (default), those tools return an error and the agent reports back without writing. Recommended OFF \u2014 a prompt-injected agent should not silently modify your vault."
    ).addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.allowAgentWrites).onChange(async (value) => {
        this.plugin.settings.allowAgentWrites = value;
        await this.plugin.saveSettings();
      });
    });
  }
  updateProviderUI(provider, apiKeySetting, disclaimerEl, ollamaHostSetting, cliPathSetting) {
    const showApiKey = isApiKeyProvider(provider);
    const showOllama = provider === "ollama";
    const showCli = isCliProvider(provider);
    apiKeySetting.settingEl.classList.toggle("gstack-hidden", !showApiKey);
    disclaimerEl.classList.toggle("gstack-hidden", !showApiKey);
    ollamaHostSetting.settingEl.classList.toggle("gstack-hidden", !showOllama);
    cliPathSetting.settingEl.classList.toggle("gstack-hidden", !showCli);
  }
  updateScoutUI(scoutProvider, apiKeySetting, cliPathSetting, ollamaSetting) {
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
};

// src/sidebar-view.ts
var import_obsidian5 = require("obsidian");
var SIDEBAR_VIEW_TYPE = "ogstack-sidebar";
var OgstackSidebarView = class extends import_obsidian5.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.screen = { name: "sessions" };
    this.storeUnsubscribe = null;
    // Tick once per minute to refresh "5m ago"-style timestamps. Without this,
    // a long-open sidebar shows stale relative times.
    this.relativeTimeInterval = null;
    this.embeddedBar = null;
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
    this.storeUnsubscribe = this.plugin.chatStore.onChange(() => {
      if (this.screen.name === "sessions")
        this.render();
    });
    this.relativeTimeInterval = setInterval(() => {
      if (this.screen.name !== "sessions")
        return;
      const root = this.containerEl.children[1];
      if (!root)
        return;
      const sessions = this.plugin.chatStore.getSessions();
      const sessionsById = new Map(sessions.map((s) => [s.id, s]));
      root.querySelectorAll(".gstack-session-item").forEach((item) => {
        const sessionId = item.getAttribute("data-session-id");
        const s = sessionId ? sessionsById.get(sessionId) : null;
        const timeEl = item.querySelector(".gstack-session-time");
        if (s && timeEl)
          timeEl.textContent = relativeTime(s.updatedAt);
      });
    }, 6e4);
    await this.render();
  }
  async render() {
    const root = this.containerEl.children[1];
    this.teardownEmbeddedBar();
    root.empty();
    root.className = "gstack-chat";
    if (this.screen.name === "sessions") {
      this.renderSessionsScreen(root);
    } else {
      this.renderChatScreen(root, this.screen.sessionId);
    }
  }
  teardownEmbeddedBar() {
    if (this.embeddedBar) {
      this.embeddedBar.destroy();
      this.embeddedBar = null;
    }
  }
  // ── Sessions screen ──────────────────────────────────────────
  renderSessionsScreen(root) {
    const header = root.createDiv({ cls: "gstack-chat-header" });
    header.createEl("span", { text: "ogstack", cls: "gstack-chat-title" });
    const newBtn = header.createEl("button", { cls: "gstack-chat-icon-btn", text: "+" });
    newBtn.title = "New chat for active note";
    newBtn.setAttribute("aria-label", "Start new chat for active note");
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
    item.setAttribute("data-session-id", session.id);
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.setAttribute("aria-label", `Open chat: ${session.noteTitle || "Untitled"}`);
    const info = item.createDiv({ cls: "gstack-session-info" });
    info.createEl("div", { text: session.noteTitle || "Untitled", cls: "gstack-session-title" });
    const last = session.messages[session.messages.length - 1];
    const preview = last ? last.content.slice(0, 72) + (last.content.length > 72 ? "\u2026" : "") : "No messages yet";
    info.createEl("div", { text: preview, cls: "gstack-session-preview" });
    const meta = item.createDiv({ cls: "gstack-session-meta" });
    meta.createEl("span", { text: relativeTime(session.updatedAt), cls: "gstack-session-time" });
    const del = meta.createEl("button", { cls: "gstack-session-del" });
    (0, import_obsidian5.setIcon)(del, "trash-2");
    del.title = "Delete chat";
    del.setAttribute("aria-label", `Delete chat: ${session.noteTitle || "Untitled"}`);
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete chat "${session.noteTitle || "Untitled"}"? This cannot be undone.`))
        return;
      await this.plugin.chatStore.deleteSession(session.id);
      this.render();
    });
    const open = () => {
      this.screen = { name: "chat", sessionId: session.id };
      this.render();
    };
    item.addEventListener("click", open);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  }
  // ── Chat screen (BarChat host) ───────────────────────────────
  renderChatScreen(root, sessionId) {
    const session = this.plugin.chatStore.getSession(sessionId);
    if (!session) {
      this.screen = { name: "sessions" };
      this.renderSessionsScreen(root);
      return;
    }
    const hostEl = root.createDiv({ cls: "gstack-sidebar-bar-host" });
    this.embeddedBar = new BarChat({
      app: this.plugin.app,
      settings: this.plugin.settings,
      getSkills: () => this.plugin.getSkills(),
      chatStore: this.plugin.chatStore,
      host: hostEl,
      followActiveLeaf: false,
      onClose: () => {
        this.screen = { name: "sessions" };
        this.render();
      }
    });
    void this.embeddedBar.setSession(sessionId);
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
    var _a;
    this.teardownEmbeddedBar();
    (_a = this.storeUnsubscribe) == null ? void 0 : _a.call(this);
    this.storeUnsubscribe = null;
    if (this.relativeTimeInterval) {
      clearInterval(this.relativeTimeInterval);
      this.relativeTimeInterval = null;
    }
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
var import_obsidian6 = require("obsidian");

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
  },
  {
    name: "vault-agent",
    content: `---
name: vault-agent
description: Agent that explores and edits your vault using tools (Claude API only)
agent: true
allowed_tools: [list_notes, read_note, search_vault, get_active_note, append_note, write_note]
max_rounds: 15
---

You are a vault research and editing agent. You have tools to list, read, search, append to,
and write notes in the user's Obsidian vault. The user's active note is NOT preloaded into
your context \u2014 call get_active_note when you need it.

When the user asks a question:
1. Decide which tools you need. Prefer searching and reading over guessing.
2. Use tools one or more times to gather grounded information.
3. Synthesize a clear, concise answer citing the note paths you used.

When the user asks for edits:
1. Read the relevant notes first so you don't overwrite blindly.
2. Use append_note for additive changes; only use write_note when fully replacing a file.
3. Confirm what you changed and where, at the end.

Rules:
- Only use facts present in the notes. Never invent vault content.
- Stop calling tools as soon as you have enough to answer.
- Keep your final answer focused \u2014 no recap of every tool call.
- If write_note or append_note returns "agent file writes are disabled", do NOT retry. Tell the user the setting is off (Settings \u2192 ogstack \u2192 Agent safety) and offer the proposed change as a markdown block they can paste themselves.
- If a tool result ends with "[truncated: \u2026]", the file or list is larger than the cap. Ask a more specific question rather than reading the same path repeatedly.`
  },
  {
    name: "summarize",
    content: `---
name: summarize
description: One-paragraph distillation of the active note
output: inline
max_depth: 1
max_tokens: 3000
---

You are a precise summarizer. Distill the active note into a single dense paragraph
of 3-5 sentences that captures:

- What this note is about (one sentence).
- The key claims, findings, or decisions.
- Any open questions or next steps the note flags.

Rules:
- One paragraph. No bullet lists. No headings.
- Drop preamble like "This note is about\u2026" \u2014 just give the content.
- Stay grounded \u2014 do not invent facts not present in the note.

{{VAULT_CONTEXT}}`
  },
  {
    name: "plan-interactive",
    content: `---
name: plan-interactive
description: Project plan with clarifying questions if scope is ambiguous
output: inline
mode: interactive
max_depth: 3
max_tokens: 6000
---

You are a senior project manager. The user's planning notes are provided below.

Before producing the plan, scan the notes for ambiguity. If the goal, timeline,
team size, success criteria, or scope is unclear, ask 1-3 clarifying questions
wrapped in <ASK>question text</ASK> tags. The user will answer and you'll continue.
Skip the ASK step entirely if the notes are clear.

Once you have what you need, output:

**Goal & Success Criteria**
What does done look like? Concrete and measurable.

**Scope**
In scope \xB7 out of scope.

**Milestones**
3-7 milestones with deliverables.

**Task Breakdown**
For each milestone, the key atomic tasks.

**Dependencies & Risks**
Sequence dependencies + named risks with one mitigation each.

**Open Questions**
What still needs answering before kickoff.

Rules:
- Ground every milestone in actual notes content.
- No generic PM boilerplate.
- Estimates only if the notes contain timeline info.

{{VAULT_CONTEXT}}`
  }
];

// src/skill-loader.ts
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match)
    return null;
  const parsed = parseYamlFrontmatter(match[1]);
  if (!parsed)
    return null;
  const fm = {};
  const known = [
    "name",
    "description",
    "output",
    "max_depth",
    "max_tokens",
    "mode",
    "auto_insert",
    "agent",
    "allowed_tools",
    "max_rounds"
  ];
  const aliases = {
    "allowed-tools": "allowed_tools",
    "max-rounds": "max_rounds",
    "max-tokens": "max_tokens",
    "max-depth": "max_depth",
    "auto-insert": "auto_insert"
  };
  for (const k of known) {
    if (k in parsed)
      fm[k] = parsed[k];
  }
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (alias in parsed && !(canonical in fm)) {
      fm[canonical] = parsed[alias];
    }
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
  const mode = fm.mode === "interactive" ? "interactive" : "oneshot";
  const autoInsert = fm.auto_insert === "true";
  const agent = fm.agent === "true";
  const allowedTools = parseAllowedTools(fm.allowed_tools);
  const maxRoundsRaw = fm.max_rounds ? parseInt(fm.max_rounds, 10) : NaN;
  const maxRounds = !isNaN(maxRoundsRaw) && maxRoundsRaw > 0 ? Math.min(maxRoundsRaw, 40) : null;
  return {
    name: fm.name,
    description: fm.description,
    output,
    maxDepth: isNaN(maxDepth) ? 3 : maxDepth,
    maxTokens: maxTokens !== null && !isNaN(maxTokens) ? maxTokens : null,
    systemPrompt: body,
    mode,
    autoInsert,
    agent,
    allowedTools,
    maxRounds
  };
}
function parseAllowedTools(raw) {
  if (!raw)
    return null;
  const stripped = raw.trim().replace(/^\[|\]$/g, "");
  if (!stripped)
    return null;
  const tools = stripped.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  return tools.length > 0 ? tools : null;
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
  function registerSkill(skill, isBuiltin, sourcePath) {
    if (!isBuiltin && builtinNames.has(skill.name)) {
      const where = sourcePath ? ` (from ${sourcePath})` : "";
      new import_obsidian6.Notice(
        `ogstack: custom skill "${skill.name}"${where} conflicts with a built-in skill \u2014 rename it in the SKILL.md frontmatter`
      );
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
          registerSkill(skill, false, filePath);
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
          registerSkill(skill, false, skillFilePath);
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

// src/skill-runner.ts
var import_obsidian8 = require("obsidian");

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
var import_obsidian7 = require("obsidian");
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
    new import_obsidian7.Notice("gstack: open a note first");
    return;
  }
  let cursor = editor.getCursor();
  try {
    for await (const token of tokens) {
      const currentEditor = getEditor();
      if (!currentEditor) {
        new import_obsidian7.Notice("gstack: output interrupted \u2014 note was closed");
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
    new import_obsidian7.Notice("gstack: output interrupted \u2014 note was closed");
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
    new import_obsidian7.Notice(`gstack: could not create output note \u2014 ${msg}`);
    return;
  }
  const leaf = app.workspace.getLeaf("split");
  const typedLeaf = leaf;
  await typedLeaf.openFile(file);
  const editor = (_c = (_a = typedLeaf.view) == null ? void 0 : _a.editor) != null ? _c : (_b = app.workspace.getActiveViewOfType(import_obsidian7.MarkdownView)) == null ? void 0 : _b.editor;
  if (!editor) {
    new import_obsidian7.Notice("gstack: could not open output note editor");
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
    new import_obsidian7.Notice("gstack: output interrupted \u2014 note was closed");
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
    new import_obsidian8.Notice("ogstack: open a note first");
    return;
  }
  const outputMode = (_a = skill.output) != null ? _a : settings.outputMode;
  if (outputMode === "inline") {
    if (inlineMutex.get(activeFile.path)) {
      new import_obsidian8.Notice(`ogstack: ${skill.name} is already running on this note`);
      return;
    }
    inlineMutex.set(activeFile.path, true);
  }
  if (!settings.apiKey && settings.provider !== "ollama") {
    if (outputMode === "inline")
      inlineMutex.delete(activeFile.path);
    new import_obsidian8.Notice("ogstack: add your API key in Settings \u2192 ogstack");
    return;
  }
  const bar = reporter != null ? reporter : new FloatingInput({ mode: "progress" });
  try {
    let getEditor = function() {
      var _a2;
      const view = app.workspace.getActiveViewOfType(import_obsidian8.MarkdownView);
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
    const adapter = app.vault.adapter;
    const cwd = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : adapter.basePath;
    const provider = getProvider(settings, cwd);
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

// src/welcome-modal.ts
var import_obsidian9 = require("obsidian");
var WelcomeModal = class extends import_obsidian9.Modal {
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
          "Drop a SKILL.md file into _agent/your-skill/ inside your vault (or use the flat form _agent/your-skill.md).",
          "It registers as a live /command within 2 seconds \u2014 no restart needed.",
          "Or import skills from a GitHub repo via Command Palette \u2192 'ogstack: Import skill from GitHub'."
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
var import_obsidian10 = require("obsidian");
var AGENT_FOLDER = "_agent";
var SKILL_NAME_RX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/;
function isSafeSkillName(name) {
  if (typeof name !== "string")
    return false;
  if (!SKILL_NAME_RX.test(name))
    return false;
  if (name === "." || name === "..")
    return false;
  return true;
}
var SKIP_BASENAMES = /* @__PURE__ */ new Set([
  "readme",
  "license",
  "licence",
  "contributing",
  "changelog",
  "code_of_conduct",
  "security",
  "support",
  "authors",
  "notice",
  "history",
  "todo",
  "roadmap"
]);
function githubUrlToRaw(url) {
  const blobMatch = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/);
  if (blobMatch)
    return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}`;
  if (url.startsWith("https://raw.githubusercontent.com/"))
    return url;
  return null;
}
function repoOwnerFromUrl(url) {
  const m = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:[/?#]|$)/);
  if (!m)
    return null;
  return m[1];
}
function classifyGithubUrl(url) {
  if (!url)
    return "unknown";
  if (githubUrlToRaw(url))
    return "file";
  if (repoOwnerFromUrl(url))
    return "repo";
  return "unknown";
}
function isLikelySkillPath(path) {
  const filename = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const basename2 = filename.replace(/\.md$/, "");
  if (SKIP_BASENAMES.has(basename2))
    return false;
  if (filename === "skill.md")
    return true;
  return filename.endsWith(".md");
}
var ImportSkillModal = class extends import_obsidian10.Modal {
  constructor(app, onImported) {
    super(app);
    this.onImported = onImported;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("gstack-import-modal");
    contentEl.createEl("h2", { text: "Import skills" });
    contentEl.createEl("p", {
      text: "Paste a GitHub repo URL to scan and pick skills, a single-file URL (\u2026/blob/\u2026) to import one skill directly, or use the local picker to upload SKILL.md files from disk.",
      cls: "gstack-import-desc"
    });
    const urlInput = contentEl.createEl("input", {
      cls: "gstack-import-url",
      attr: { type: "text", placeholder: "https://github.com/user/repo  or  \u2026/blob/main/skill.md" }
    });
    const status = contentEl.createEl("p", { cls: "gstack-import-status" });
    const previewEl = contentEl.createEl("div", { cls: "gstack-import-preview" });
    const btnRow = contentEl.createEl("div", { cls: "gstack-import-btn-row" });
    const btnImport = btnRow.createEl("button", { text: "Import", cls: "gstack-import-btn mod-cta" });
    const btnPickFiles = btnRow.createEl("button", { text: "Import local files\u2026", cls: "gstack-import-btn" });
    btnPickFiles.title = "Pick one or more SKILL.md files from disk";
    const fileInput = btnRow.createEl("input", {
      attr: { type: "file", multiple: "true", accept: ".md,text/markdown" },
      cls: "gstack-hidden"
    });
    btnPickFiles.addEventListener("click", () => fileInput.click());
    const setStatus = (msg) => {
      status.textContent = msg;
    };
    const updateBtnLabel = () => {
      const kind = classifyGithubUrl(urlInput.value.trim());
      btnImport.textContent = kind === "file" ? "Import this file" : kind === "repo" ? "Scan repo for skills" : "Import";
    };
    urlInput.addEventListener("input", updateBtnLabel);
    fileInput.addEventListener("change", async () => {
      var _a;
      const files = Array.from((_a = fileInput.files) != null ? _a : []);
      if (files.length === 0)
        return;
      btnImport.disabled = true;
      btnPickFiles.disabled = true;
      previewEl.empty();
      setStatus(`Reading ${files.length} file${files.length === 1 ? "" : "s"}\u2026`);
      try {
        const imported = await this.importLocalFiles(files);
        if (imported.ok === 0 && imported.errors.length > 0) {
          setStatus(`No skills imported. ${imported.errors[0]}`);
        } else {
          const tail = imported.errors.length > 0 ? ` \xB7 ${imported.errors.length} skipped` : "";
          setStatus(`\u2713 Imported ${imported.ok} skill${imported.ok === 1 ? "" : "s"} \u2192 ${AGENT_FOLDER}/${tail}`);
          this.onImported();
          if (imported.errors.length === 0)
            setTimeout(() => this.close(), 1800);
        }
        if (imported.errors.length > 0) {
          const errList = previewEl.createDiv({ cls: "gstack-import-error-list" });
          errList.createEl("div", { text: "Skipped files:", cls: "gstack-import-error-header" });
          for (const e of imported.errors)
            errList.createEl("div", { text: `\u2022 ${e}`, cls: "gstack-import-error-item" });
        }
      } finally {
        btnImport.disabled = false;
        btnPickFiles.disabled = false;
        fileInput.value = "";
      }
    });
    btnImport.addEventListener("click", async () => {
      const url = urlInput.value.trim();
      if (!url) {
        setStatus("Paste a GitHub URL first.");
        return;
      }
      const kind = classifyGithubUrl(url);
      if (kind === "unknown") {
        setStatus("Error: Not a recognized GitHub URL. Expected https://github.com/owner/repo or \u2026/blob/branch/path.md");
        return;
      }
      btnImport.disabled = true;
      previewEl.empty();
      if (kind === "file") {
        setStatus("Fetching\u2026");
        try {
          const name = await this.importFile(url);
          setStatus(`\u2713 Imported "${name}" \u2192 ${AGENT_FOLDER}/${name}.md`);
          this.onImported();
          setTimeout(() => this.close(), 1800);
        } catch (e) {
          setStatus(`Error: ${e.message}`);
          btnImport.disabled = false;
        }
        return;
      }
      setStatus("Fetching repo tree\u2026");
      try {
        const skills = await this.scanRepo(url, setStatus);
        if (skills.length === 0) {
          setStatus("No valid skill files found (looked for .md files with name + description frontmatter).");
          btnImport.disabled = false;
          return;
        }
        setStatus(`Found ${skills.length} skill${skills.length === 1 ? "" : "s"} \u2014 select which to import:`);
        this.renderPreview(previewEl, skills, setStatus);
      } catch (e) {
        setStatus(`Error: ${e.message}`);
        btnImport.disabled = false;
      }
    });
  }
  renderPreview(container, skills, setStatus) {
    container.empty();
    const selected = new Set(skills.map((s) => s.name));
    const list = container.createDiv({ cls: "gstack-import-list" });
    for (const skill of skills) {
      const row = list.createDiv({ cls: "gstack-import-item" });
      const checkbox = row.createEl("input", { attr: { type: "checkbox" }, cls: "gstack-import-check" });
      checkbox.checked = true;
      const info = row.createDiv({ cls: "gstack-import-item-info" });
      info.createEl("div", { text: skill.name, cls: "gstack-import-item-name" });
      info.createEl("div", { text: skill.description, cls: "gstack-import-item-desc" });
      info.createEl("div", { text: skill.path, cls: "gstack-import-item-path" });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked)
          selected.add(skill.name);
        else
          selected.delete(skill.name);
      });
    }
    const actions = container.createDiv({ cls: "gstack-import-actions" });
    const importBtn = actions.createEl("button", {
      text: `Import selected (${skills.length})`,
      cls: "gstack-import-btn mod-cta"
    });
    importBtn.addEventListener("click", async () => {
      importBtn.disabled = true;
      const toImport = skills.filter((s) => selected.has(s.name));
      setStatus(`Importing ${toImport.length}\u2026`);
      await this.ensureAgentFolder();
      let count = 0;
      let rejected = 0;
      for (const sk of toImport) {
        if (!isSafeSkillName(sk.name)) {
          rejected++;
          continue;
        }
        try {
          await this.app.vault.adapter.write(`${AGENT_FOLDER}/${sk.name}.md`, sk.rawContent);
          count++;
        } catch (e) {
        }
      }
      const tail = rejected > 0 ? ` (${rejected} rejected \u2014 unsafe name)` : "";
      setStatus(`\u2713 Imported ${count} skill${count === 1 ? "" : "s"} into ${AGENT_FOLDER}/${tail}`);
      this.onImported();
      setTimeout(() => this.close(), 1800);
    });
  }
  async ensureAgentFolder() {
    if (!await this.app.vault.adapter.exists(AGENT_FOLDER)) {
      await this.app.vault.adapter.mkdir(AGENT_FOLDER);
    }
  }
  // Read SKILL.md files the user picked from disk, parse each, and copy into
  // _agent/. Returns counts so the caller can render a useful status line.
  async importLocalFiles(files) {
    await this.ensureAgentFolder();
    let ok = 0;
    const errors = [];
    for (const file of files) {
      try {
        const text = await file.text();
        const skill = parseSKILL(text, file.name);
        if (!skill) {
          errors.push(`${file.name} \u2014 missing required \`name\` / \`description\` frontmatter`);
          continue;
        }
        if (!isSafeSkillName(skill.name)) {
          errors.push(`${file.name} \u2014 unsafe skill name "${skill.name}"`);
          continue;
        }
        await this.app.vault.adapter.write(`${AGENT_FOLDER}/${skill.name}.md`, text);
        ok++;
      } catch (e) {
        errors.push(`${file.name} \u2014 ${e.message}`);
      }
    }
    return { ok, errors };
  }
  async importFile(url) {
    const rawUrl = githubUrlToRaw(url);
    if (!rawUrl)
      throw new Error("Not a recognized GitHub URL");
    const res = await (0, import_obsidian10.requestUrl)({ url: rawUrl });
    if (res.status !== 200)
      throw new Error(`HTTP ${res.status}`);
    const content = res.text;
    const skill = parseSKILL(content, rawUrl);
    if (!skill)
      throw new Error("File has no valid skill frontmatter (name + description required)");
    if (!isSafeSkillName(skill.name)) {
      throw new Error(
        `Skill name "${skill.name}" is unsafe \u2014 must match [a-zA-Z0-9_-], 1-40 chars, no slashes or dots.`
      );
    }
    await this.ensureAgentFolder();
    await this.app.vault.adapter.write(`${AGENT_FOLDER}/${skill.name}.md`, content);
    return skill.name;
  }
  async scanRepo(repoUrl, setStatus) {
    var _a, _b, _c;
    const ownerRepo = repoOwnerFromUrl(repoUrl);
    if (!ownerRepo)
      throw new Error("Not a GitHub repo URL");
    let repoRes;
    try {
      repoRes = await (0, import_obsidian10.requestUrl)({ url: `https://api.github.com/repos/${ownerRepo}` });
    } catch (e) {
      throw new Error(`Network error reaching GitHub \u2014 check your connection. (${e.message})`);
    }
    if (repoRes.status === 404) {
      throw new Error(
        `Repo "${ownerRepo}" doesn't exist on GitHub (404). Double-check the owner and repo name in the URL \u2014 typos in either are the most common cause. If the repo is private, the import tool can't reach it.`
      );
    }
    if (repoRes.status === 403) {
      const reset = (_a = repoRes.headers) == null ? void 0 : _a["x-ratelimit-reset"];
      const resetHint = reset ? ` Resets at ${new Date(Number(reset) * 1e3).toLocaleTimeString()}.` : "";
      throw new Error(`GitHub API rate-limit hit (403).${resetHint} Try again later, or import the SKILL.md files manually via "Import local files\u2026".`);
    }
    if (repoRes.status !== 200) {
      throw new Error(`GitHub API returned ${repoRes.status} for ${ownerRepo}. Try again, or use "Import local files\u2026".`);
    }
    const defaultBranch = (_b = repoRes.json.default_branch) != null ? _b : "main";
    const treeRes = await (0, import_obsidian10.requestUrl)({
      url: `https://api.github.com/repos/${ownerRepo}/git/trees/${defaultBranch}?recursive=1`
    });
    if (treeRes.status !== 200) {
      throw new Error(`Could not list files in ${ownerRepo}@${defaultBranch} (status ${treeRes.status}). The branch may be empty or renamed.`);
    }
    const entries = (_c = treeRes.json.tree) != null ? _c : [];
    const candidates = entries.filter((e) => e.type === "blob" && isLikelySkillPath(e.path)).map((e) => e.path);
    const discovered = [];
    for (let i = 0; i < candidates.length; i++) {
      const filePath = candidates[i];
      setStatus(`Scanning ${i + 1}/${candidates.length}: ${filePath}`);
      try {
        const rawUrl = `https://raw.githubusercontent.com/${ownerRepo}/${defaultBranch}/${filePath}`;
        const res = await (0, import_obsidian10.requestUrl)({ url: rawUrl });
        if (res.status !== 200)
          continue;
        const skill = parseSKILL(res.text, filePath);
        if (!skill)
          continue;
        if (!isSafeSkillName(skill.name))
          continue;
        discovered.push({
          path: filePath,
          name: skill.name,
          description: skill.description,
          rawContent: res.text
        });
      } catch (e) {
      }
    }
    return discovered;
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/manage-skills-modal.ts
var import_obsidian11 = require("obsidian");
var AGENT_FOLDER2 = "_agent";
var ManageSkillsModal = class extends import_obsidian11.Modal {
  constructor(app, onChanged) {
    super(app);
    this.onChanged = onChanged;
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("gstack-manage-skills-modal");
    contentEl.createEl("h2", { text: "Installed skills" });
    contentEl.createEl("p", {
      text: `Custom skills under ${AGENT_FOLDER2}/. Built-in skills (research, plan, etc.) aren't listed \u2014 they're embedded in the plugin.`,
      cls: "gstack-manage-skills-desc"
    });
    const status = contentEl.createEl("p", { cls: "gstack-manage-skills-status" });
    const listEl = contentEl.createDiv({ cls: "gstack-manage-skills-list" });
    const skills = await this.scan();
    if (skills.length === 0) {
      status.textContent = `No custom skills installed. Drop a SKILL.md into ${AGENT_FOLDER2}/ or import one via "ogstack: Import skill from GitHub".`;
      return;
    }
    for (const skill of skills) {
      this.renderRow(listEl, skill, async () => {
        await this.deleteSkill(skill);
        listEl.empty();
        const remaining = await this.scan();
        if (remaining.length === 0) {
          status.textContent = `No custom skills installed.`;
          return;
        }
        for (const s of remaining) {
          this.renderRow(listEl, s, async () => {
            await this.deleteSkill(s);
            this.onClose();
            this.onOpen();
          });
        }
      });
    }
  }
  renderRow(parent, skill, onDelete) {
    const row = parent.createDiv({ cls: "gstack-manage-skills-item" });
    const info = row.createDiv({ cls: "gstack-manage-skills-info" });
    const nameEl = info.createDiv({ cls: "gstack-manage-skills-name" });
    nameEl.createSpan({ text: skill.name });
    if (skill.agent) {
      nameEl.createSpan({ text: " agent", cls: "gstack-manage-skills-tag" });
    }
    info.createEl("div", { text: skill.description, cls: "gstack-manage-skills-desc-line" });
    info.createEl("div", { text: skill.filePath, cls: "gstack-manage-skills-path" });
    const actions = row.createDiv({ cls: "gstack-manage-skills-actions" });
    const openBtn = actions.createEl("button", { text: "Open", cls: "gstack-manage-skills-btn" });
    openBtn.setAttribute("aria-label", `Open ${skill.name} SKILL.md`);
    openBtn.addEventListener("click", async () => {
      this.app.workspace.openLinkText(skill.filePath, "", true);
      this.close();
    });
    const delBtn = actions.createEl("button", { text: "Delete", cls: "gstack-manage-skills-btn mod-warning" });
    delBtn.setAttribute("aria-label", `Delete ${skill.name}`);
    delBtn.addEventListener("click", async () => {
      var _a;
      const confirmed = confirm(
        `Delete skill "${skill.name}"?

This removes ${(_a = skill.folderPath) != null ? _a : skill.filePath} from your vault. You can't undo this from inside ogstack.`
      );
      if (!confirmed)
        return;
      delBtn.disabled = true;
      await onDelete();
    });
  }
  async scan() {
    const adapter = this.app.vault.adapter;
    if (!await adapter.exists(AGENT_FOLDER2))
      return [];
    const out = [];
    const { files, folders } = await adapter.list(AGENT_FOLDER2);
    for (const filePath of files.filter((f) => f.endsWith(".md"))) {
      const parsed = await this.tryParse(filePath);
      if (parsed)
        out.push({ ...parsed, filePath, folderPath: null });
    }
    for (const folderPath of folders) {
      const skillFilePath = `${folderPath}/SKILL.md`;
      if (!await adapter.exists(skillFilePath))
        continue;
      const parsed = await this.tryParse(skillFilePath);
      if (parsed)
        out.push({ ...parsed, filePath: skillFilePath, folderPath });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }
  async tryParse(filePath) {
    try {
      const content = await this.app.vault.adapter.read(filePath);
      const skill = parseSKILL(content, filePath);
      if (!skill)
        return null;
      return { name: skill.name, description: skill.description, agent: skill.agent };
    } catch (e) {
      return null;
    }
  }
  async deleteSkill(skill) {
    const adapter = this.app.vault.adapter;
    try {
      if (skill.folderPath) {
        await adapter.rmdir(skill.folderPath, true);
      } else {
        await adapter.remove(skill.filePath);
      }
      new import_obsidian11.Notice(`ogstack: deleted ${skill.name}`);
      this.onChanged();
    } catch (err) {
      new import_obsidian11.Notice(`ogstack: could not delete ${skill.name} \u2014 ${err.message}`);
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/main.ts
var GStackPlugin = class extends import_obsidian12.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.chatStore = new ChatStore(this);
    this.skillLoader = null;
    this.bar = null;
    this.statusIndicator = null;
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
          callback: () => this.runSkillFromCommand(skill)
        });
        return () => {
          this.app.commands.removeCommand(`${this.manifest.id}:${commandId}`);
        };
      }
    );
    await this.skillLoader.loadAll();
    this.statusIndicator = this.addStatusBarItem();
    this.statusIndicator.style.display = "none";
    this.bar = new BarChat({
      app: this.app,
      settings: this.settings,
      getSkills: () => this.getSkills(),
      chatStore: this.chatStore,
      onStreamingChange: (streaming, label) => {
        if (streaming && this.bar && !this.bar.isVisible()) {
          this.showStreamingIndicator(label);
        } else {
          this.hideStreamingIndicator();
        }
      }
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
    this.registerDomEvent(window, "keydown", (evt) => {
      var _a2;
      const isMod = evt.ctrlKey || evt.metaKey;
      const keyIsSpace = evt.code === "Space" || evt.key === " " || evt.key === "Spacebar";
      if (isMod && evt.shiftKey && !evt.altKey && keyIsSpace) {
        evt.preventDefault();
        evt.stopPropagation();
        (_a2 = this.bar) == null ? void 0 : _a2.focusInput();
      }
    });
    this.addCommand({
      id: "import-skill",
      name: "Import skill from GitHub",
      callback: () => {
        new ImportSkillModal(this.app, () => {
          var _a2;
          (_a2 = this.skillLoader) == null ? void 0 : _a2.loadAll();
        }).open();
      }
    });
    this.addCommand({
      id: "manage-skills",
      name: "Manage installed skills",
      callback: () => {
        new ManageSkillsModal(this.app, () => {
          var _a2;
          (_a2 = this.skillLoader) == null ? void 0 : _a2.loadAll();
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
  async runSkillFromCommand(skill) {
    var _a;
    if (skill.autoInsert && skill.mode !== "interactive") {
      await runSkill(skill, this.app, this.settings, (_a = this.bar) != null ? _a : void 0);
      return;
    }
    if (this.bar) {
      await this.bar.runSkill(skill);
    }
  }
  showStreamingIndicator(label) {
    if (!this.statusIndicator)
      return;
    this.statusIndicator.style.display = "";
    this.statusIndicator.empty();
    const wrap = this.statusIndicator.createSpan({ cls: "gstack-statusbar-streaming" });
    wrap.createSpan({ cls: "dot" });
    wrap.createSpan({ cls: "dot" });
    wrap.createSpan({ cls: "dot" });
    wrap.createSpan({ text: ` ${label}` });
  }
  hideStreamingIndicator() {
    if (!this.statusIndicator)
      return;
    this.statusIndicator.style.display = "none";
    this.statusIndicator.empty();
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
    var _a;
    await this.saveData(this.settings);
    (_a = this.bar) == null ? void 0 : _a.updateSettings(this.settings);
  }
};
function titleCase(s) {
  return s.split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
