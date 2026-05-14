import { App, Notice } from "obsidian";

export interface Skill {
  name: string;
  description: string;
  output?: "inline" | "new-note"; // undefined = use global settings.outputMode
  maxDepth: number;
  maxTokens: number | null;
  systemPrompt: string;
}

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  output?: string;
  max_depth?: string;
  max_tokens?: string;
}

function parseFrontmatter(content: string): { fm: ParsedFrontmatter; body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const fm: ParsedFrontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim() as keyof ParsedFrontmatter;
    const value = line.slice(colonIdx + 1).trim();
    fm[key] = value;
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

  return {
    name: fm.name,
    description: fm.description,
    output,
    maxDepth: isNaN(maxDepth) ? 3 : maxDepth,
    maxTokens: maxTokens !== null && !isNaN(maxTokens) ? maxTokens : null,
    systemPrompt: body,
  };
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

const CUSTOM_SKILLS_FOLDER = ".gstack/skills";
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

  function registerSkill(skill: Skill, isBuiltin: boolean): void {
    if (!isBuiltin && builtinNames.has(skill.name)) {
      new Notice(`gstack: custom skill "${skill.name}" conflicts with a built-in skill — rename it`);
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

  async function loadBuiltinSkills(): Promise<void> {
    // Built-in skills are bundled as files adjacent to main.js in the plugin directory
    const skillNames = ["research", "campaign", "plan", "outline", "review"];
    for (const name of skillNames) {
      const path = `${pluginDir}/skills/${name}/SKILL.md`;
      try {
        const content = await app.vault.adapter.read(path);
        const skill = parseSKILL(content, path);
        if (skill) registerSkill(skill, true);
      } catch {
        console.warn(`gstack: could not load built-in skill "${name}" from ${path}`);
      }
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

    const { files } = await app.vault.adapter.list(CUSTOM_SKILLS_FOLDER);
    const skillFiles = files.filter((f: string) => f.endsWith("/SKILL.md"));

    for (const filePath of skillFiles) {
      try {
        const content = await app.vault.adapter.read(filePath);
        const skill = parseSKILL(content, filePath);
        if (skill) registerSkill(skill, false);
      } catch {
        console.warn(`gstack: could not read custom skill at ${filePath}`);
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
      await loadBuiltinSkills();
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
  return path.startsWith(CUSTOM_SKILLS_FOLDER) && path.endsWith("SKILL.md");
}
