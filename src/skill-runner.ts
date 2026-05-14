import { App, Editor, MarkdownView, Notice, TFile } from "obsidian";
import { buildVaultContext, formatVaultContext } from "./context-builder";
import { applyScoutResults, scoutContext } from "./context-scout";
import { FloatingInput, ProgressReporter } from "./floating-input";
import { routeOutput } from "./output-router";
import { getProvider } from "./providers/provider-interface";
import { GStackSettings } from "./settings";
import { Skill } from "./skill-loader";

// Per-note mutex — prevents concurrent inline writes to the same note
const inlineMutex = new Map<string, boolean>();

export async function runSkill(
  skill: Skill,
  app: App,
  settings: GStackSettings,
  reporter?: ProgressReporter
): Promise<void> {
  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) {
    new Notice("ogstack: open a note first");
    return;
  }

  const outputMode = skill.output ?? settings.outputMode;

  if (outputMode === "inline") {
    if (inlineMutex.get(activeFile.path)) {
      new Notice(`ogstack: ${skill.name} is already running on this note`);
      return;
    }
    inlineMutex.set(activeFile.path, true);
  }

  if (!settings.apiKey && settings.provider !== "ollama") {
    if (outputMode === "inline") inlineMutex.delete(activeFile.path);
    new Notice("ogstack: add your API key in Settings → ogstack");
    return;
  }

  // Use provided reporter, or create a centered progress overlay
  const bar: ProgressReporter = reporter ?? new FloatingInput({ mode: "progress" });

  try {
    bar.setRunning("ogstack: building context…");

    const ctx = await buildVaultContext(
      app,
      activeFile,
      settings,
      skill.maxDepth,
      skill.maxTokens ?? settings.maxTokens
    );
    if (!ctx) {
      bar.destroy();
      return;
    }

    let finalCtx = ctx;

    if (settings.scoutEnabled && ctx.candidates.length > 0) {
      bar.setRunning("ogstack: scoring relevance…");
      const scoutResults = await scoutContext(ctx.candidates, ctx, app, settings);
      if (scoutResults && scoutResults.length > 0) {
        finalCtx = applyScoutResults(ctx, scoutResults);
      }
    }

    bar.setRunning(`ogstack: running ${skill.name}…`);

    const vaultContextStr = formatVaultContext(finalCtx);

    if (!skill.systemPrompt.includes("{{VAULT_CONTEXT}}")) {
      console.warn(`ogstack: SKILL.md for ${skill.name} has no {{VAULT_CONTEXT}} placeholder`);
    }

    const systemPrompt = skill.systemPrompt.replace("{{VAULT_CONTEXT}}", vaultContextStr);

    const provider = getProvider(settings);
    const tokenStream = provider.stream({
      systemPrompt,
      userMessage: "Execute this skill now.",
    });

    const activeNotePath = activeFile.path;
    const activeNoteBasename = activeFile.basename;

    function getEditor(): Editor | null {
      const view = app.workspace.getActiveViewOfType(MarkdownView);
      return view?.editor ?? null;
    }

    await routeOutput(
      tokenStream,
      { activeNotePath, activeNoteBasename, skill, outputMode },
      app,
      getEditor
    );

    bar.setDone("ogstack: done ✓");
  } catch (err: unknown) {
    const e = err as { status?: number; body?: string; message?: string; name?: string };

    let msg: string;
    if (e.name === "AbortError" || e.message === "timeout") {
      msg = "timed out after 120s — try a smaller token budget";
    } else if (e.status === 401) {
      msg = "invalid API key — check Settings → ogstack";
    } else if (e.status === 0) {
      msg = settings.provider === "ollama"
        ? `Ollama not reachable at ${settings.ollamaHost}`
        : `could not reach ${settings.provider}`;
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

export function clearMutex(filePath: string): void {
  inlineMutex.delete(filePath);
}
