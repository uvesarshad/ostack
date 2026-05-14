import { vi } from "vitest";

export class Plugin {
  app: App;
  manifest: { id: string; name: string };
  constructor() {
    this.app = new App();
    this.manifest = { id: "obsidian-gstack", name: "gstack" };
  }
  addCommand = vi.fn();
  addSettingTab = vi.fn();
  loadData = vi.fn().mockResolvedValue({});
  saveData = vi.fn().mockResolvedValue(undefined);
  registerEvent = vi.fn();
}

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: HTMLElement;
  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = mockEl();
  }
  display = vi.fn();
  hide = vi.fn();
}

export class Setting {
  settingEl: HTMLElement;
  constructor(_containerEl: HTMLElement) {
    this.settingEl = mockEl();
  }
  setName = vi.fn().mockReturnThis();
  setDesc = vi.fn().mockReturnThis();
  setHeading = vi.fn().mockReturnThis();
  addText = vi.fn((cb?: (text: MockTextComponent) => void) => {
    if (cb) cb(new MockTextComponent());
    return this;
  });
  addDropdown = vi.fn((cb?: (dd: MockDropdown) => void) => {
    if (cb) cb(new MockDropdown());
    return this;
  });
  addToggle = vi.fn((cb?: (t: MockToggle) => void) => {
    if (cb) cb(new MockToggle());
    return this;
  });
  addSlider = vi.fn((cb?: (s: MockSlider) => void) => {
    if (cb) cb(new MockSlider());
    return this;
  });
  addButton = vi.fn((cb?: (b: MockButton) => void) => {
    if (cb) cb(new MockButton());
    return this;
  });
  then = vi.fn((cb: (s: Setting) => void) => { cb(this); return this; });
}

class MockTextComponent {
  inputEl: HTMLInputElement;
  constructor() { this.inputEl = mockInput(); }
  setValue = vi.fn().mockReturnThis();
  setPlaceholder = vi.fn().mockReturnThis();
  setType = vi.fn().mockReturnThis();
  onChange = vi.fn().mockReturnThis();
  onChanged = vi.fn().mockReturnThis();
}

class MockDropdown {
  addOption = vi.fn().mockReturnThis();
  addOptions = vi.fn().mockReturnThis();
  setValue = vi.fn().mockReturnThis();
  onChange = vi.fn().mockReturnThis();
}

class MockToggle {
  setValue = vi.fn().mockReturnThis();
  onChange = vi.fn().mockReturnThis();
}

class MockSlider {
  setLimits = vi.fn().mockReturnThis();
  setValue = vi.fn().mockReturnThis();
  onChange = vi.fn().mockReturnThis();
  setDynamicTooltip = vi.fn().mockReturnThis();
}

class MockButton {
  setButtonText = vi.fn().mockReturnThis();
  onClick = vi.fn().mockReturnThis();
  setCta = vi.fn().mockReturnThis();
}

export class Notice {
  constructor(public message: string, public duration?: number) {}
  hide(): void {}
  setMessage(_msg: string): void {}
}

export class App {
  vault: Vault;
  workspace: Workspace;
  metadataCache: MetadataCache;
  commands: { removeCommand: ReturnType<typeof vi.fn> };
  constructor() {
    this.vault = new Vault();
    this.workspace = new Workspace();
    this.metadataCache = new MetadataCache();
    this.commands = { removeCommand: vi.fn() };
  }
}

export class Vault {
  on = vi.fn().mockReturnValue({ id: "mock-event-ref" });
  off = vi.fn();
  offref = vi.fn();
  getAbstractFileByPath = vi.fn();
  getFileByPath = vi.fn();
  read = vi.fn().mockResolvedValue("");
  cachedRead = vi.fn().mockResolvedValue("");
  create = vi.fn().mockResolvedValue({});
  createFolder = vi.fn().mockResolvedValue(undefined);
  adapter = {
    exists: vi.fn().mockResolvedValue(false),
    mkdir: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue(""),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  };
  getFiles = vi.fn().mockReturnValue([]);
}

export class Workspace {
  getActiveFile = vi.fn().mockReturnValue(null);
  getActiveViewOfType = vi.fn().mockReturnValue(null);
  getLeaf = vi.fn().mockReturnValue({ openFile: vi.fn() });
}

export class MetadataCache {
  resolvedLinks: Record<string, Record<string, number>> = {};
  getFileCache = vi.fn().mockReturnValue(null);
}

export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  stat: { mtime: number; ctime: number; size: number };
  parent: { path: string } | null;
  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.extension = this.name.includes(".") ? this.name.split(".").pop() ?? "" : "";
    this.stat = { mtime: Date.now(), ctime: Date.now(), size: 0 };
    this.parent = null;
  }
}

export class MarkdownView {
  editor: Editor;
  file: TFile | null;
  constructor() {
    this.editor = new Editor();
    this.file = null;
  }
}

export class Editor {
  getCursor = vi.fn().mockReturnValue({ line: 0, ch: 0 });
  setCursor = vi.fn();
  replaceRange = vi.fn();
  getValue = vi.fn().mockReturnValue("");
  getLine = vi.fn().mockReturnValue("");
  lineCount = vi.fn().mockReturnValue(1);
}

export const requestUrl = vi.fn().mockResolvedValue({
  status: 200,
  text: "",
  json: {},
  headers: {},
  arrayBuffer: new ArrayBuffer(0),
});

function mockEl(): HTMLElement {
  return {
    createEl: vi.fn().mockReturnValue(mockEl()),
    createDiv: vi.fn().mockReturnValue(mockEl()),
    addClass: vi.fn(),
    removeClass: vi.fn(),
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
    empty: vi.fn(),
    setText: vi.fn(),
    setAttr: vi.fn(),
    innerHTML: "",
    innerText: "",
    style: {},
    appendChild: vi.fn(),
  } as unknown as HTMLElement;
}

function mockInput(): HTMLInputElement {
  return {
    ...mockEl(),
    value: "",
    type: "",
    placeholder: "",
    addEventListener: vi.fn(),
  } as unknown as HTMLInputElement;
}
