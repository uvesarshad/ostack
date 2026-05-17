# UI System

> Scope: Floating command overlays, sidebar panel views, incremental DOM rendering, and editor integrations.
> Rendering context: Client
> Project tier: 3
> Last updated: 2026-05-17

## Overview
The UI System governs how users interact with ogstack inside Obsidian. It manages text input capture, progressive DOM message updates, autocomplete popups, and direct insertion of compiled text back into active editor sheets.

## Key UI Modules
- BarChat: Defined in bar-chat.ts. The floating conversation panel body. Placed absolute-centered on document.body, handling text inputs, tool summaries, actions, and popups.
- OgstackSidebarView: Defined in sidebar-view.ts. The persistent right leaf view providing tab summaries, historical conversations lists, and delete panels.
- MarkdownRenderer: The built-in Obsidian rendering API used to compile Markdown assistant texts into HTML DOM elements when rendering historical bubbles.

## Incremental DOM Rendering
- Input Protection: In early versions, store changes triggered full view clears, wiping out typed user text buffers. To solve this, both BarChat and OgstackSidebarView subscribe to ChatStore and run incremental updates. They append new message bubbles at the bottom of the scroll container while leaving inputs untouched.
- Streaming Text: Streamed text updates are routed to a gstack-bar2-msg-streaming wrapper element. This maintains a live CSS-drawn cursor tail until the provider closes the turn.
- Finalization: Once the turn completes, the raw response is persisted, and the final content (stripped of ASK blocks) is rendered using MarkdownRenderer. Renders action panels (e.g. Insert, Append, Copy buttons) under assistant bubbles.

## Debounced Suggestion Autocomplete
- Triggers: Typings starting with slash / show available skills; typing @[[ filters the vault note index.
- Keyboard Navigation: Keydown listeners capture arrows to navigate items and enter to select.
- Performance Debouncing: For vaults containing thousands of notes, filtering the note index is slow. Typing inputs in both views are throttled with a 70ms debounce timer (suggestDebounceTimer), preventing keystroke jank and maintaining fluid inputs.

## Editor Integrations
- Insert at Cursor: The insertIntoNote method looks up the active editor leaf. If the session is linked to a note file, it opens the note, moves focus to the editor pane, and calls replaceRange to write assistant content at the cursor.
- Append to note: Appends content at the end of the note, creating a separating newline if the note content does not terminate with one.

## Update Triggers
- When new buttons or action panels are added to the conversation views.
- When DOM render algorithms or state listeners are modified.
- When suggestion debouncers or keyboard navigations are altered.

AGENT UPDATE: update docs/modules/ui-system.md when DOM builders, suggestion debouncers, or editor writers are modified.

## Related Docs
- docs/overview.md — Glossary and tech stack.
- docs/ui/component-library.md — Shared UI elements.
- docs/ui/layout-system.md — Leaves and event bindings.
