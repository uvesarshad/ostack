import { App, Editor, MarkdownView, Notice } from "obsidian";
import { Skill } from "./skill-loader";

export interface OutputContext {
  activeNotePath: string;
  activeNoteBasename: string;
  skill: Skill;
  outputMode: "inline" | "new-note";
}

// cursor advancement math is the same for any chunk size — single char or 2000-char Ollama yield
export async function routeOutput(
  tokens: AsyncGenerator<string, void, unknown>,
  ctx: OutputContext,
  app: App,
  getEditor: () => Editor | null
): Promise<void> {
  if (ctx.outputMode === "inline") {
    await routeInline(tokens, getEditor);
  } else {
    await routeNewNote(tokens, ctx, app);
  }
}

async function routeInline(
  tokens: AsyncGenerator<string, void, unknown>,
  getEditor: () => Editor | null
): Promise<void> {
  const editor = getEditor();
  if (!editor) {
    new Notice("gstack: open a note first");
    return;
  }

  let cursor = editor.getCursor();

  try {
    for await (const token of tokens) {
      const currentEditor = getEditor();
      if (!currentEditor) {
        new Notice("gstack: output interrupted — note was closed");
        return;
      }

      currentEditor.replaceRange(token, cursor);

      // Advance cursor by token length, accounting for newlines
      const lines = token.split("\n");
      if (lines.length === 1) {
        cursor = { line: cursor.line, ch: cursor.ch + token.length };
      } else {
        cursor = {
          line: cursor.line + lines.length - 1,
          ch: lines[lines.length - 1].length,
        };
      }
    }
  } catch {
    new Notice("gstack: output interrupted — note was closed");
  }
}

async function routeNewNote(
  tokens: AsyncGenerator<string, void, unknown>,
  ctx: OutputContext,
  app: App
): Promise<void> {
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const folderPath = ctx.activeNotePath.includes("/")
    ? ctx.activeNotePath.slice(0, ctx.activeNotePath.lastIndexOf("/"))
    : "";

  const baseName = `${ctx.activeNoteBasename} — ${capitalize(ctx.skill.name)}`;
  const primaryPath = folderPath ? `${folderPath}/${baseName}.md` : `${baseName}.md`;
  const finalPath = (await app.vault.adapter.exists(primaryPath))
    ? (folderPath ? `${folderPath}/${baseName} ${timestamp}.md` : `${baseName} ${timestamp}.md`)
    : primaryPath;

  let file: { path: string };
  try {
    file = await app.vault.create(finalPath, "");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    new Notice(`gstack: could not create output note — ${msg}`);
    return;
  }

  const leaf = app.workspace.getLeaf("split");
  const typedLeaf = leaf as unknown as {
    openFile(f: { path: string }): Promise<void>;
    view: { editor?: Editor };
  };
  await typedLeaf.openFile(file);

  const editor = typedLeaf.view?.editor ?? app.workspace.getActiveViewOfType(MarkdownView)?.editor;

  if (!editor) {
    new Notice("gstack: could not open output note editor");
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
          ch: lines[lines.length - 1].length,
        };
      }
    }
  } catch {
    new Notice("gstack: output interrupted — note was closed");
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
