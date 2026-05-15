import { LLMProvider, LLMRequest } from "./provider-interface";

declare const require: ((m: string) => unknown) | undefined;

export type CliKind = "claude-cli" | "codex-cli" | "gemini-cli";

const BINARY_NAMES: Record<CliKind, string> = {
  "claude-cli": "claude",
  "codex-cli": "codex",
  "gemini-cli": "gemini",
};

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

// Each CLI accepts a single prompt. We flatten system + history + current message.
function buildPrompt(req: LLMRequest): string {
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

function buildArgs(kind: CliKind, model: string): string[] {
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
    private cliPath: string
  ) {}

  async *stream(request: LLMRequest): AsyncGenerator<string, void, unknown> {
    let cp: ChildProcessModule;
    try {
      cp = getChildProcess();
    } catch (err: unknown) {
      throw { status: 0, body: (err as Error).message };
    }

    const binary = this.cliPath || BINARY_NAMES[this.kind];
    const args = buildArgs(this.kind, this.model);
    const prompt = buildPrompt(request);

    let proc: SpawnedProc;
    try {
      // shell: true on Windows so PATH-resolved binaries (.cmd, .bat) work
      const isWindows = typeof process !== "undefined" && process.platform === "win32";
      proc = cp.spawn(binary, args, { shell: isWindows });
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
