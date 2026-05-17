# Layout and Theming Styling

> Scope: Custom CSS layouts, global themes variable mapping, and animation safety.
> Rendering context: Client
> Project tier: 3
> Last updated: 2026-05-17

## Overview
ogstack styles its interface through a single global styles.css file at the root. The layout adapts to standard dark and light community themes by leveraging Obsidian's core CSS custom properties, ensuring that colors, borders, and typography harmonize perfectly without manual styling overrides.

## Theme Variable Integration
Custom selectors in styles.css inherit variables from Obsidian's layout stylesheet:
- Primary Backgrounds: Elements like gstack-bar2-card use --background-primary and --background-secondary to maintain visual alignment with the active editor pane.
- Typography Colors: Text blocks use --text-normal, --text-muted, and --text-accent to preserve visual hierarchy.
- Interactive Highlights: Buttons and focused inputs inherit --interactive-accent for brand styling.
- Border Styling: Containers use --border-color and --border-width to draw separating dividers.

## Key Selectors in styles.css
- gstack-bar2-container: Controls the full-screen absolute viewport overlay housing the floating input box.
- gstack-bar2-card: The centered UI panel encapsulating the command bar, scrollable messages list, and inputs.
- gstack-bar2-msg: Base class for bubbles, styled differently for user roles and assistant roles using role modifiers.
- gstack-bar2-popup: The popup box holding filtered suggestion listings.
- gstack-statusbar-streaming: Status bar block that displays animated pulsing dots during asynchronous background runs.

## Motion and Animation Safety
To support accessibility settings, custom keyframe animations—such as slide-in entries for gstack-bar2-card or background pulsing for status indicators—are wrapped within media queries. Animations execute only when prefers-reduced-motion is set to no-preference, ensuring a stable visual state for motion-sensitive profiles.

## Update Triggers
- When new CSS classes are introduced to the UI in styles.css.
- When Obsidian theme variables are renamed or custom stylesheets are split.
- When the motion policy or keyframe animations are refactored.

AGENT UPDATE: update docs/ui/theming.md when selectors are added or custom stylesheet properties are altered.

## Related Docs
- docs/overview.md — Tech stack.
- docs/ui/component-library.md — Markup components.
- docs/ui/layout-system.md — Layout leaf containers.
