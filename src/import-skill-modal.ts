import { App, Modal, requestUrl } from "obsidian";
import { parseSKILL, Skill } from "./skill-loader";

const AGENT_FOLDER = "_agent";

// Skill names become path segments under _agent/. Restrict to a safe charset so a
// malicious frontmatter value like "../../.obsidian/plugins/ogstack/data" can't
// overwrite arbitrary files via vault.adapter.write.
const SKILL_NAME_RX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/;

export function isSafeSkillName(name: string): boolean {
  if (typeof name !== "string") return false;
  if (!SKILL_NAME_RX.test(name)) return false;
  if (name === "." || name === "..") return false;
  return true;
}

// File basenames (case-insensitive) to skip when scanning a repo
const SKIP_BASENAMES = new Set([
  "readme", "license", "licence", "contributing", "changelog",
  "code_of_conduct", "security", "support", "authors", "notice",
  "history", "todo", "roadmap",
]);

function githubUrlToRaw(url: string): string | null {
  const blobMatch = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/);
  if (blobMatch) return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}`;
  if (url.startsWith("https://raw.githubusercontent.com/")) return url;
  return null;
}

function repoOwnerFromUrl(url: string): string | null {
  const m = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:[/?#]|$)/);
  if (!m) return null;
  return m[1];
}

// Classify the pasted URL so the single "Import" button can route to the
// right path. A repo root URL (no /blob/, optionally with .git) routes to
// scanRepo; a single-file URL routes to importFile.
export type GhUrlKind = "file" | "repo" | "unknown";
export function classifyGithubUrl(url: string): GhUrlKind {
  if (!url) return "unknown";
  if (githubUrlToRaw(url)) return "file";
  if (repoOwnerFromUrl(url)) return "repo";
  return "unknown";
}

function isLikelySkillPath(path: string): boolean {
  const filename = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const basename = filename.replace(/\.md$/, "");
  if (SKIP_BASENAMES.has(basename)) return false;
  if (filename === "skill.md") return true;
  return filename.endsWith(".md");
}

interface GitTreeEntry { path: string; type: string; }

interface DiscoveredSkill {
  path: string;
  name: string;
  description: string;
  rawContent: string;
}

export class ImportSkillModal extends Modal {
  private onImported: () => void;

  constructor(app: App, onImported: () => void) {
    super(app);
    this.onImported = onImported;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("gstack-import-modal");

    contentEl.createEl("h2", { text: "Import skills" });
    contentEl.createEl("p", {
      text: "Paste a GitHub repo URL to scan and pick skills, a single-file URL (…/blob/…) to import one skill directly, or use the local picker to upload SKILL.md files from disk.",
      cls: "gstack-import-desc",
    });

    const urlInput = contentEl.createEl("input", {
      cls: "gstack-import-url",
      attr: { type: "text", placeholder: "https://github.com/user/repo  or  …/blob/main/skill.md" },
    });

    const status = contentEl.createEl("p", { cls: "gstack-import-status" });
    const previewEl = contentEl.createEl("div", { cls: "gstack-import-preview" });

    const btnRow = contentEl.createEl("div", { cls: "gstack-import-btn-row" });
    const btnImport = btnRow.createEl("button", { text: "Import", cls: "gstack-import-btn mod-cta" });

    // Local file picker — alternative to GitHub for users who already have
    // SKILL.md files on disk (the repo got 404, manual download, vendored, …).
    const btnPickFiles = btnRow.createEl("button", { text: "Import local files…", cls: "gstack-import-btn" });
    btnPickFiles.title = "Pick one or more SKILL.md files from disk";
    const fileInput = btnRow.createEl("input", {
      attr: { type: "file", multiple: "true", accept: ".md,text/markdown" },
      cls: "gstack-hidden",
    }) as HTMLInputElement;
    btnPickFiles.addEventListener("click", () => fileInput.click());

    const setStatus = (msg: string): void => { status.textContent = msg; };

    const updateBtnLabel = (): void => {
      const kind = classifyGithubUrl(urlInput.value.trim());
      btnImport.textContent =
        kind === "file" ? "Import this file" :
        kind === "repo" ? "Scan repo for skills" :
        "Import";
    };
    urlInput.addEventListener("input", updateBtnLabel);

    fileInput.addEventListener("change", async () => {
      const files = Array.from(fileInput.files ?? []);
      if (files.length === 0) return;
      btnImport.disabled = true;
      btnPickFiles.disabled = true;
      previewEl.empty();
      setStatus(`Reading ${files.length} file${files.length === 1 ? "" : "s"}…`);
      try {
        const imported = await this.importLocalFiles(files);
        if (imported.ok === 0 && imported.errors.length > 0) {
          setStatus(`No skills imported. ${imported.errors[0]}`);
        } else {
          const tail = imported.errors.length > 0 ? ` · ${imported.errors.length} skipped` : "";
          setStatus(`✓ Imported ${imported.ok} skill${imported.ok === 1 ? "" : "s"} → ${AGENT_FOLDER}/${tail}`);
          this.onImported();
          if (imported.errors.length === 0) setTimeout(() => this.close(), 1800);
        }
        if (imported.errors.length > 0) {
          // Render the rejected list so the user can see WHY a file didn't import.
          const errList = previewEl.createDiv({ cls: "gstack-import-error-list" });
          errList.createEl("div", { text: "Skipped files:", cls: "gstack-import-error-header" });
          for (const e of imported.errors) errList.createEl("div", { text: `• ${e}`, cls: "gstack-import-error-item" });
        }
      } finally {
        btnImport.disabled = false;
        btnPickFiles.disabled = false;
        fileInput.value = "";  // allow re-picking the same file after a fix
      }
    });

    btnImport.addEventListener("click", async () => {
      const url = urlInput.value.trim();
      if (!url) { setStatus("Paste a GitHub URL first."); return; }

      const kind = classifyGithubUrl(url);
      if (kind === "unknown") {
        setStatus("Error: Not a recognized GitHub URL. Expected https://github.com/owner/repo or …/blob/branch/path.md");
        return;
      }

      btnImport.disabled = true;
      previewEl.empty();

      if (kind === "file") {
        setStatus("Fetching…");
        try {
          const name = await this.importFile(url);
          setStatus(`✓ Imported "${name}" → ${AGENT_FOLDER}/${name}.md`);
          this.onImported();
          setTimeout(() => this.close(), 1800);
        } catch (e: unknown) {
          setStatus(`Error: ${(e as Error).message}`);
          btnImport.disabled = false;
        }
        return;
      }

      // repo
      setStatus("Fetching repo tree…");
      try {
        const skills = await this.scanRepo(url, setStatus);
        if (skills.length === 0) {
          setStatus("No valid skill files found (looked for .md files with name + description frontmatter).");
          btnImport.disabled = false;
          return;
        }
        setStatus(`Found ${skills.length} skill${skills.length === 1 ? "" : "s"} — select which to import:`);
        this.renderPreview(previewEl, skills, setStatus);
      } catch (e: unknown) {
        setStatus(`Error: ${(e as Error).message}`);
        btnImport.disabled = false;
      }
    });
  }

  private renderPreview(
    container: HTMLElement,
    skills: DiscoveredSkill[],
    setStatus: (s: string) => void
  ): void {
    container.empty();
    const selected = new Set(skills.map((s) => s.name));

    const list = container.createDiv({ cls: "gstack-import-list" });
    for (const skill of skills) {
      const row = list.createDiv({ cls: "gstack-import-item" });
      const checkbox = row.createEl("input", { attr: { type: "checkbox" }, cls: "gstack-import-check" }) as HTMLInputElement;
      checkbox.checked = true;
      const info = row.createDiv({ cls: "gstack-import-item-info" });
      info.createEl("div", { text: skill.name, cls: "gstack-import-item-name" });
      info.createEl("div", { text: skill.description, cls: "gstack-import-item-desc" });
      info.createEl("div", { text: skill.path, cls: "gstack-import-item-path" });

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(skill.name);
        else selected.delete(skill.name);
      });
    }

    const actions = container.createDiv({ cls: "gstack-import-actions" });
    const importBtn = actions.createEl("button", {
      text: `Import selected (${skills.length})`,
      cls: "gstack-import-btn mod-cta",
    });
    importBtn.addEventListener("click", async () => {
      importBtn.disabled = true;
      const toImport = skills.filter((s) => selected.has(s.name));
      setStatus(`Importing ${toImport.length}…`);
      await this.ensureAgentFolder();
      let count = 0;
      let rejected = 0;
      for (const sk of toImport) {
        if (!isSafeSkillName(sk.name)) {
          rejected++;
          continue;
        }
        try {
          await this.app.vault.adapter.write(`${AGENT_FOLDER}/${sk.name}.md`, sk.rawContent);
          count++;
        } catch {
          // skip on write failure
        }
      }
      const tail = rejected > 0 ? ` (${rejected} rejected — unsafe name)` : "";
      setStatus(`✓ Imported ${count} skill${count === 1 ? "" : "s"} into ${AGENT_FOLDER}/${tail}`);
      this.onImported();
      setTimeout(() => this.close(), 1800);
    });
  }

  private async ensureAgentFolder(): Promise<void> {
    if (!(await this.app.vault.adapter.exists(AGENT_FOLDER))) {
      await this.app.vault.adapter.mkdir(AGENT_FOLDER);
    }
  }

  // Read SKILL.md files the user picked from disk, parse each, and copy into
  // _agent/. Returns counts so the caller can render a useful status line.
  private async importLocalFiles(files: File[]): Promise<{ ok: number; errors: string[] }> {
    await this.ensureAgentFolder();
    let ok = 0;
    const errors: string[] = [];

    for (const file of files) {
      try {
        const text = await file.text();
        const skill = parseSKILL(text, file.name);
        if (!skill) {
          errors.push(`${file.name} — missing required \`name\` / \`description\` frontmatter`);
          continue;
        }
        if (!isSafeSkillName(skill.name)) {
          errors.push(`${file.name} — unsafe skill name "${skill.name}"`);
          continue;
        }
        await this.app.vault.adapter.write(`${AGENT_FOLDER}/${skill.name}.md`, text);
        ok++;
      } catch (e: unknown) {
        errors.push(`${file.name} — ${(e as Error).message}`);
      }
    }
    return { ok, errors };
  }

  private async importFile(url: string): Promise<string> {
    const rawUrl = githubUrlToRaw(url);
    if (!rawUrl) throw new Error("Not a recognized GitHub URL");

    const res = await requestUrl({ url: rawUrl });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const content = res.text;
    const skill = parseSKILL(content, rawUrl);
    if (!skill) throw new Error("File has no valid skill frontmatter (name + description required)");

    if (!isSafeSkillName(skill.name)) {
      throw new Error(
        `Skill name "${skill.name}" is unsafe — must match [a-zA-Z0-9_-], 1-40 chars, no slashes or dots.`
      );
    }

    await this.ensureAgentFolder();
    await this.app.vault.adapter.write(`${AGENT_FOLDER}/${skill.name}.md`, content);
    return skill.name;
  }

  private async scanRepo(repoUrl: string, setStatus: (s: string) => void): Promise<DiscoveredSkill[]> {
    const ownerRepo = repoOwnerFromUrl(repoUrl);
    if (!ownerRepo) throw new Error("Not a GitHub repo URL");

    // We `throw` here without retry — `requestUrl` doesn't actually throw on
    // non-2xx (it resolves with .status); some Obsidian versions throw on
    // network errors though, so wrap defensively.
    let repoRes: Awaited<ReturnType<typeof requestUrl>>;
    try {
      repoRes = await requestUrl({ url: `https://api.github.com/repos/${ownerRepo}` });
    } catch (e: unknown) {
      throw new Error(`Network error reaching GitHub — check your connection. (${(e as Error).message})`);
    }
    if (repoRes.status === 404) {
      throw new Error(
        `Repo "${ownerRepo}" doesn't exist on GitHub (404). Double-check the owner and repo name in the URL — typos in either are the most common cause. If the repo is private, the import tool can't reach it.`
      );
    }
    if (repoRes.status === 403) {
      // GitHub unauthenticated rate limit is 60/hr per IP. Surface that clearly.
      const reset = repoRes.headers?.["x-ratelimit-reset"];
      const resetHint = reset
        ? ` Resets at ${new Date(Number(reset) * 1000).toLocaleTimeString()}.`
        : "";
      throw new Error(`GitHub API rate-limit hit (403).${resetHint} Try again later, or import the SKILL.md files manually via "Import local files…".`);
    }
    if (repoRes.status !== 200) {
      throw new Error(`GitHub API returned ${repoRes.status} for ${ownerRepo}. Try again, or use "Import local files…".`);
    }
    const defaultBranch: string = repoRes.json.default_branch ?? "main";

    const treeRes = await requestUrl({
      url: `https://api.github.com/repos/${ownerRepo}/git/trees/${defaultBranch}?recursive=1`,
    });
    if (treeRes.status !== 200) {
      throw new Error(`Could not list files in ${ownerRepo}@${defaultBranch} (status ${treeRes.status}). The branch may be empty or renamed.`);
    }
    const entries: GitTreeEntry[] = treeRes.json.tree ?? [];

    const candidates = entries
      .filter((e) => e.type === "blob" && isLikelySkillPath(e.path))
      .map((e) => e.path);

    const discovered: DiscoveredSkill[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const filePath = candidates[i];
      setStatus(`Scanning ${i + 1}/${candidates.length}: ${filePath}`);
      try {
        const rawUrl = `https://raw.githubusercontent.com/${ownerRepo}/${defaultBranch}/${filePath}`;
        const res = await requestUrl({ url: rawUrl });
        if (res.status !== 200) continue;

        const skill: Skill | null = parseSKILL(res.text, filePath);
        if (!skill) continue;
        if (!isSafeSkillName(skill.name)) continue;

        discovered.push({
          path: filePath,
          name: skill.name,
          description: skill.description,
          rawContent: res.text,
        });
      } catch {
        // skip files that fail to fetch
      }
    }

    return discovered;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
