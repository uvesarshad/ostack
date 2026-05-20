import { Notice, Plugin, requestUrl } from "obsidian";
import { GETTING_STARTED_NOTE } from "./getting-started";
import { BarChat } from "./bar-chat";
import { ChatStore } from "./chat-store";
import { DEFAULT_SETTINGS, GStackSettings, GStackSettingTab } from "./settings";
import { OgstackSidebarView, SIDEBAR_VIEW_TYPE } from "./sidebar-view";
import { createSkillLoader, CUSTOM_SKILLS_FOLDER, Skill, SkillLoader } from "./skill-loader";
import { runSkill } from "./skill-runner";
import { WelcomeModal } from "./welcome-modal";
import { ImportSkillModal } from "./import-skill-modal";
import { ManageSkillsModal } from "./manage-skills-modal";

export default class GStackPlugin extends Plugin {
  settings: GStackSettings = { ...DEFAULT_SETTINGS };
  chatStore: ChatStore = new ChatStore(this);
  private skillLoader: SkillLoader | null = null;
  bar: BarChat | null = null;
  private statusIndicator: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.chatStore.load();

    this.addSettingTab(new GStackSettingTab(this.app, this));
    this.registerView(SIDEBAR_VIEW_TYPE, (leaf) => new OgstackSidebarView(leaf, this));
    this.addRibbonIcon("wand-2", "ogstack", () => this.toggleSidebar());

    const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;

    this.skillLoader = createSkillLoader(
      this.app,
      pluginDir,
      (skill: Skill) => {
        const commandId = skill.name;
        this.addCommand({
          id: commandId,
          name: `gs: ${titleCase(skill.name)}`,
          callback: () => this.runSkillFromCommand(skill),
        });
        return () => {
          (this.app as unknown as { commands: { removeCommand(id: string): void } })
            .commands.removeCommand(`${this.manifest.id}:${commandId}`);
        };
      }
    );

    await this.skillLoader.loadAll();

    const pluginData = (await this.loadData()) as Record<string, unknown> | null;

    // Fetch gstack skills from GitHub on first install and write them to the
    // vault so the recursive loader picks them up. Runs in the background —
    // doesn't block plugin load. Silently skips on network failure.
    if (!pluginData?.gstackSkillsWritten) {
      void this.fetchAndWriteGstackSkills(pluginData);
    }

    const freshData = pluginData;

    // Status bar indicator (shows pulse when AI streams in background)
    this.statusIndicator = this.addStatusBarItem();
    this.statusIndicator.style.display = "none";

    // New conversation bar
    this.bar = new BarChat({
      app: this.app,
      settings: this.settings,
      getSkills: () => this.getSkills(),
      chatStore: this.chatStore,
      onStreamingChange: (streaming, label) => {
        if (streaming && this.bar && !this.bar.isVisible()) {
          this.showStreamingIndicator(label);
        } else {
          this.hideStreamingIndicator();
        }
      },
    });

    this.addCommand({
      id: "show-ai-bar",
      name: "Show AI bar",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "Space" }],
      callback: () => this.bar?.focusInput(),
    });

    // Fallback window-level listener. Obsidian's command hotkey for Ctrl+Shift+Space
    // is often eaten by Windows IME (or other plugins) before the keymap sees it,
    // so we also bind at the DOM level. Auto-unbound on plugin unload.
    this.registerDomEvent(window, "keydown", (evt: KeyboardEvent) => {
      const isMod = evt.ctrlKey || evt.metaKey;
      const keyIsSpace = evt.code === "Space" || evt.key === " " || evt.key === "Spacebar";
      if (isMod && evt.shiftKey && !evt.altKey && keyIsSpace) {
        evt.preventDefault();
        evt.stopPropagation();
        this.bar?.focusInput();
      }
    });

    this.addCommand({
      id: "import-skill",
      name: "Import skill from GitHub",
      callback: () => {
        new ImportSkillModal(this.app, () => {
          this.skillLoader?.loadAll();
        }).open();
      },
    });

    this.addCommand({
      id: "manage-skills",
      name: "Manage installed skills",
      callback: () => {
        new ManageSkillsModal(this.app, () => {
          this.skillLoader?.loadAll();
        }).open();
      },
    });

    // Show welcome modal on first install, AND drop a getting-started note
    // into the vault so the new user has a persistent, openable reference
    // (the modal closes; the note stays).
    if (!freshData?.hasSeenWelcome) {
      await this.createGettingStartedNote();
      new WelcomeModal(this.app, this).open();
    }
  }

  // Write `Welcome to ogstack.md` at the vault root the first time the plugin
  // loads. Idempotent — if the file already exists (re-installed, user kept
  // their old vault) we don't overwrite their copy. After write, opens the
  // note in the active leaf so the user immediately sees something useful.
  private async createGettingStartedNote(): Promise<void> {
    const fileName = "Welcome to ogstack.md";
    const exists = await this.app.vault.adapter.exists(fileName);
    if (exists) return;
    try {
      await this.app.vault.create(fileName, GETTING_STARTED_NOTE);
      const file = this.app.vault.getAbstractFileByPath(fileName);
      if (file && "extension" in file) {
        await this.app.workspace.getLeaf(false).openFile(file as import("obsidian").TFile);
      }
    } catch {
      // If creation fails (read-only vault, name collision via race, …) we
      // skip silently — the welcome modal still surfaces the same info.
    }
  }

  private async fetchAndWriteGstackSkills(existingData: Record<string, unknown> | null): Promise<void> {
    const OWNER = "garrytan";
    const REPO = "gstack";
    const BRANCH = "main";
    const RESERVED = new Set(["research", "plan", "campaign", "outline", "review"]);
    const base = `${CUSTOM_SKILLS_FOLDER}/gstack`;

    try {
      // Fetch repo tree
      const treeRes = await requestUrl({
        url: `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`,
        headers: { "User-Agent": "ogstack-plugin", "Accept": "application/vnd.github.v3+json" },
      });
      const tree = treeRes.json as { tree?: Array<{ type: string; path: string }> };
      if (!tree.tree) return;

      const skillPaths = tree.tree.filter(
        (e) =>
          e.type === "blob" &&
          e.path.endsWith("/SKILL.md") &&
          !e.path.startsWith("test/") &&
          e.path !== "SKILL.md"
      ).map((e) => e.path);

      if (!await this.app.vault.adapter.exists(base)) {
        try { await this.app.vault.adapter.mkdir(base); } catch { /* concurrent */ }
      }

      let written = 0;
      // Fetch in serial to be polite; background so startup isn't delayed.
      for (const p of skillPaths) {
        try {
          const res = await requestUrl({
            url: `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${p}`,
          });
          const content = res.text;
          const nameMatch = content.match(/^---\r?\n[\s\S]*?^name:\s*(.+?)\s*$/m);
          if (!nameMatch) continue;
          const name = nameMatch[1].trim();
          if (RESERVED.has(name)) continue;
          if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(name)) continue;

          const dir = `${base}/${name}`;
          if (!await this.app.vault.adapter.exists(dir)) {
            try { await this.app.vault.adapter.mkdir(dir); } catch { /* concurrent */ }
          }
          const file = `${dir}/SKILL.md`;
          if (!await this.app.vault.adapter.exists(file)) {
            await this.app.vault.adapter.write(file, content);
            written++;
          }
        } catch {
          // skip individual skill fetch failures
        }
      }

      await this.saveData({ ...existingData, gstackSkillsWritten: true });
      if (written > 0) {
        this.skillLoader?.loadAll();
        new Notice(`ogstack: ${written} gstack skills installed to _agent/gstack/`);
      }
    } catch {
      // Network unavailable — silently skip. Will retry on next install.
    }
  }

  onunload(): void {
    this.skillLoader?.destroy();
    this.bar?.destroy();
  }

  getSkills(): Map<string, Skill> {
    return this.skillLoader?.getRegisteredSkills() ?? new Map();
  }

  private async runSkillFromCommand(skill: Skill): Promise<void> {
    // Skills with auto_insert and oneshot mode → also stream into note via legacy runner
    // Default: route to the new bar conversation surface
    if (skill.autoInsert && skill.mode !== "interactive") {
      await runSkill(skill, this.app, this.settings, this.bar ?? undefined);
      return;
    }
    if (this.bar) {
      await this.bar.runSkill(skill);
    }
  }

  showStreamingIndicator(label: string): void {
    if (!this.statusIndicator) return;
    this.statusIndicator.style.display = "";
    this.statusIndicator.empty();
    const wrap = this.statusIndicator.createSpan({ cls: "gstack-statusbar-streaming" });
    wrap.createSpan({ cls: "dot" });
    wrap.createSpan({ cls: "dot" });
    wrap.createSpan({ cls: "dot" });
    wrap.createSpan({ text: ` ${label}` });
  }

  hideStreamingIndicator(): void {
    if (!this.statusIndicator) return;
    this.statusIndicator.style.display = "none";
    this.statusIndicator.empty();
  }

  private async toggleSidebar(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
    if (existing.length > 0) {
      existing[0].detach();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async openChatWithMessage(message: string): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    const notePath = activeFile?.path ?? "";
    const noteTitle = activeFile?.basename ?? "Chat";

    let leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
    if (leaves.length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
        leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
      }
    }

    const view = leaves[0]?.view as OgstackSidebarView | undefined;
    if (view) {
      await view.openForNote(notePath, noteTitle);
    }

    void message;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.bar?.updateSettings(this.settings);
  }
}

function titleCase(s: string): string {
  return s.split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
