# Layout System

> **Scope:** How the plugin's UI surfaces fit into the Obsidian workspace. **Rendering context:** Client (Obsidian UI) **Last updated:** 2026-05-15

## Overview

ogstack adds four surfaces to the Obsidian workspace: a fixed-position floating bar above the status bar, a right-sidebar view, a status-bar indicator, and a handful of modals. It interacts with the editor exclusively via the Obsidian Editor API (`replaceRange`, `getCursor`, `lastLine`).

## Workspace Integration

### Floating BarChat
- `.gstack-bar2-container` is `position: fixed; bottom: 48px; left: 50%; transform: translateX(-50%)`.
- Width: `min(680px, 88vw)` — adapts to narrow windows.
- Toggled in/out with the `.visible` class (opacity + transform transitions, disabled under `prefers-reduced-motion`).
- The bar lives outside any Obsidian leaf — it does **not** participate in the workspace's resizing logic. Users can have it open over any view.

### Sidebar Leaf
- Registered via `registerView(SIDEBAR_VIEW_TYPE, …)` in `src/main.ts`.
- Toggled via the wand-2 ribbon icon. Opens in the right leaf by default.
- Resizes with the surrounding leaf; the chat textarea and messages region use flex layout to fill available height.

### Status-Bar Indicator
- `addStatusBarItem()` slot. Visible only when a stream is running and the bar isn't.
- Three pulsing dots + a label, scoped by `.gstack-statusbar-streaming`.

### Editor Interaction
- **Inline output (skill runner):** `editor.replaceRange(token, cursor)` per token chunk, advancing the cursor by length / newline count.
- **Insert / Append from bar bubbles:** routes to the **session's** note (looked up via `notePath`), opening it in the active leaf if not already focused, then writing via the same Editor API.
- **New-note output:** `app.vault.create(path, "")` followed by `workspace.getLeaf("split").openFile()`. The output streams into the new editor.

## Sizing Strategy

| Surface | Width | Height |
|---|---|---|
| BarChat container | `min(680px, 88vw)` | content + 320px conversation max-height (scrolls) |
| BarChat textarea | 100% of input row | autoresize, capped 120px |
| ASK answer textarea | 100% | autoresize, capped 80px |
| Sidebar | leaf-controlled | flex column, 100% |
| Suggest popups | matches parent (input row / suggest container) | max-height 240px, scrolls |
| Welcome modal | Obsidian default modal width | content height |
| Import / Manage modals | Obsidian default | content height (scrollable list) |

## Sidebar / Bar Title Tagging

When a session is sticky-agent, the bar's title becomes `<note title> · agent: /<skill name>`. Implemented as two spans for individual styling: the agent tag uses `--color-accent`.

## Modal Behaviors

- All modals extend Obsidian's `Modal`. They auto-fit the workspace and dim the rest of the UI.
- `confirm()` browser dialogs are used for destructive actions (skill deletion) — kept simple to avoid building a custom confirmation modal.

## Data Fetching at Layout Level

- **Settings** are loaded once during `onload()` and held in memory. Updates propagate to active components synchronously via `saveSettings` → `bar?.updateSettings`.
- **Chat sessions** are mirror-loaded once during `onload()` (with one-time migration from legacy `data.json`); per-session reads/writes hit the markdown sidecar on every mutation.
- **Vault metadata** is fetched on-demand per skill run via `app.metadataCache` (link graph) and `cachedRead` (note bodies).

## Related Docs

- docs/architecture/execution-model.md — Main-thread lifecycle.
- docs/ui/component-library.md — Per-component details.
- docs/ui/theming.md — CSS variables and theme integration.
