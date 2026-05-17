# UI Component Library

> Scope: Reusable UI components, modal panels, and interactive elements.
> Rendering context: Client
> Project tier: 3
> Last updated: 2026-05-17

## Overview
ogstack constructs its user interface elements using native HTML DOM nodes and Obsidian UI abstractions. These components are entirely presentational or directly bound to the ChatStore state machine, adjusting layouts dynamically based on streaming events and user actions.

## Modal Dialogs
All modals are built on top of Obsidian's Modal class.
- WelcomeModal: Defined in welcome-modal.ts. Renders a welcome screen on first install to guide the user on API setup, standard slash commands, and folder creation.
- ImportSkillModal: Defined in import-skill-modal.ts. Captures a user-supplied GitHub repository URL, runs an HTTPS fetch to download skill markdown, runs sanitization, writes to _agent/, and triggers a reload.
- ManageSkillsModal: Defined in manage-skills-modal.ts. Renders an interactive table showing custom skills loaded in _agent/, providing single-click delete and open-in-editor operations.

## Interactive Chat Elements
- Suggestion Popup: A floating listbox overlay managed inside bar-chat.ts and sidebar-view.ts. Lists available skills (triggered by slash /) or notes (triggered by at @[[) for quick autocomplete. Uses role="listbox", role="option", and aria-selected for accessibility.
- Actions Panel: A presentational button row appended under completed assistant messages. Contains three standard operations: Insert at cursor (inserts stripped message at editor cursor), Append (appends content at the end of target note), and Copy (saves text to system clipboard).
- Ask UI Panel: Renders clarifying questions wrapped in ASK tags during interactive skill turns. Displays text areas for user answers, blocking further assistant steps until the user clicks Send answers.

## Accessibility Controls
- Screen Reader Labels: Icon-only buttons (such as the Close bar x or Send arrow) are annotated with aria-label.
- Keyboard Navigation: The Suggestion Popup supports keydown captures for arrow navigation and enter to select.
- Motion Controls: Key animations are wrapped in prefers-reduced-motion media query gates inside styles.css to support accessibility profiles.

## Update Triggers
- When a new Modal component is added or an existing modal's input fields change.
- When the markup structure of the Suggestion Popup or Actions Panel is changed.
- When new ARIA roles or keyboard hotkeys are implemented.

AGENT UPDATE: update docs/ui/component-library.md when modal parameters, shared overlays, or buttons change.

## Related Docs
- docs/overview.md — General tech stack.
- docs/ui/layout-system.md — Leaves and view layout.
- docs/ui/theming.md — Stylings and stylesheets.
