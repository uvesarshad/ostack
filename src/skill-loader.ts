import { App, Notice } from "obsidian";
import { BUILTIN_SKILL_FILES } from "./builtin-skills";
import { parseYamlFrontmatter } from "./yaml-mini";

export type SkillMode = "oneshot" | "interactive";

export interface Skill {
  name: string;
  description: string;
  output?: "inline" | "new-note"; // undefined = use global settings.outputMode
  maxDepth: number;
  maxTokens: number | null;
  systemPrompt: string;
  mode: SkillMode;          // "interactive" can pause via <ASK>
  autoInsert: boolean;      // true = also auto-insert into note (old behavior)
  agent: boolean;           // true = run via tool-using agent loop (Claude API only)
  allowedTools: string[] | null;  // null/empty = all tools; otherwise allow-list
  maxRounds: number | null; // agent tool-call ceiling; null = use loop default
}

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  output?: string;
  max_depth?: string;
  max_tokens?: string;
  mode?: string;
  auto_insert?: string;
  agent?: string;
  allowed_tools?: string;
  max_rounds?: string;
}

function parseFrontmatter(content: string): { fm: ParsedFrontmatter; body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const parsed = parseYamlFrontmatter(match[1]);
  if (!parsed) return null;

  // Pick only the keys our schema knows about. Unknown keys are ignored
  // (forward-compat) rather than failing the parse.
  const fm: ParsedFrontmatter = {};
  const known: Array<keyof ParsedFrontmatter> = [
    "name", "description", "output", "max_depth", "max_tokens",
    "mode", "auto_insert", "agent", "allowed_tools", "max_rounds",
  ];
  for (const k of known) {
    if (k in parsed) (fm as Record<string, string>)[k] = parsed[k];
  }

  return { fm, body: match[2].trim() };
}

export function parseSKILL(content: string, sourcePath: string): Skill | null {
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    console.warn(`gstack: malformed SKILL.md frontmatter at ${sourcePath}`);
    return null;
  }

  const { fm, body } = parsed;

  if (!fm.name || !fm.description) {
    console.warn(`gstack: SKILL.md at ${sourcePath} missing required fields (name, description)`);
    return null;
  }

  const output: "inline" | "new-note" | undefined =
    fm.output === "new-note" ? "new-note" : fm.output === "inline" ? "inline" : undefined;
  const maxDepth = fm.max_depth ? parseInt(fm.max_depth, 10) : 3;
  const maxTokens = fm.max_tokens ? parseInt(fm.max_tokens, 10) : null;
  const mode: SkillMode = fm.mode === "interactive" ? "interactive" : "oneshot";
  const autoInsert = fm.auto_insert === "true";
  const agent = fm.agent === "true";
  const allowedTools = parseAllowedTools(fm.allowed_tools);
  const maxRoundsRaw = fm.max_rounds ? parseInt(fm.max_rounds, 10) : NaN;
  const maxRounds = !isNaN(maxRoundsRaw) && maxRoundsRaw > 0
    ? Math.min(maxRoundsRaw, 40) // hard ceiling — no runaway loops via frontmatter
    : null;

  return {
    name: fm.name,
    description: fm.description,
    output,
    maxDepth: isNaN(maxDepth) ? 3 : maxDepth,
    maxTokens: maxTokens !== null && !isNaN(maxTokens) ? maxTokens : null,
    systemPrompt: body,
    mode,
    autoInsert,
    agent,
    allowedTools,
    maxRounds,
  };
}

function parseAllowedTools(raw: string | undefined): string[] | null {
  if (!raw) return null;
  // Accept "[a, b, c]" or "a, b, c"
  const stripped = raw.trim().replace(/^\[|\]$/g, "");
  if (!stripped) return null;
  const tools = stripped.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  return tools.length > 0 ? tools : null;
}

export interface RegisteredCommand {
  skillName: string;
  commandId: string;
  unregister: () => void;
}

export interface SkillLoader {
  loadAll(): Promise<void>;
  getRegisteredSkills(): Map<string, Skill>;
  destroy(): void;
}

type CommandRegistrar = (skill: Skill) => (() => void);

export const CUSTOM_SKILLS_FOLDER = "_agent";
const DEBOUNCE_MS = 300;

export function createSkillLoader(
  app: App,
  pluginDir: string,
  registrar: CommandRegistrar
): SkillLoader {
  const registeredSkills = new Map<string, Skill>();
  const unregisterFns = new Map<string, () => void>();
  const builtinNames = new Set<string>();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function debounce(fn: () => void) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fn, DEBOUNCE_MS);
  }

  function registerSkill(skill: Skill, isBuiltin: boolean, sourcePath?: string): void {
    if (!isBuiltin && builtinNames.has(skill.name)) {
      const where = sourcePath ? ` (from ${sourcePath})` : "";
      new Notice(
        `ogstack: custom skill "${skill.name}"${where} conflicts with a built-in skill — rename it in the SKILL.md frontmatter`
      );
      return;
    }
    const unregister = registrar(skill);
    registeredSkills.set(skill.name, skill);
    unregisterFns.set(skill.name, unregister);
    if (isBuiltin) builtinNames.add(skill.name);
  }

  function unregisterSkill(name: string): void {
    const fn = unregisterFns.get(name);
    if (fn) fn();
    registeredSkills.delete(name);
    unregisterFns.delete(name);
  }

  function loadBuiltinSkills(): void {
    for (const { name, content } of BUILTIN_SKILL_FILES) {
      const skill = parseSKILL(content, name);
      if (skill) registerSkill(skill, true);
    }
  }

  async function loadCustomSkills(): Promise<void> {
    const folderExists = await app.vault.adapter.exists(CUSTOM_SKILLS_FOLDER);
    if (!folderExists) {
      try {
        await app.vault.adapter.mkdir(CUSTOM_SKILLS_FOLDER);
      } catch {
        // folder may have been created concurrently
      }
      return;
    }

    const { files, folders } = await app.vault.adapter.list(CUSTOM_SKILLS_FOLDER);

    // Flat style: _agent/skill_name.md
    for (const filePath of files.filter((f: string) => f.endsWith(".md"))) {
      try {
        const content = await app.vault.adapter.read(filePath);
        const skill = parseSKILL(content, filePath);
        if (skill) registerSkill(skill, false, filePath);
      } catch {
        console.warn(`ogstack: could not read skill at ${filePath}`);
      }
    }

    // Folder style: _agent/skill_name/SKILL.md
    for (const folderPath of folders) {
      const skillFilePath = `${folderPath}/SKILL.md`;
      try {
        if (!(await app.vault.adapter.exists(skillFilePath))) continue;
        const content = await app.vault.adapter.read(skillFilePath);
        const skill = parseSKILL(content, skillFilePath);
        if (skill) registerSkill(skill, false, skillFilePath);
      } catch {
        console.warn(`ogstack: could not read skill at ${skillFilePath}`);
      }
    }
  }

  async function reloadCustomSkills(): Promise<void> {
    // Unregister all custom skills (keep builtins)
    for (const [name] of registeredSkills) {
      if (!builtinNames.has(name)) unregisterSkill(name);
    }
    await loadCustomSkills();
  }

  const watcherRef = app.vault.on("create", (file) => {
    if (isCustomSkillFile(file.path)) {
      debounce(() => reloadCustomSkills());
    }
  });

  const modifyRef = app.vault.on("modify", (file) => {
    if (isCustomSkillFile(file.path)) {
      debounce(() => reloadCustomSkills());
    }
  });

  const deleteRef = app.vault.on("delete", (file) => {
    if (isCustomSkillFile(file.path)) {
      debounce(() => reloadCustomSkills());
    }
  });

  const renameRef = app.vault.on("rename", (_file, _oldPath) => {
    debounce(() => reloadCustomSkills());
  });

  return {
    async loadAll() {
      loadBuiltinSkills();
      await loadCustomSkills();
    },
    getRegisteredSkills() {
      return registeredSkills;
    },
    destroy() {
      if (debounceTimer) clearTimeout(debounceTimer);
      // @ts-ignore — Obsidian's EventRef is unsubscribed via offref
      app.vault.offref(watcherRef);
      // @ts-ignore
      app.vault.offref(modifyRef);
      // @ts-ignore
      app.vault.offref(deleteRef);
      // @ts-ignore
      app.vault.offref(renameRef);
    },
  };
}

function isCustomSkillFile(path: string): boolean {
  if (!path.startsWith(CUSTOM_SKILLS_FOLDER + "/")) return false;
  const rel = path.slice(CUSTOM_SKILLS_FOLDER.length + 1);
  // Flat: _agent/skill.md (no subdirectory)
  if (!rel.includes("/") && rel.endsWith(".md")) return true;
  // Folder-based: _agent/skill_name/SKILL.md
  if (rel.endsWith("/SKILL.md")) return true;
  return false;
}
