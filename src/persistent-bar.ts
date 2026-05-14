import type { Skill } from "./skill-loader";
import { ProgressReporter } from "./floating-input";

export interface PersistentBarConfig {
  skills: Map<string, Skill>;
  onSkillRun: (skill: Skill) => void;
  onFreeQuery: (text: string) => void;
}

type BarState = "idle" | "running" | "done" | "error";

export class PersistentBar implements ProgressReporter {
  private container: HTMLElement;
  private pill: HTMLElement;
  private shimmer: HTMLElement;
  private inputWrap: HTMLElement;
  private inputEl: HTMLInputElement;
  private hintEl: HTMLElement;
  private statusWrap: HTMLElement;
  private statusSpinner: HTMLElement;
  private statusText: HTMLElement;
  private popup: HTMLElement;

  private state: BarState = "idle";
  private filteredSkills: Skill[] = [];
  private selectedIdx = -1;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private config: PersistentBarConfig;

  constructor(config: PersistentBarConfig) {
    this.config = config;

    // ── Outer container (fixed, centred) ──────────────────────
    this.container = document.createElement("div");
    this.container.className = "gstack-bar-container";

    // ── Suggestions popup (appears above the pill) ────────────
    this.popup = document.createElement("div");
    this.popup.className = "gstack-bar-popup";
    this.popup.style.display = "none";
    this.container.appendChild(this.popup);

    // ── Pill ──────────────────────────────────────────────────
    this.pill = document.createElement("div");
    this.pill.className = "gstack-bar-pill";

    // Shimmer overlay (animated while running)
    this.shimmer = document.createElement("div");
    this.shimmer.className = "gstack-bar-shimmer";
    this.pill.appendChild(this.shimmer);

    // Icon
    const icon = document.createElement("span");
    icon.className = "gstack-bar-icon";
    icon.textContent = "✦";
    this.pill.appendChild(icon);

    // Input row
    this.inputWrap = document.createElement("div");
    this.inputWrap.className = "gstack-bar-input-wrap";

    this.inputEl = document.createElement("input");
    this.inputEl.className = "gstack-bar-input";
    this.inputEl.type = "text";
    this.inputEl.placeholder = "Ask ogstack or /command…";
    this.inputEl.addEventListener("input", () => this.handleInput());
    this.inputEl.addEventListener("keydown", (e) => this.handleKeydown(e));
    this.inputEl.addEventListener("focus", () => this.onFocus());
    this.inputEl.addEventListener("blur", () => setTimeout(() => this.onBlur(), 150));

    this.hintEl = document.createElement("span");
    this.hintEl.className = "gstack-bar-hint";
    this.hintEl.textContent = "/ commands";

    this.inputWrap.appendChild(this.inputEl);
    this.inputWrap.appendChild(this.hintEl);
    this.pill.appendChild(this.inputWrap);

    // Status row (visible while running/done/error)
    this.statusWrap = document.createElement("div");
    this.statusWrap.className = "gstack-bar-status-wrap";

    this.statusSpinner = document.createElement("div");
    this.statusSpinner.className = "gstack-bar-spinner";

    this.statusText = document.createElement("span");
    this.statusText.className = "gstack-bar-status-text";

    this.statusWrap.appendChild(this.statusSpinner);
    this.statusWrap.appendChild(this.statusText);
    this.pill.appendChild(this.statusWrap);

    this.container.appendChild(this.pill);
    document.body.appendChild(this.container);

    // Start hidden — shows only when a skill runs or explicitly invoked
    this.setState("idle");
  }

  show(): void {
    this.container.classList.add("visible");
  }

  hide(): void {
    this.container.classList.remove("visible");
    // Reset internal state after CSS transition finishes
    setTimeout(() => this.reset(), 250);
  }

  focusInput(): void {
    this.show();
    this.inputEl.focus();
  }

  // ── Input handling ──────────────────────────────────────────

  private onFocus(): void {
    this.pill.classList.add("focused");
    this.hintEl.style.display = "none";
    if (!this.inputEl.value) {
      this.showAllSkills();
    }
  }

  private onBlur(): void {
    this.pill.classList.remove("focused");
    this.hintEl.style.display = "";
    this.hidePopup();
  }

  private handleInput(): void {
    const val = this.inputEl.value;
    if (val.startsWith("/")) {
      const q = val.slice(1).toLowerCase();
      const matched = [...this.config.skills.values()].filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      );
      this.renderPopup(matched);
    } else if (val === "") {
      this.showAllSkills();
    } else {
      this.hidePopup();
    }
    this.selectedIdx = -1;
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      this.inputEl.blur();
      this.hidePopup();
      if (this.state === "idle") this.hide();
      return;
    }
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
      const val = this.inputEl.value.trim();
      if (this.selectedIdx >= 0 && this.filteredSkills[this.selectedIdx]) {
        this.runSkill(this.filteredSkills[this.selectedIdx]);
      } else if (val.startsWith("/")) {
        const skill = this.config.skills.get(val.slice(1));
        if (skill) this.runSkill(skill);
      } else if (val) {
        this.hidePopup();
        this.inputEl.value = "";
        this.config.onFreeQuery(val);
      }
    }
  }

  private runSkill(skill: Skill): void {
    this.hidePopup();
    this.inputEl.value = "";
    this.config.onSkillRun(skill);
  }

  private showAllSkills(): void {
    this.renderPopup([...this.config.skills.values()]);
  }

  private renderPopup(skills: Skill[]): void {
    this.filteredSkills = skills;
    this.popup.innerHTML = "";

    if (skills.length === 0) {
      this.hidePopup();
      return;
    }

    this.popup.style.display = "block";
    skills.forEach((skill, i) => {
      const item = document.createElement("div");
      item.className = "gstack-bar-popup-item" + (i === this.selectedIdx ? " selected" : "");

      const name = document.createElement("span");
      name.className = "gstack-bar-popup-name";
      name.textContent = `/${skill.name}`;

      const desc = document.createElement("span");
      desc.className = "gstack-bar-popup-desc";
      desc.textContent = skill.description;

      item.appendChild(name);
      item.appendChild(desc);
      item.addEventListener("mousedown", (e) => {
        e.preventDefault(); // prevent blur
        this.runSkill(skill);
      });
      item.addEventListener("mouseenter", () => {
        this.selectedIdx = i;
        this.updateSelection();
      });
      this.popup.appendChild(item);
    });
  }

  private updateSelection(): void {
    this.popup.querySelectorAll(".gstack-bar-popup-item").forEach((el, i) => {
      el.classList.toggle("selected", i === this.selectedIdx);
    });
  }

  private hidePopup(): void {
    this.popup.style.display = "none";
    this.filteredSkills = [];
    this.selectedIdx = -1;
  }

  // ── State transitions ───────────────────────────────────────

  private setState(state: BarState): void {
    this.state = state;
    this.pill.className = `gstack-bar-pill ${state}`;

    const isRunning = state === "running";
    this.inputWrap.style.opacity = isRunning ? "0" : "1";
    this.inputWrap.style.pointerEvents = isRunning ? "none" : "";
    this.statusWrap.style.opacity = state === "idle" ? "0" : "1";
    this.statusWrap.style.pointerEvents = state === "idle" ? "none" : "";
    this.statusSpinner.style.display = isRunning ? "" : "none";
  }

  setRunning(message: string): void {
    if (this.resetTimer) { clearTimeout(this.resetTimer); this.resetTimer = null; }
    this.hidePopup();
    this.statusText.textContent = message;
    this.show();
    this.setState("running");
  }

  setDone(message = "done ✓"): void {
    this.statusText.textContent = message;
    this.setState("done");
    this.resetTimer = setTimeout(() => this.hide(), 2200);
  }

  setError(message: string): void {
    this.statusText.textContent = message;
    this.setState("error");
    this.resetTimer = setTimeout(() => this.hide(), 5000);
  }

  private reset(): void {
    this.resetTimer = null;
    this.inputEl.value = "";
    this.setState("idle");
  }

  updateSkills(skills: Map<string, Skill>): void {
    this.config = { ...this.config, skills };
  }

  destroy(): void {
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.container.remove();
  }
}
