import { App, Modal } from "obsidian";
import type GStackPlugin from "./main";

export class WelcomeModal extends Modal {
  constructor(app: App, private plugin: GStackPlugin) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("gstack-welcome");

    contentEl.createEl("div", { text: "✦", cls: "gstack-welcome-icon" });
    contentEl.createEl("h2", { text: "Welcome to ogstack" });
    contentEl.createEl("p", {
      text: "Vault-aware AI skills for Obsidian. Your linked notes become the context automatically.",
      cls: "gstack-welcome-sub",
    });

    const sections: Array<{ heading: string; items: string[] }> = [
      {
        heading: "Getting started",
        items: [
          "Go to Settings → ogstack and add your API key (Claude, OpenAI, or Gemini).",
          "Open any note with linked notes and press the ✦ bar at the bottom.",
          "Type / to pick a skill, or ask anything in free text.",
        ],
      },
      {
        heading: "Built-in skills",
        items: [
          "/research — synthesises linked notes into a structured brief",
          "/plan — drafts a project or sprint plan from your goals",
          "/campaign — turns product and audience notes into a campaign",
          "/outline — builds a document outline from linked research",
          "/review — editorial critique of the active note",
        ],
      },
      {
        heading: "Chat sidebar",
        items: [
          "Click the ✦ wand icon in the left ribbon to open the chat panel.",
          "Type @ to reference a specific note and pull its content into context.",
          "Chat history is saved per note — come back anytime.",
        ],
      },
      {
        heading: "Custom skills",
        items: [
          "Drop a SKILL.md file into .gstack/skills/your-skill/ inside your vault.",
          "It registers as a live /command within 2 seconds — no restart needed.",
        ],
      },
    ];

    for (const { heading, items } of sections) {
      contentEl.createEl("h4", { text: heading, cls: "gstack-welcome-heading" });
      const ul = contentEl.createEl("ul", { cls: "gstack-welcome-list" });
      for (const item of items) {
        ul.createEl("li", { text: item });
      }
    }

    const footer = contentEl.createDiv({ cls: "gstack-welcome-footer" });
    const btn = footer.createEl("button", { text: "Get started", cls: "gstack-welcome-btn" });
    btn.addEventListener("click", async () => {
      const data = ((await this.plugin.loadData()) as Record<string, unknown> | null) ?? {};
      data.hasSeenWelcome = true;
      await this.plugin.saveData(data);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
