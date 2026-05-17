# Chat Storage System

> Scope: Persistent Markdown-sidecar storage, frontmatter syntax, message delimiters, and migrations.
> Rendering context: Client
> Project tier: 3
> Last updated: 2026-05-17

## Overview
ogstack stores user conversation histories entirely inside the active Obsidian vault, using a localized markdown-sidecar system managed by ChatStore. Instead of serializing chats into a single massive JSON file or external database, each chat session is written as an individual markdown file. This ensures rapid loading, search visibility, and seamless synchronization.

## Sidecar File Structure
Each chat session is stored inside the vault at the path: _agent/chats/slug__sessionId.md. The file format is structured into a YAML metadata header and a serialized HTML-comment delimited message body.

## YAML Frontmatter Metadata
The file starts and ends with triple hyphens, containing:
- ogstack: chat (identifies the file type for parser verification)
- id: A unique alphanumeric session identifier.
- notePath: The relative vault path of the active note linked to this chat.
- noteTitle: The basename title of the linked active note.
- createdAt: Epoch millisecond timestamp of session creation.
- updatedAt: Epoch millisecond timestamp of last message write.
- agentSkillName: Optional field storing the name of the sticky agent skill driving the conversation loop.

## Message Delimiter Syntax
Messages are separated using custom HTML comments:
- Delimiter: Starts with comment tags: ogstack:msg role=user time=timestamp or role=assistant, immediately followed by a newline.
- Tool Calls block: For assistant turns that perform agentic tool loops, a tools block is appended directly after the message header comment: ogstack:tools, containing a serialized JSON array of tool calls (with id, name, input, output, and isError fields), wrapped in comment tags.
- Message Content: The raw markdown content of the user prompt or assistant response follows, ending with a newline.

## Migration Process
To handle upgrades from v1.0 configuration files, ChatStore implements a migration checker during setup:
- Legacy Data Probe: Scans Obsidian's settings file data.json for the deprecated chatSessions array.
- File Creation: For each legacy session, the store serializes the conversation state, writes the output sidecar markdown file to _agent/chats/, and logs the migration.
- Clean Up: Deletes the chatSessions key from data.json and calls plugin.saveData to shrink the configuration file and protect system memory.

## Parallel Scan Performance
To prevent slow startup times in vaults containing hundreds of conversations, ChatStore scans the chats directory and runs read operations in parallel using Promise.allSettled, avoiding blocking the main thread.

## Update Triggers
- When the YAML frontmatter schema or serialization format changes in chat-store.ts.
- When message delimiters or tool call comment wrappers are modified.
- When directory paths or migration steps are altered.

AGENT UPDATE: update docs/api/storage.md when serialization formats, comment tags, or folder directories change.

## Related Docs
- docs/overview.md — General tech stack.
- docs/state/app-state.md — State management wrappers.
- docs/modules/ui-system.md — Incremental DOM modifications.
