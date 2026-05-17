# Rendering Strategy

> Scope: Client rendering context, Electron environment integration, and caching layers.
> Rendering context: Client
> Project tier: 3
> Last updated: 2026-05-17

## Overview
ogstack operates entirely as a client-side (CSR) plugin inside the Obsidian desktop application. As Obsidian is an Electron app, ogstack runs in a hybrid browser-Node.js environment, allowing it to render directly to the user's screen using standard web technologies while invoking native system child processes and accessing the local file system.

## Hybrid Client Runtime
Because all code executes inside the local Obsidian application:
- UI components: HTML elements, textareas, and active editor layers are constructed dynamically through the browser DOM API. No server-side rendering (SSR), Static Site Generation (SSG), or Incremental Static Revalidation (ISR) is performed.
- Node.js APIs: The application can import Node.js core modules. The CLI provider, cli.ts, imports child_process to spawn external LLM CLI binaries on the host system.

## Caching Strategy
- Vault Note Reads: To optimize performance and prevent excessive disk I/O when assembling context across hundreds of notes, the plugin reads note content using app.vault.cachedRead. This calls Obsidian's internal memory cache instead of executing a raw disk fetch unless the file was recently modified.
- Linked Note Cache: When traversing the vault note graph, the context engine reads from app.metadataCache.resolvedLinks. This holds pre-computed forward links for all files, allowing instant BFS note graph mapping without reading note content.
- Chat Store Memory Cache: Chat sessions are loaded into memory on startup and kept in sync with local Markdown sidecar files on disk, ensuring fast retrieval when switching between active editor tabs.

## Update Triggers
- When the rendering wrapper shifts from pure DOM to a UI framework (such as React or Svelte).
- When new caching rules or metadata caches are added to context-builder.ts.
- When native Node.js integrations are changed or disabled.

AGENT UPDATE: update docs/architecture/rendering-strategy.md when rendering models or cache architectures change.

## Related Docs
- docs/overview.md — Tech stack.
- docs/architecture/data-flow.md — Data piping.
