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
      // Codex CLI: -e for exec mode, reads from stdin if prompt arg empty
      return ["exec", ...(model ? ["--model", model] : [])];
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

    proc.stdout.on("data", (chunk: Buffer) => {
      queue.push(chunk.toString("utf8"));
      wake();
    });

    proc.stdout.on("end", () => {
      finished = true;
      wake();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      errorMsg += chunk.toString("utf8");
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
