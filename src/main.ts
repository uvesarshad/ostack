import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, GStackSettings, GStackSettingTab } from "./settings";
import { createSkillLoader, Skill, SkillLoader } from "./skill-loader";
import { runSkill } from "./skill-runner";

export default class GStackPlugin extends Plugin {
  settings: GStackSettings = { ...DEFAULT_SETTINGS };
  private skillLoader: SkillLoader | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new GStackSettingTab(this.app, this));

    // Resolve plugin directory for built-in skills
    const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;

    this.skillLoader = createSkillLoader(
      this.app,
      pluginDir,
      (skill: Skill) => {
        const commandId = skill.name;
        const displayName = `gs: ${titleCase(skill.name)}`;

        this.addCommand({
          id: commandId,
          name: displayName,
          editorCallback: (_editor, _view) => {
            runSkill(skill, this.app, this.settings);
          },
        });

        return () => {
          (this.app as unknown as { commands: { removeCommand(id: string): void } }).commands.removeCommand(
            `${this.manifest.id}:${commandId}`
          );
        };
      }
    );

    await this.skillLoader.loadAll();
  }

  onunload(): void {
    this.skillLoader?.destroy();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
