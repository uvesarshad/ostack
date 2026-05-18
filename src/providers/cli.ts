import { LLMProvider, LLMRequest } from "./provider-interface";

declare const require: ((m: string) => unknown) | undefined;

export type CliKind = "claude-cli" | "codex-cli" | "gemini-cli";

const BINARY_NAMES: Record<CliKind, string> = {
  "claude-cli": "claude",
  "codex-cli": "codex",
  "gemini-cli": "gemini",
};

// Validators — prevent command injection by rejecting shell-meaningful characters
// before we hand `binary` and `args` to child_process.spawn. We intentionally do
// NOT use `shell: true` (see spawn call below), but defense-in-depth: even with
// shell:false, garbage values trip up the user with confusing errors.
const SHELL_METACHAR_RX = /[\s&|;<>$`"'(){}[\]\\]/;
const MODEL_NAME_RX = /^[a-zA-Z0-9._:\-/]{1,80}$/;

export function isSafeCliPath(path: string): boolean {
  if (typeof path !== "string") return false;
  if (path.length === 0) return true; // empty = use PATH default, OK
  if (path.length > 260) return false; // Windows MAX_PATH-ish guardrail
  return !SHELL_METACHAR_RX.test(path);
}

export function isSafeModelName(model: string): boolean {
  if (typeof model !== "string") return false;
  if (model.length === 0) return true; // empty = use CLI's default
  return MODEL_NAME_RX.test(model);
}

interface SpawnedProc {
  stdout: { on(event: "data", cb: (data: Buffer) => void): void; on(event: "end", cb: () => void): void };
  stderr: { on(event: "data", cb: (data: Buffer) => void): void };
  stdin: { write(data: string): void; end(): void };
  on(event: "exit" | "error", cb: (arg: unknown) => void): void;
  kill(signal?: string): void;
}

interface ChildProcessModule {
  spawn(cmd: string, args: string[], opts?: Record<string, unknown>): SpawnedProc;
}

function getChildProcess(): ChildProcessModule {
  const req = typeof require !== "undefined" ? require : (window as unknown as { require?: (m: string) => unknown }).require;
  if (!req) throw new Error("Node.js child_process is not available in this Obsidian build");
  return req("child_process") as ChildProcessModule;
}

interface FsModule {
  existsSync(p: string): boolean;
}
interface PathModule {
  join(...parts: string[]): string;
  isAbsolute(p: string): boolean;
}

function nodeRequire(): ((m: string) => unknown) | null {
  if (typeof require !== "undefined") return require;
  const w = window as unknown as { require?: (m: string) => unknown };
  return w.require ?? null;
}

// Helper for the pre-flight check: true iff `resolveBinary(name)` returned an
// actually-existing file. We call existsSync ourselves because resolveBinary
// returns the input unchanged when it can't find anything, which we can't
// distinguish from "found exactly the bare name in cwd".
export function binaryExistsOnPath(name: string): boolean {
  const req = nodeRequire();
  if (!req) return true; // can't verify — assume yes, let spawn try
  let fs: FsModule;
  try { fs = req("fs") as FsModule; } catch { return true; }
  const resolved = resolveBinary(name);
  // Bare name resolved unchanged → not found.
  if (resolved === name && !name.includes("/") && !name.includes("\\")) return false;
  try { return fs.existsSync(resolved); } catch { return false; }
}

// Resolve an executable by walking PATH × PATHEXT (Windows) ourselves. This
// replaces `shell: true`, which would otherwise re-interpret arguments via
// cmd.exe and open us up to command injection through cliPath / --model values.
export function resolveBinary(binary: string): string {
  const req = nodeRequire();
  // If we can't access node modules, fall back to the raw name and let
  // child_process.spawn fail with its own error.
  if (!req) return binary;

  let fs: FsModule;
  let path: PathModule;
  try {
    fs = req("fs") as FsModule;
    path = req("path") as PathModule;
  } catch {
    return binary;
  }

  // Absolute or path-segmented binaries: use as-is on POSIX; on Windows try
  // PATHEXT extensions if the file doesn't already exist.
  if (path.isAbsolute(binary) || binary.includes("/") || binary.includes("\\")) {
    if (fs.existsSync(binary)) return binary;
    if (typeof process !== "undefined" && process.platform === "win32") {
      const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";");
      for (const ext of exts) {
        const candidate = binary + ext;
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return binary;
  }

  // Bare name: walk PATH
  if (typeof process === "undefined") return binary;
  const pathSep = process.platform === "win32" ? ";" : ":";
  const dirs = (process.env.PATH ?? "").split(pathSep).filter(Boolean);
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, binary + ext);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        // permission errors on individual dirs — keep walking
      }
    }
  }
  return binary; // not found — let spawn surface the ENOENT
}

// Each CLI accepts a single prompt. We flatten system + history + current message.
export function buildPrompt(req: LLMRequest): string {
  const lines: string[] = [];
  if (req.systemPrompt) {
    lines.push(`<system>\n${req.systemPrompt}\n</system>`);
  }
  if (req.messages && req.messages.length > 0) {
    for (const m of req.messages) {
      const tag = m.role === "user" ? "Human" : "Assistant";
      lines.push(`\n${tag}: ${m.content}`);
    }
  } else if (req.userMessage) {
    lines.push(`\nHuman: ${req.userMessage}`);
  }
  return lines.join("");
}

export function buildArgs(kind: CliKind, model: string): string[] {
  switch (kind) {
    case "claude-cli":
      // Claude Code headless mode reads prompt from stdin when -p is empty
      return ["-p", ...(model ? ["--model", model] : []), "--output-format", "text"];
    case "codex-cli":
      // Codex CLI exec mode. We need:
      //  - --skip-git-repo-check: Obsidian vaults usually aren't git repos
      //  - --json: parse structured JSONL events so we can extract assistant text
      //            (default output mixes session info, reasoning, tool calls, etc.)
      //  - --sandbox read-only: we only want a chat reply, not file ops
      //  - prompt is read from stdin (no positional arg)
      return [
        "exec",
        "--skip-git-repo-check",
        "--json",
        "--sandbox", "read-only",
        ...(model ? ["--model", model] : []),
      ];
    case "gemini-cli":
      // Gemini CLI: -p reads from stdin if no prompt arg
      return ["-p", ...(model ? ["--model", model] : [])];
  }
}

export class CliProvider implements LLMProvider {
  constructor(
    private kind: CliKind,
    private model: string,
    private cliPath: string,
    private cwd?: string
  ) {}

  async *stream(request: LLMRequest): AsyncGenerator<string, void, unknown> {
    let cp: ChildProcessModule;
    try {
      cp = getChildProcess();
    } catch (err: unknown) {
      throw { status: 0, body: (err as Error).message };
    }

    if (!isSafeCliPath(this.cliPath)) {
      throw {
        status: 0,
        body: `Unsafe CLI path "${this.cliPath}" — must not contain spaces or shell metacharacters. Configure in Settings → ogstack.`,
      };
    }
    if (!isSafeModelName(this.model)) {
      throw {
        status: 0,
        body: `Unsafe model name "${this.model}" — allowed: letters, digits, ._:-/`,
      };
    }

    const requestedName = this.cliPath || BINARY_NAMES[this.kind];
    const binary = resolveBinary(requestedName);
    // resolveBinary returns the input unchanged when it can't find the file.
    // For bare names (no slash), that's our signal to fail fast with an
    // actionable hint instead of letting spawn surface a cryptic ENOENT.
    const isBareName = !requestedName.includes("/") && !requestedName.includes("\\");
    const looksUnresolved = isBareName && binary === requestedName;
    if (looksUnresolved && !binaryExistsOnPath(requestedName)) {
      throw {
        status: 0,
        body:
          `Could not find "${requestedName}" on PATH. ` +
          `\n\n• Install: run \`npm install -g @openai/codex\` (or the CLI's installer) in your terminal.` +
          `\n• Verify: \`${requestedName} --version\` should work in a fresh terminal.` +
          `\n• Already installed? Quit and reopen Obsidian — GUI apps cache PATH at launch on Windows/macOS, so a newly-installed CLI isn't visible until you restart.` +
          `\n• Custom location: set the absolute path in Settings → ogstack → CLI binary path.`,
      };
    }
    const args = buildArgs(this.kind, this.model);
    const prompt = buildPrompt(request);

    let proc: SpawnedProc;
    try {
      // shell:false (the default) keeps `binary` and `args` outside any shell
      // interpreter — no command substitution, no redirection, no globbing.
      // On Windows we resolve `.cmd`/`.bat`/`.exe` ourselves via resolveBinary().
      // cwd is the vault root so the CLI sees the user's notes, not the
      // Obsidian app install directory it would inherit from our process.
      const spawnOpts: Record<string, unknown> = {};
      if (this.cwd) spawnOpts.cwd = this.cwd;
      proc = cp.spawn(binary, args, spawnOpts);
    } catch (err: unknown) {
      throw { status: 0, body: `Failed to spawn ${binary}: ${(err as Error).message}. Run \`${binary} --version\` in your terminal to verify the CLI is installed.` };
    }

    try {
      proc.stdin.write(prompt);
      proc.stdin.end();
    } catch (err: unknown) {
      throw { status: 0, body: `Failed to send prompt to ${binary}: ${(err as Error).message}` };
    }

    const queue: string[] = [];
    let finished = false;
    let errorMsg = "";
    let resolver: (() => void) | null = null;

    const wake = (): void => { resolver?.(); resolver = null; };

    // Codex emits JSONL events; we need to buffer partial lines and extract just
    // the assistant text. Other CLIs emit plain text so we forward as-is.
    const useJsonl = this.kind === "codex-cli";
    let jsonlBuffer = "";
    let emittedFromDeltas = false;
    let lastFullAgentMessage = "";

    const handleJsonlLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("{")) return; // skip "Reading prompt from stdin..." etc.
      let evt: {
        type?: string;
        item?: { type?: string; text?: string; delta?: string };
        msg?: { type?: string; message?: string };
      };
      try {
        evt = JSON.parse(trimmed);
      } catch {
        return; // skip malformed lines
      }
      // Codex 0.130+ schema: item.completed / item.delta with item.type === "agent_message"
      if (evt.type === "item.delta" && evt.item?.type === "agent_message" && typeof evt.item.delta === "string") {
        emittedFromDeltas = true;
        queue.push(evt.item.delta);
        wake();
      } else if (evt.type === "item.completed" && evt.item?.type === "agent_message" && typeof evt.item.text === "string") {
        lastFullAgentMessage = evt.item.text;
      } else if (evt.type === "error" && evt.msg?.message) {
        errorMsg += evt.msg.message + "\n";
      }
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (!useJsonl) {
        queue.push(text);
        wake();
        return;
      }
      jsonlBuffer += text;
      let nl: number;
      while ((nl = jsonlBuffer.indexOf("\n")) !== -1) {
        const line = jsonlBuffer.slice(0, nl);
        jsonlBuffer = jsonlBuffer.slice(nl + 1);
        handleJsonlLine(line);
      }
    });

    proc.stdout.on("end", () => {
      if (useJsonl) {
        // Flush trailing JSONL line if any
        if (jsonlBuffer.trim().length > 0) {
          handleJsonlLine(jsonlBuffer);
          jsonlBuffer = "";
        }
        // If no deltas streamed but we captured a full agent_message, emit it now
        if (!emittedFromDeltas && lastFullAgentMessage) {
          queue.push(lastFullAgentMessage);
        }
      }
      finished = true;
      wake();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      // Codex prints "Reading prompt from stdin..." as informational stderr — not an error.
      const cleaned = text
        .split("\n")
        .filter((l) => !l.includes("Reading prompt from stdin"))
        .join("\n");
      errorMsg += cleaned;
    });

    proc.on("exit", (code: unknown) => {
      finished = true;
      if (typeof code === "number" && code !== 0 && !errorMsg) {
        errorMsg = `${binary} exited with code ${code}`;
      }
      wake();
    });

    proc.on("error", (err: unknown) => {
      errorMsg = (err as Error).message;
      finished = true;
      wake();
    });

    let yieldedAnything = false;
    try {
      while (true) {
        if (queue.length > 0) {
          yieldedAnything = true;
          yield queue.shift() as string;
          continue;
        }
        if (finished) {
          if (!yieldedAnything && errorMsg.trim().length > 0) {
            throw { status: 0, body: errorMsg.trim() };
          }
          return;
        }
        await new Promise<void>((resolve) => { resolver = resolve; });
      }
    } finally {
      try { proc.kill(); } catch { /* ignore */ }
    }
  }
}
