import { App, Editor, MarkdownView, Notice, TFile } from "obsidian";
import { buildVaultContext, formatVaultContext } from "./context-builder";
import { applyScoutResults, scoutContext } from "./context-scout";
import { routeOutput } from "./output-router";
import { getProvider } from "./providers/provider-interface";
import { GStackSettings } from "./settings";
import { Skill } from "./skill-loader";

// Per-note mutex keyed by file path — prevents concurrent inline writes to same note
const inlineMutex = new Map<string, boolean>();

// Replace the current notice reference: hide old, create new, return new.
// Plain function (not closure) avoids TypeScript's closure narrowing restriction.
function replaceNotice(prev: Notice | null, msg: string, duration?: number): Notice {
  prev?.hide();
  return new Notice(msg, duration);
}

export async function runSkill(
  skill: Skill,
  app: App,
  settings: GStackSettings
): Promise<void> {
  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) {
    new Notice("gstack: open a note first");
    return;
  }

  const outputMode = skill.output ?? settings.outputMode;

  // Per-note mutex only for inline output
  if (outputMode === "inline") {
    if (inlineMutex.get(activeFile.path)) {
      new Notice(`gstack: ${skill.name} is already running on this note`);
      return;
    }
    inlineMutex.set(activeFile.path, true);
  }

  if (!settings.apiKey && settings.provider !== "ollama") {
    if (outputMode === "inline") inlineMutex.delete(activeFile.path);
    new Notice("gstack: add your API key in Settings → gstack");
    return;
  }

  let notice: Notice | null = null;

  try {
    notice = replaceNotice(notice, "gstack: building context…");

    const ctx = await buildVaultContext(
      app,
      activeFile,
      settings,
      skill.maxDepth,
      skill.maxTokens ?? settings.maxTokens
    );
    if (!ctx) {
      notice.hide();
      return;
    }

    let finalCtx = ctx;

    if (settings.scoutEnabled && ctx.candidates.length > 0) {
      notice = replaceNotice(notice, "gstack: scoring relevance…");
      const scoutResults = await scoutContext(ctx.candidates, ctx, app, settings);
      if (scoutResults && scoutResults.length > 0) {
        finalCtx = applyScoutResults(ctx, scoutResults);
      }
    }

    notice = replaceNotice(notice, `gstack: running ${skill.name}…`);

    const vaultContextStr = formatVaultContext(finalCtx);

    if (!skill.systemPrompt.includes("{{VAULT_CONTEXT}}")) {
      console.warn(`gstack: SKILL.md for ${skill.name} has no {{VAULT_CONTEXT}} — context will not be injected`);
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

    notice = replaceNotice(notice, "gstack: done", 2000);
  } catch (err: unknown) {
    notice?.hide();

    const e = err as { status?: number; body?: string; message?: string; name?: string };

    if (e.name === "AbortError" || e.message === "timeout") {
      new Notice("gstack: response timed out after 120s — try a smaller token budget", 6000);
    } else if (e.status === 401) {
      new Notice("gstack: invalid API key — check Settings → gstack", 5000);
    } else if (e.status === 0) {
      if (settings.provider === "ollama") {
        new Notice(`gstack: Ollama not reachable at ${settings.ollamaHost} — is it running?`, 5000);
      } else {
        new Notice(`gstack: could not reach ${settings.provider} — check your connection`, 5000);
      }
    } else if (e.status && e.status >= 400) {
      new Notice(`gstack: provider error ${e.status} — ${e.body ?? "unknown error"}`, 5000);
    } else {
      new Notice(`gstack: could not reach ${settings.provider} — check your connection`, 5000);
    }
  } finally {
    if (outputMode === "inline") {
      inlineMutex.delete(activeFile.path);
    }
  }
}

export function clearMutex(filePath: string): void {
  inlineMutex.delete(filePath);
}
