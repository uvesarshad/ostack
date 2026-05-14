import { App, TFile } from "obsidian";
import { GStackSettings } from "./settings";
import { ScoredFile, VaultContext } from "./context-builder";
import { getScoutProvider } from "./providers/provider-interface";

export interface ScoutResult {
  path: string;
  score: number;
  annotation: string;
}

const SCOUT_CANDIDATE_CAP = 50;
const SCOUT_PREVIEW_CHARS = 200;
const SCOUT_TIMEOUT_MS = 8_000;

export async function scoutContext(
  candidates: ScoredFile[],
  ctx: VaultContext,
  app: App,
  settings: GStackSettings
): Promise<ScoutResult[] | null> {
  const topCandidates = candidates.slice(0, SCOUT_CANDIDATE_CAP);
  if (topCandidates.length === 0) return null;

  const activeTitle = ctx.activeNote.path.split("/").pop()?.replace(/\.md$/, "") ?? ctx.activeNote.path;
  const activePreview = ctx.activeNote.content.slice(0, SCOUT_PREVIEW_CHARS);

  const candidateList = topCandidates
    .map((c, i) => {
      const title = c.file.path.split("/").pop()?.replace(/\.md$/, "") ?? c.file.path;
      const preview = (ctx.linkedNotes.find((n) => n.path === c.file.path)?.content ?? "").slice(0, SCOUT_PREVIEW_CHARS);
      return `${i + 1}. "${title}" — ${preview || "[no preview]"}`;
    })
    .join("\n");

  const systemPrompt = `You are a relevance scorer. The user is working on a note titled "${activeTitle}".
Active note preview: ${activePreview}

Below are candidate linked notes. Score each for relevance to the active note on a scale of 0.0 to 1.0 and provide a one-line annotation.

Return ONLY a JSON array with this exact structure:
[{"path": "<exact path>", "score": <0.0-1.0>, "annotation": "<one line>"}]

Candidate notes:
${candidateList}

Paths for reference:
${topCandidates.map((c) => `${topCandidates.indexOf(c) + 1}. ${c.file.path}`).join("\n")}`;

  const provider = getScoutProvider(settings);

  let raceResult: string | null;
  try {
    raceResult = await Promise.race([
      collectStream(provider, systemPrompt),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SCOUT_TIMEOUT_MS)),
    ]);
  } catch {
    return null; // provider threw → fall back to metadata-only scoring
  }

  if (raceResult === null) return null;

  try {
    const jsonMatch = raceResult.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as ScoutResult[];
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (r) => typeof r.path === "string" && typeof r.score === "number" && typeof r.annotation === "string"
    );
  } catch {
    return null;
  }
}

async function collectStream(
  provider: { stream(req: { systemPrompt: string; userMessage: string }): AsyncGenerator<string, void, unknown> },
  systemPrompt: string
): Promise<string> {
  let result = "";
  for await (const chunk of provider.stream({
    systemPrompt,
    userMessage: "Score the candidate notes now.",
  })) {
    result += chunk;
  }
  return result;
}

export function applyScoutResults(
  ctx: VaultContext,
  scoutResults: ScoutResult[],
  highScoreThreshold = 0.5
): VaultContext {
  const scoreMap = new Map(scoutResults.map((r) => [r.path, r]));

  const updatedNotes = ctx.linkedNotes.map((note) => {
    const scout = scoreMap.get(note.path);
    if (!scout) return note;

    return {
      ...note,
      score: scout.score,
      annotation: `Scout: ${scout.annotation}`,
      summaryOnly: scout.score < highScoreThreshold,
    };
  });

  updatedNotes.sort((a, b) => b.score - a.score);

  return { ...ctx, linkedNotes: updatedNotes };
}
