# Theming

> **Scope:** Styling approach, Obsidian CSS variable usage, accessibility. **Rendering context:** Client (Obsidian UI) **Last updated:** 2026-05-15

## Overview

ogstack follows a "native-first" styling philosophy. It uses Obsidian's CSS custom properties so the plugin looks consistent across Light, Dark, and community themes without per-theme overrides. The entire stylesheet lives in `styles.css` — one file because Obsidian only loads one CSS file per plugin. A section-index comment at the top makes it navigable.

## CSS Variables Used

| Variable | Purpose |
|---|---|
| `--background-primary` | Card / popup backgrounds. |
| `--background-secondary` | Manage-skills item rows. |
| `--background-modifier-border` | Borders on cards, popups, buttons. |
| `--background-modifier-hover` | Hover states on popup items / buttons. |
| `--background-modifier-active-hover` | Selected items in suggest popups. |
| `--background-modifier-error`, `--background-modifier-error-hover` | API-key disclaimer; agent-limit block. |
| `--text-normal`, `--text-muted`, `--text-faint`, `--text-error` | Text fills. |
| `--color-accent`, `--interactive-accent` | Skill name highlights, send button, agent tag. |
| `--color-green`, `--color-yellow`, `--color-red`, `--color-orange` | Test-connection result states, agent-limit border, error indicators. |
| `--radius-s` | Disclaimer / item rounding. |
| `--font-monospace` | Skill file paths in manage-skills modal. |
| `--font-ui-smaller` | Disclaimer / hint text size. |

AGENT AVOID: Do **not** hardcode hex colors or specific font families. Always use variables so community themes work out of the box.

## Animation Catalogue

Defined in `styles.css` at the top:

| Keyframe | Used by |
|---|---|
| `gstack-spin` | `.gstack-fi-spinner` (rotating circle progress overlay) |
| `gstack-pulse` | `.gstack-statusbar-streaming .dot` (three-dot indicator) |

All other surfaces use CSS transitions (`opacity`, `transform`) rather than keyframe animations — kept under 200ms for snap.

## Reduced Motion

A `@media (prefers-reduced-motion: reduce)` block at the bottom of `styles.css` disables both `animation` and `transition` on the chat surfaces and status indicator:

```css
@media (prefers-reduced-motion: reduce) {
  .gstack-bar2-container,
  .gstack-bar2-msg-streaming,
  .gstack-statusbar-streaming .dot,
  .gstack-fi-spinner,
  .gstack-chat-suggest,
  .gstack-bar2-popup,
  .gstack-bar2-popup-item {
    animation: none !important;
    transition: none !important;
  }
}
```

## Accessibility Patterns

| Pattern | Implementation |
|---|---|
| Icon-only buttons | `aria-label` on every send / stop / close / back / delete / open button. |
| Suggest popups | Parent `role="listbox"` + `aria-label`; each item `role="option"` + `aria-selected`. Keyboard nav via arrow keys. |
| Session items | `role="button"` + `tabindex="0"` + Enter/Space activation handler. |
| Status state | `card.dataset.state` exposed as a data attribute (not visual-only) — themes can hook it for custom styles. |

## Light/Dark Mode

Theme switching is fully handled by Obsidian. Because every color comes from a CSS variable, the plugin inherits the correct palette on mode change with no JS work.

The only place hard-coded colors appear is shadow definitions (`rgba(0, 0, 0, …)`), which are tuned to look acceptable in both modes. If a future theme has very pale shadows look heavy, switch them to `var(--background-modifier-cover)` or similar.

## Related Docs

- docs/ui/component-library.md — Components consuming these tokens.
- docs/ui/layout-system.md — Spacing and positioning.
- docs/modules/ui-system.md — Functional overview.
