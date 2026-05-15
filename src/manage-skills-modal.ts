import { App, Modal, Notice } from "obsidian";
import { parseSKILL } from "./skill-loader";

const AGENT_FOLDER = "_agent";

interface InstalledSkill {
  // Filesystem path to the SKILL.md (or flat skill.md)
  filePath: string;
  // If folder-based, the parent folder we should remove on delete
  folderPath: string | null;
  name: string;
  description: string;
  agent: boolean;
}

export class ManageSkillsModal extends Modal {
  private onChanged: () => void;

  constructor(app: App, onChanged: () => void) {
    super(app);
    this.onChanged = onChanged;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass("gstack-manage-skills-modal");
    contentEl.createEl("h2", { text: "Installed skills" });
    contentEl.createEl("p", {
      text: `Custom skills under ${AGENT_FOLDER}/. Built-in skills (research, plan, etc.) aren't listed — they're embedded in the plugin.`,
      cls: "gstack-manage-skills-desc",
    });

    const status = contentEl.createEl("p", { cls: "gstack-manage-skills-status" });
    const listEl = contentEl.createDiv({ cls: "gstack-manage-skills-list" });

    const skills = await this.scan();
    if (skills.length === 0) {
      status.textContent = `No custom skills installed. Drop a SKILL.md into ${AGENT_FOLDER}/ or import one via "ogstack: Import skill from GitHub".`;
      return;
    }

    for (const skill of skills) {
      this.renderRow(listEl, skill, async () => {
        await this.deleteSkill(skill);
        listEl.empty();
        const remaining = await this.scan();
        if (remaining.length === 0) {
          status.textContent = `No custom skills installed.`;
          return;
        }
        for (const s of remaining) {
          this.renderRow(listEl, s, async () => {
            await this.deleteSkill(s);
            this.onClose();
            this.onOpen();
          });
        }
      });
    }
  }

  private renderRow(parent: HTMLElement, skill: InstalledSkill, onDelete: () => Promise<void>): void {
    const row = parent.createDiv({ cls: "gstack-manage-skills-item" });
    const info = row.createDiv({ cls: "gstack-manage-skills-info" });
    const nameEl = info.createDiv({ cls: "gstack-manage-skills-name" });
    nameEl.createSpan({ text: skill.name });
    if (skill.agent) {
      nameEl.createSpan({ text: " agent", cls: "gstack-manage-skills-tag" });
    }
    info.createEl("div", { text: skill.description, cls: "gstack-manage-skills-desc-line" });
    info.createEl("div", { text: skill.filePath, cls: "gstack-manage-skills-path" });

    const actions = row.createDiv({ cls: "gstack-manage-skills-actions" });

    const openBtn = actions.createEl("button", { text: "Open", cls: "gstack-manage-skills-btn" });
    openBtn.setAttribute("aria-label", `Open ${skill.name} SKILL.md`);
    openBtn.addEventListener("click", async () => {
      // openLinkText opens by path relative to vault
      this.app.workspace.openLinkText(skill.filePath, "", true);
      this.close();
    });

    const delBtn = actions.createEl("button", { text: "Delete", cls: "gstack-manage-skills-btn mod-warning" });
    delBtn.setAttribute("aria-label", `Delete ${skill.name}`);
    delBtn.addEventListener("click", async () => {
      const confirmed = confirm(
        `Delete skill "${skill.name}"?\n\nThis removes ${skill.folderPath ?? skill.filePath} from your vault. You can't undo this from inside ogstack.`
      );
      if (!confirmed) return;
      delBtn.disabled = true;
      await onDelete();
    });
  }

  private async scan(): Promise<InstalledSkill[]> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(AGENT_FOLDER))) return [];

    const out: InstalledSkill[] = [];
    const { files, folders } = await adapter.list(AGENT_FOLDER);

    // Flat skills
    for (const filePath of files.filter((f: string) => f.endsWith(".md"))) {
      const parsed = await this.tryParse(filePath);
      if (parsed) out.push({ ...parsed, filePath, folderPath: null });
    }
    // Folder-based skills
    for (const folderPath of folders) {
      const skillFilePath = `${folderPath}/SKILL.md`;
      if (!(await adapter.exists(skillFilePath))) continue;
      const parsed = await this.tryParse(skillFilePath);
      if (parsed) out.push({ ...parsed, filePath: skillFilePath, folderPath });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  private async tryParse(filePath: string): Promise<Pick<InstalledSkill, "name" | "description" | "agent"> | null> {
    try {
      const content = await this.app.vault.adapter.read(filePath);
      const skill = parseSKILL(content, filePath);
      if (!skill) return null;
      return { name: skill.name, description: skill.description, agent: skill.agent };
    } catch {
      return null;
    }
  }

  private async deleteSkill(skill: InstalledSkill): Promise<void> {
    const adapter = this.app.vault.adapter;
    try {
      if (skill.folderPath) {
        // Remove the whole folder (SKILL.md + any assets) so user doesn't have
        // a stray empty directory.
        await adapter.rmdir(skill.folderPath, true);
      } else {
        await adapter.remove(skill.filePath);
      }
      new Notice(`ogstack: deleted ${skill.name}`);
      this.onChanged();
    } catch (err) {
      new Notice(`ogstack: could not delete ${skill.name} — ${(err as Error).message}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
