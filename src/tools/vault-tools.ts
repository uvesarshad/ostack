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

// Hard caps on tool output sizes. The agent only gets so many tokens per round;
// a 50KB read_note dump from one rogue link consumes a chunk of the budget.
// Truncate with a marker so the model knows there's more if it needs to ask.
export const READ_NOTE_CHAR_CAP = 12_000;
export const SEARCH_VAULT_CHAR_CAP = 4_000;
export const GET_ACTIVE_NOTE_CHAR_CAP = 12_000;
// Guardrail on how many files search_vault scans before bailing. Keeps a
// 10k-note vault from blocking the agent for many seconds on a single call.
export const SEARCH_VAULT_FILE_CAP = 2_000;

function truncateWithMarker(content: string, cap: number, label = "note"): string {
  if (content.length <= cap) return content;
  return `${content.slice(0, cap)}\n\n[truncated: ${label} continues — ${content.length - cap} more chars]`;
}

export function resolveTools(allowed: string[] | null): ToolDefinition[] {
  const names = !allowed || allowed.length === 0 ? ALL_TOOL_NAMES : allowed;
  return names.map((n) => VAULT_TOOLS[n]).filter((t): t is ToolDefinition => !!t);
}

// ── Executors ────────────────────────────────────────────────────────

export interface ExecuteVaultToolOptions {
  // When false, write_note and append_note refuse to run and return an error
  // the agent surfaces back to the user. See settings.allowAgentWrites.
  allowWrites?: boolean;
}

const WRITE_DISABLED_MSG =
  "ERROR: agent file writes are disabled. Enable Settings → ogstack → Agent safety → \"Allow agent file writes\" to grant write access.";

export async function executeVaultTool(
  app: App,
  name: string,
  input: Record<string, unknown>,
  options: ExecuteVaultToolOptions = {}
): Promise<string> {
  const allowWrites = options.allowWrites ?? false;
  switch (name) {
    case "read_note":
      return await readNote(app, String(input.path ?? ""));
    case "write_note":
      if (!allowWrites) return WRITE_DISABLED_MSG;
      return await writeNote(app, String(input.path ?? ""), String(input.content ?? ""));
    case "append_note":
      if (!allowWrites) return WRITE_DISABLED_MSG;
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
  const content = await app.vault.read(file);
  return truncateWithMarker(content, READ_NOTE_CHAR_CAP, path);
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
  const allFiles = app.vault.getMarkdownFiles();
  const filesToScan = allFiles.slice(0, SEARCH_VAULT_FILE_CAP);
  const fileScanTruncated = allFiles.length > SEARCH_VAULT_FILE_CAP;

  const matches: string[] = [];
  for (const f of filesToScan) {
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
  if (matches.length === 0) {
    return fileScanTruncated
      ? `no matches for "${query}" (note: only first ${SEARCH_VAULT_FILE_CAP} of ${allFiles.length} notes scanned — narrow the query or read specific paths)`
      : `no matches for "${query}"`;
  }
  let result = matches.join("\n");
  if (fileScanTruncated) {
    result += `\n[scan truncated: only first ${SEARCH_VAULT_FILE_CAP} of ${allFiles.length} notes searched]`;
  }
  return truncateWithMarker(result, SEARCH_VAULT_CHAR_CAP, "results");
}

async function getActiveNote(app: App): Promise<string> {
  const file = app.workspace.getActiveFile();
  if (!file) return "no active note";
  const content = await app.vault.read(file);
  return truncateWithMarker(`path: ${file.path}\n---\n${content}`, GET_ACTIVE_NOTE_CHAR_CAP, file.path);
}

async function ensureParentFolder(app: App, path: string): Promise<void> {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) return;
  const folder = path.slice(0, lastSlash);
  const existing = app.vault.getAbstractFileByPath(folder);
  if (existing instanceof TFolder) return;
  await app.vault.adapter.mkdir(folder);
}
