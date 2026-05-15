import { App } from "obsidian";
import { escapeForFraming } from "./context-builder";

// Match [[Wiki Link]] and [[Wiki Link|alias]] in user text. The captured group
// is the note basename (left side of `|`), trimmed by the caller.
const WIKI_LINK_RX = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;

// Extract [[Note]] references from message text and return their vault contents
// wrapped in <mentioned-note> blocks for inclusion in a system prompt. Both
// bar-chat and sidebar paths use this so behavior stays consistent.
export async function resolveMentions(text: string, app: App): Promise<string> {
  const names = [...text.matchAll(WIKI_LINK_RX)].map((m) => m[1].trim());
  if (names.length === 0) return "";

  // Dedupe — a user might reference the same note twice in one message and
  // there's no point dumping the content into context twice.
  const unique = [...new Set(names)];

  const snippets: string[] = [];
  for (const name of unique) {
    const file = app.vault.getFiles().find(
      (f) => f.extension === "md" && f.basename.toLowerCase() === name.toLowerCase()
    );
    if (!file) continue;
    try {
      const content = await app.vault.cachedRead(file);
      snippets.push(`<mentioned-note title="${file.basename}">\n${escapeForFraming(content)}\n</mentioned-note>`);
    } catch {
      // silently skip unreadable files
    }
  }

  return snippets.join("\n\n");
}
