import type { Skill } from "./skill-loader";

export interface ProgressReporter {
  setRunning(message: string): void;
  setDone(message?: string): void;
  setError(message: string): void;
  destroy(): void;
}

interface InputModeConfig {
  mode: "input";
  skills: Map<string, Skill>;
  onSkillRun: (skill: Skill) => void;
  onFreeQuery: (text: string) => void;
  onClose: () => void;
}

interface ProgressModeConfig {
  mode: "progress";
}

export type FloatingInputConfig = InputModeConfig | ProgressModeConfig;

export class FloatingInput implements ProgressReporter {
  private wrap: HTMLElement;
  private panel: HTMLElement;
  private inputWrap: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private suggestEl: HTMLElement | null = null;
  private statusEl: HTMLElement;
  private selectedIdx = -1;
  private filteredSkills: Skill[] = [];
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private onSkillRun: ((s: Skill) => void) | null = null;

  constructor(config: FloatingInputConfig) {
    this.wrap = document.createElement("div");
    this.wrap.className = config.mode === "input" ? "gstack-fi-backdrop" : "gstack-fi-progress-wrap";

    if (config.mode === "input") {
      this.onSkillRun = config.onSkillRun;
      this.wrap.addEventListener("click", (e) => {
        if (e.target === this.wrap) config.onClose();
      });
    }

    this.panel = document.createElement("div");
    this.panel.className = "gstack-fi-panel";
    this.wrap.appendChild(this.panel);

    if (config.mode === "input") {
      this.buildInputUI(config);
    }

    this.statusEl = document.createElement("div");
    this.statusEl.className = "gstack-fi-status";
    this.statusEl.style.display = "none";
    this.panel.appendChild(this.statusEl);

    document.body.appendChild(this.wrap);

    if (config.mode === "input") {
      this.renderSuggestions([...config.skills.values()].slice(0, 6));
      this.inputEl?.focus();
    }
  }

  private buildInputUI(config: InputModeConfig): void {
    this.inputWrap = document.createElement("div");
    this.inputWrap.className = "gstack-fi-input-wrap";

    const icon = document.createElement("span");
    icon.className = "gstack-fi-icon";
    icon.textContent = "✦";
    this.inputWrap.appendChild(icon);

    this.inputEl = document.createElement("input");
    this.inputEl.className = "gstack-fi-input";
    this.inputEl.type = "text";
    this.inputEl.placeholder = "Ask ogstack or type /command…";
    this.inputEl.addEventListener("input", () => this.onInput(config));
    this.inputEl.addEventListener("keydown", (e) => this.onKeydown(e, config));
    this.inputWrap.appendChild(this.inputEl);

    const esc = document.createElement("kbd");
    esc.className = "gstack-fi-esc";
    esc.textContent = "esc";
    this.inputWrap.appendChild(esc);

    this.panel.appendChild(this.inputWrap);

    this.suggestEl = document.createElement("div");
    this.suggestEl.className = "gstack-fi-suggestions";
    this.panel.appendChild(this.suggestEl);
  }

  private onInput(config: InputModeConfig): void {
    const val = this.inputEl?.value ?? "";
    if (val.startsWith("/")) {
      const q = val.slice(1).toLowerCase();
      const matched = [...config.skills.values()].filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      );
      this.renderSuggestions(matched);
    } else {
      this.renderSuggestions([]);
    }
    this.selectedIdx = -1;
  }

  private onKeydown(e: KeyboardEvent, config: InputModeConfig): void {
    if (e.key === "Escape") { e.preventDefault(); config.onClose(); return; }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.selectedIdx = Math.min(this.selectedIdx + 1, this.filteredSkills.length - 1);
      this.updateSelection();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      this.selectedIdx = Math.max(this.selectedIdx - 1, -1);
      this.updateSelection();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const val = this.inputEl?.value.trim() ?? "";
      if (this.selectedIdx >= 0 && this.filteredSkills[this.selectedIdx]) {
        config.onSkillRun(this.filteredSkills[this.selectedIdx]);
      } else if (val.startsWith("/")) {
        const skill = config.skills.get(val.slice(1));
        if (skill) config.onSkillRun(skill);
      } else if (val) {
        config.onFreeQuery(val);
      }
    }
  }

  private renderSuggestions(skills: Skill[]): void {
    if (!this.suggestEl) return;
    this.filteredSkills = skills;
    this.suggestEl.innerHTML = "";

    if (skills.length === 0) {
      this.suggestEl.classList.remove("visible");
      return;
    }

    this.suggestEl.classList.add("visible");
    skills.forEach((skill, i) => {
      const item = document.createElement("div");
      item.className = "gstack-fi-suggest-item" + (i === this.selectedIdx ? " selected" : "");

      const name = document.createElement("span");
      name.className = "gstack-fi-suggest-name";
      name.textContent = `/${skill.name}`;

      const desc = document.createElement("span");
      desc.className = "gstack-fi-suggest-desc";
      desc.textContent = skill.description;

      item.appendChild(name);
      item.appendChild(desc);
      item.addEventListener("mouseenter", () => { this.selectedIdx = i; this.updateSelection(); });
      item.addEventListener("click", () => this.onSkillRun?.(skill));
      this.suggestEl!.appendChild(item);
    });
  }

  private updateSelection(): void {
    this.suggestEl?.querySelectorAll(".gstack-fi-suggest-item").forEach((el, i) => {
      el.classList.toggle("selected", i === this.selectedIdx);
    });
  }

  setRunning(message: string): void {
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    if (this.inputWrap) this.inputWrap.style.display = "none";
    if (this.suggestEl) this.suggestEl.classList.remove("visible");
    this.statusEl.style.display = "flex";
    this.statusEl.className = "gstack-fi-status loading";
    this.statusEl.innerHTML = `<div class="gstack-fi-spinner"></div><span>${message}</span>`;
  }

  setDone(message = "done ✓"): void {
    this.statusEl.className = "gstack-fi-status done";
    this.statusEl.innerHTML = `<span class="gstack-fi-check">✓</span><span>${message}</span>`;
    this.hideTimer = setTimeout(() => this.destroy(), 2000);
  }

  setError(message: string): void {
    this.statusEl.className = "gstack-fi-status error";
    this.statusEl.innerHTML = `<span class="gstack-fi-x">✕</span><span>${message}</span>`;
    this.wrap.addEventListener("click", () => this.destroy(), { once: true });
    this.hideTimer = setTimeout(() => this.destroy(), 5000);
  }

  destroy(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.wrap.remove();
  }
}
