# Theming

> **Scope:** Describes the styling approach and Obsidian variable usage. **Rendering context:** Client (Obsidian UI) **Last updated:** 2026-05-14

## Overview

ogstack follows a "native-first" styling philosophy. It relies heavily on Obsidian's internal CSS variables to ensure that the plugin looks consistent across all Obsidian themes (Light, Dark, and custom themes).

## Styling Strategy

### CSS Variables
- The plugin uses standard Obsidian variables like --text-normal, --background-primary, --interactive-accent, and --font-interface.
- AGENT AVOID: Do not hardcode hex colors or specific font families. Always use variables to support community themes.

### Global Styles (styles.css)
- contains selectors for custom components like the FloatingInput container, the PersistentBar, and the SidebarView lists.
- Uses flexbox and grid layouts for responsive behavior within narrow sidebar leaves.

## Dark Mode Support

- Dark mode is handled automatically by Obsidian's theme system. Since the plugin uses native variables, it inherits the correct colors when the user switches modes.

## Related Docs

- docs/ui/component-library.md — For the components affected by these styles.
- docs/modules/ui-system.md — For the functional overview of the UI.
