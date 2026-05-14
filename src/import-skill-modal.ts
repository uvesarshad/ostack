import { App, Modal, requestUrl } from "obsidian";
import { parseSKILL } from "./skill-loader";

const AGENT_FOLDER = "_agent";

function githubUrlToRaw(url: string): string | null {
  // https://github.com/user/repo/blob/branch/path/file.md
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

interface GitTreeEntry { path: string; type: string; }

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
      text: "Paste a GitHub file URL to import one skill, or a repo URL to import all skills from that repo.",
      cls: "gstack-import-desc",
    });

    const urlInput = contentEl.createEl("input", {
      cls: "gstack-import-url",
      attr: { type: "text", placeholder: "https://github.com/user/repo  or  …/blob/main/skill.md" },
    });

    const status = contentEl.createEl("p", { cls: "gstack-import-status" });

    const btnRow = contentEl.createEl("div", { cls: "gstack-import-btn-row" });

    const btnFile = btnRow.createEl("button", { text: "Import this file", cls: "gstack-import-btn" });
    const btnRepo = btnRow.createEl("button", { text: "Import all from repo", cls: "gstack-import-btn mod-cta" });

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

    btnRepo.addEventListener("click", async () => {
      const url = urlInput.value.trim();
      if (!url) { setStatus("Paste a repo URL first."); return; }
      btnRepo.disabled = true;
      btnFile.disabled = true;
      setStatus("Fetching repo tree…");
      try {
        const count = await this.importRepo(url, setStatus);
        setStatus(`✓ Imported ${count} skill(s) into ${AGENT_FOLDER}/`);
        this.onImported();
        setTimeout(() => this.close(), 2000);
      } catch (e: unknown) {
        setStatus(`Error: ${(e as Error).message}`);
        btnRepo.disabled = false;
        btnFile.disabled = false;
      }
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

  private async importRepo(repoUrl: string, setStatus: (s: string) => void): Promise<number> {
    const ownerRepo = repoOwnerFromUrl(repoUrl);
    if (!ownerRepo) throw new Error("Not a GitHub repo URL");

    // Resolve default branch
    const repoRes = await requestUrl({ url: `https://api.github.com/repos/${ownerRepo}` });
    if (repoRes.status === 404) throw new Error(`Repo "${ownerRepo}" not found or is private`);
    if (repoRes.status !== 200) throw new Error(`GitHub API error ${repoRes.status}`);
    const defaultBranch: string = repoRes.json.default_branch ?? "main";

    // Fetch full file tree
    const treeRes = await requestUrl({
      url: `https://api.github.com/repos/${ownerRepo}/git/trees/${defaultBranch}?recursive=1`,
    });
    if (treeRes.status !== 200) throw new Error(`Could not list repo files (${treeRes.status})`);
    const entries: GitTreeEntry[] = treeRes.json.tree ?? [];

    // Match: any .md file that parses as a skill
    const mdPaths = entries
      .filter((e) => e.type === "blob" && e.path.endsWith(".md"))
      .map((e) => e.path);

    await this.ensureAgentFolder();

    let count = 0;
    for (const filePath of mdPaths) {
      setStatus(`Importing ${count}/${mdPaths.length}: ${filePath}`);
      try {
        const rawUrl = `https://raw.githubusercontent.com/${ownerRepo}/${defaultBranch}/${filePath}`;
        const res = await requestUrl({ url: rawUrl });
        if (res.status !== 200) continue;

        const skill = parseSKILL(res.text, filePath);
        if (!skill) continue;

        await this.app.vault.adapter.write(`${AGENT_FOLDER}/${skill.name}.md`, res.text);
        count++;
      } catch {
        // skip files that fail
      }
    }

    return count;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
