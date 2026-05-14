import { App, Modal, requestUrl } from "obsidian";
import { parseSKILL, Skill } from "./skill-loader";

const AGENT_FOLDER = "_agent";

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
  const m = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!m) return null;
  return m[1].replace(/\.git$/, "");
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

    contentEl.createEl("h2", { text: "Import skills from GitHub" });
    contentEl.createEl("p", {
      text: "Paste a GitHub file URL to import one skill, or a repo URL to scan for skills and import them selectively.",
      cls: "gstack-import-desc",
    });

    const urlInput = contentEl.createEl("input", {
      cls: "gstack-import-url",
      attr: { type: "text", placeholder: "https://github.com/user/repo  or  …/blob/main/skill.md" },
    });

    const status = contentEl.createEl("p", { cls: "gstack-import-status" });
    const previewEl = contentEl.createEl("div", { cls: "gstack-import-preview" });

    const btnRow = contentEl.createEl("div", { cls: "gstack-import-btn-row" });
    const btnFile = btnRow.createEl("button", { text: "Import this file", cls: "gstack-import-btn" });
    const btnScan = btnRow.createEl("button", { text: "Scan repo for skills", cls: "gstack-import-btn mod-cta" });

    const setStatus = (msg: string): void => { status.textContent = msg; };

    btnFile.addEventListener("click", async () => {
      const url = urlInput.value.trim();
      if (!url) { setStatus("Paste a URL first."); return; }
      btnFile.disabled = true;
      setStatus("Fetching…");
      try {
        const name = await this.importFile(url);
        setStatus(`✓ Imported "${name}" → ${AGENT_FOLDER}/${name}.md`);
        this.onImported();
        setTimeout(() => this.close(), 1800);
      } catch (e: unknown) {
        setStatus(`Error: ${(e as Error).message}`);
        btnFile.disabled = false;
      }
    });

    btnScan.addEventListener("click", async () => {
      const url = urlInput.value.trim();
      if (!url) { setStatus("Paste a repo URL first."); return; }
      btnScan.disabled = true;
      btnFile.disabled = true;
      previewEl.empty();
      setStatus("Fetching repo tree…");
      try {
        const skills = await this.scanRepo(url, setStatus);
        if (skills.length === 0) {
          setStatus("No valid skill files found (looked for .md files with name + description frontmatter).");
          btnScan.disabled = false;
          btnFile.disabled = false;
          return;
        }
        setStatus(`Found ${skills.length} skill${skills.length === 1 ? "" : "s"} — select which to import:`);
        this.renderPreview(previewEl, skills, setStatus);
      } catch (e: unknown) {
        setStatus(`Error: ${(e as Error).message}`);
        btnScan.disabled = false;
        btnFile.disabled = false;
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
      for (const sk of toImport) {
        try {
          await this.app.vault.adapter.write(`${AGENT_FOLDER}/${sk.name}.md`, sk.rawContent);
          count++;
        } catch {
          // skip on write failure
        }
      }
      setStatus(`✓ Imported ${count} skill${count === 1 ? "" : "s"} into ${AGENT_FOLDER}/`);
      this.onImported();
      setTimeout(() => this.close(), 1800);
    });
  }

  private async ensureAgentFolder(): Promise<void> {
    if (!(await this.app.vault.adapter.exists(AGENT_FOLDER))) {
      await this.app.vault.adapter.mkdir(AGENT_FOLDER);
    }
  }

  private async importFile(url: string): Promise<string> {
    const rawUrl = githubUrlToRaw(url);
    if (!rawUrl) throw new Error("Not a recognized GitHub URL");

    const res = await requestUrl({ url: rawUrl });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const content = res.text;
    const skill = parseSKILL(content, rawUrl);
    if (!skill) throw new Error("File has no valid skill frontmatter (name + description required)");

    await this.ensureAgentFolder();
    await this.app.vault.adapter.write(`${AGENT_FOLDER}/${skill.name}.md`, content);
    return skill.name;
  }

  private async scanRepo(repoUrl: string, setStatus: (s: string) => void): Promise<DiscoveredSkill[]> {
    const ownerRepo = repoOwnerFromUrl(repoUrl);
    if (!ownerRepo) throw new Error("Not a GitHub repo URL");

    const repoRes = await requestUrl({ url: `https://api.github.com/repos/${ownerRepo}` });
    if (repoRes.status === 404) throw new Error(`Repo "${ownerRepo}" not found or is private`);
    if (repoRes.status !== 200) throw new Error(`GitHub API error ${repoRes.status}`);
    const defaultBranch: string = repoRes.json.default_branch ?? "main";

    const treeRes = await requestUrl({
      url: `https://api.github.com/repos/${ownerRepo}/git/trees/${defaultBranch}?recursive=1`,
    });
    if (treeRes.status !== 200) throw new Error(`Could not list repo files (${treeRes.status})`);
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
