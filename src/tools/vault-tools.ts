import { App, TFile, TFolder } from "obsidian";

// Tool-use schemas in the Anthropic shape. Each tool has a name, a description
// the model reads to decide when to call it, and a JSON schema for inputs.
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export const VAULT_TOOLS: Record<string, ToolDefinition> = {
  read_note: {
    name: "read_note",
    description: "Read the full contents of a note from the vault. Returns the markdown text.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the note relative to vault root, including .md extension." },
      },
      required: ["path"],
    },
  },
  write_note: {
    name: "write_note",
    description: "Create a new note or overwrite an existing one with the given content. Use carefully — overwrites without warning.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the note relative to vault root, including .md extension." },
        content: { type: "string", description: "The full markdown content of the note." },
      },
      required: ["path", "content"],
    },
  },
  append_note: {
    name: "append_note",
    description: "Append content to the end of an existing note. Creates the note if it doesn't exist.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the note relative to vault root, including .md extension." },
        content: { type: "string", description: "Markdown content to append." },
      },
      required: ["path", "content"],
    },
  },
  list_notes: {
    name: "list_notes",
    description: "List markdown notes in a folder (or vault root). Returns relative paths, one per line.",
    input_schema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Folder path relative to vault root. Omit or pass empty string for the entire vault." },
      },
      required: [],
    },
  },
  search_vault: {
    name: "search_vault",
    description: "Search note contents for a case-insensitive substring. Returns up to 20 matches as 'path: snippet' lines.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring to search for." },
      },
      required: ["query"],
    },
  },
  get_active_note: {
    name: "get_active_note",
    description: "Return the path and contents of the note the user currently has open. Empty if no note is active.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const ALL_TOOL_NAMES = Object.keys(VAULT_TOOLS);

export function resolveTools(allowed: string[] | null): ToolDefinition[] {
  const names = !allowed || allowed.length === 0 ? ALL_TOOL_NAMES : allowed;
  return names.map((n) => VAULT_TOOLS[n]).filter((t): t is ToolDefinition => !!t);
}

// ── Executors ────────────────────────────────────────────────────────

export async function executeVaultTool(
  app: App,
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "read_note":
      return await readNote(app, String(input.path ?? ""));
    case "write_note":
      return await writeNote(app, String(input.path ?? ""), String(input.content ?? ""));
    case "append_note":
      return await appendNote(app, String(input.path ?? ""), String(input.content ?? ""));
    case "list_notes":
      return await listNotes(app, String(input.folder ?? ""));
    case "search_vault":
      return await searchVault(app, String(input.query ?? ""));
    case "get_active_note":
      return await getActiveNote(app);
    default:
      return `ERROR: unknown tool "${name}"`;
  }
}

async function readNote(app: App, path: string): Promise<string> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return `ERROR: note not found: ${path}`;
  return await app.vault.read(file);
}

async function writeNote(app: App, path: string, content: string): Promise<string> {
  if (!path) return "ERROR: path is required";
  await ensureParentFolder(app, path);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
    return `wrote ${path} (${content.length} chars, overwritten)`;
  }
  await app.vault.create(path, content);
  return `created ${path} (${content.length} chars)`;
}

async function appendNote(app: App, path: string, content: string): Promise<string> {
  if (!path) return "ERROR: path is required";
  await ensureParentFolder(app, path);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    const current = await app.vault.read(existing);
    const sep = current.endsWith("\n") ? "" : "\n";
    await app.vault.modify(existing, current + sep + content);
    return `appended to ${path} (+${content.length} chars)`;
  }
  await app.vault.create(path, content);
  return `created ${path} (${content.length} chars)`;
}

async function listNotes(app: App, folder: string): Promise<string> {
  const files = app.vault.getMarkdownFiles();
  const filtered = folder
    ? files.filter((f) => f.path.startsWith(folder.endsWith("/") ? folder : folder + "/") || f.path === folder)
    : files;
  if (filtered.length === 0) return folder ? `no notes in ${folder}` : "no notes in vault";
  // Cap to keep tool output small enough for context
  const capped = filtered.slice(0, 200);
  const lines = capped.map((f) => f.path).join("\n");
  return capped.length < filtered.length
    ? `${lines}\n(... ${filtered.length - capped.length} more truncated)`
    : lines;
}

async function searchVault(app: App, query: string): Promise<string> {
  if (!query) return "ERROR: query is required";
  const needle = query.toLowerCase();
  const files = app.vault.getMarkdownFiles();
  const matches: string[] = [];
  for (const f of files) {
    if (matches.length >= 20) break;
    let content: string;
    try {
      content = await app.vault.cachedRead(f);
    } catch {
      continue;
    }
    const idx = content.toLowerCase().indexOf(needle);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 40);
    const end = Math.min(content.length, idx + query.length + 80);
    const snippet = content.slice(start, end).replace(/\s+/g, " ").trim();
    matches.push(`${f.path}: …${snippet}…`);
  }
  if (matches.length === 0) return `no matches for "${query}"`;
  return matches.join("\n");
}

async function getActiveNote(app: App): Promise<string> {
  const file = app.workspace.getActiveFile();
  if (!file) return "no active note";
  const content = await app.vault.read(file);
  return `path: ${file.path}\n---\n${content}`;
}

async function ensureParentFolder(app: App, path: string): Promise<void> {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) return;
  const folder = path.slice(0, lastSlash);
  const existing = app.vault.getAbstractFileByPath(folder);
  if (existing instanceof TFolder) return;
  await app.vault.adapter.mkdir(folder);
}
