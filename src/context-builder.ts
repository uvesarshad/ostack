import { App, Notice, TFile } from "obsidian";
import { GStackSettings } from "./settings";

export interface ScoredFile {
  file: TFile;
  score: number;
  depth: number;
}

export interface VaultContext {
  activeNote: { path: string; content: string };
  linkedNotes: Array<{
    path: string;
    content: string;
    score: number;
    depth: number;
    annotation?: string;
    summaryOnly?: boolean;
  }>;
  tokenCount: number;
  candidates: ScoredFile[];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function scoreFile(depth: number, mtime: number, decayDays: number): number {
  const daysSince = (Date.now() - mtime) / 86_400_000;
  return (1 / depth) * 0.6 + Math.exp(-daysSince / decayDays) * 0.4;
}

const BFS_NODE_CAP = 200;
const MAX_DEPTH_CEILING = 5;

export async function buildVaultContext(
  app: App,
  activeFile: TFile,
  settings: GStackSettings,
  maxDepthOverride = 3,
  maxTokensOverride?: number
): Promise<VaultContext | null> {
  if (!activeFile) {
    new Notice("gstack: open a note first");
    return null;
  }

  const maxDepth = Math.min(maxDepthOverride, MAX_DEPTH_CEILING);
  const effectiveMaxTokens = maxTokensOverride ?? settings.maxTokens;
  const tokenBudget = Math.floor(effectiveMaxTokens * 0.8);

  const activeContent = await app.vault.cachedRead(activeFile);
  const activeTokens = estimateTokens(activeContent);

  if (activeTokens >= tokenBudget) {
    return {
      activeNote: { path: activeFile.path, content: activeContent },
      linkedNotes: [],
      tokenCount: activeTokens,
      candidates: [],
    };
  }

  // BFS to discover linked notes
  const visited = new Set<string>([activeFile.path]);
  const queue: Array<{ path: string; depth: number }> = [];
  const candidates: ScoredFile[] = [];

  const initialLinks = app.metadataCache.resolvedLinks[activeFile.path] ?? {};
  for (const linkedPath of Object.keys(initialLinks)) {
    if (!visited.has(linkedPath)) {
      queue.push({ path: linkedPath, depth: 1 });
    }
  }

  let capReached = false;

  while (queue.length > 0) {
    const batch = queue.splice(0, queue.length);

    for (const { path, depth } of batch) {
      if (visited.has(path)) continue;
      visited.add(path);

      const file = app.vault.getAbstractFileByPath(path) as TFile | null;
      if (!file || !(file instanceof TFile)) continue;

      const score = scoreFile(depth, file.stat.mtime, settings.contextDecayDays);
      candidates.push({ file, score, depth });

      if (candidates.length >= BFS_NODE_CAP) {
        capReached = true;
        break;
      }

      if (depth < maxDepth) {
        const links = app.metadataCache.resolvedLinks[path] ?? {};
        for (const nextPath of Object.keys(links)) {
          if (!visited.has(nextPath)) {
            queue.push({ path: nextPath, depth: depth + 1 });
          }
        }
      }
    }

    if (capReached) break;
  }

  if (capReached) {
    new Notice("gstack: large vault — context capped at 200 notes");
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Read files and accumulate within token budget
  let remaining = tokenBudget - activeTokens;
  const linkedNotes: VaultContext["linkedNotes"] = [];

  // Read in parallel per score group (all at once here for simplicity)
  const readResults = await Promise.allSettled(
    candidates.map((c) => app.vault.cachedRead(c.file))
  );

  for (let i = 0; i < candidates.length; i++) {
    const result = readResults[i];
    if (result.status === "rejected") continue; // file deleted between discovery and read

    const content = result.value;
    const tokens = estimateTokens(content);

    if (tokens > remaining) continue; // skip — drop whole file, never truncate

    remaining -= tokens;
    linkedNotes.push({
      path: candidates[i].file.path,
      content,
      score: candidates[i].score,
      depth: candidates[i].depth,
    });
  }

  const totalTokens = activeTokens + linkedNotes.reduce((sum, n) => sum + estimateTokens(n.content), 0);

  return {
    activeNote: { path: activeFile.path, content: activeContent },
    linkedNotes,
    tokenCount: totalTokens,
    candidates,
  };
}

export function formatVaultContext(ctx: VaultContext): string {
  const activeTitle = ctx.activeNote.path.split("/").pop()?.replace(/\.md$/, "") ?? ctx.activeNote.path;
  const parts: string[] = [
    `<active-note title="${escapeAttr(activeTitle)}">\n${escapeForFraming(ctx.activeNote.content)}\n</active-note>`,
  ];

  for (const note of ctx.linkedNotes) {
    const title = note.path.split("/").pop()?.replace(/\.md$/, "") ?? note.path;
    const score = note.score.toFixed(2);
    const annotation = note.annotation ?? "";

    if (note.summaryOnly && annotation) {
      parts.push(
        `<context title="${escapeAttr(title)}" score="${score}" depth="${note.depth}" annotation="${escapeAttr(annotation)}" summary-only="true">${escapeForFraming(annotation)}</context>`
      );
    } else {
      const annotationAttr = annotation ? ` annotation="${escapeAttr(annotation)}"` : "";
      parts.push(
        `<context title="${escapeAttr(title)}" score="${score}" depth="${note.depth}"${annotationAttr}>\n${escapeForFraming(note.content)}\n</context>`
      );
    }
  }

  return parts.join("\n\n");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Defang only the framing tags so a malicious note can't break out of its
// <context>/<active-note> block. We deliberately don't escape all `<`/`>`
// (that would mangle legitimate markdown with HTML embeds like <details> or
// <br>). The model still sees the original characters in everything else.
const FRAMING_RX = /<\/?(?:context|active-note|mentioned-note)\b/gi;
export function escapeForFraming(content: string): string {
  return content.replace(FRAMING_RX, (m) => m.replace("<", "&lt;"));
}
