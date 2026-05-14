# Security and Authentication

> **Scope:** Describes API key handling and security boundaries. **Rendering context:** Client **Last updated:** 2026-05-14

## Overview

As a local-first Obsidian plugin, ogstack does not manage user accounts. Authentication refers exclusively to the API keys used to communicate with external LLM providers.

## API Key Management

### Storage
- API keys are entered by the user in the plugin settings tab.
- They are stored in plaintext in the .obsidian/plugins/ogstack/data.json file.
- AGENT NOTE: This is the standard pattern for Obsidian plugins (e.g., Copilot, Smart Connections).

### Transmission
- Keys are sent in the Authorization header of the native fetch() requests to the respective provider's API (Anthropic, OpenAI, Google).
- All requests are made over HTTPS to ensure encrypted transmission.

## Security Boundaries

### Local Files
- The plugin has read access to the entire vault but only reads files during context assembly after a user-initiated skill trigger.
- It does not "phone home" or send any vault data to external servers other than the chosen LLM provider.

### CORS and requestUrl
- For localhost providers like Ollama, the plugin uses Obsidian's requestUrl() utility to bypass browser-level CORS restrictions that might otherwise block communication with a local server.

## Related Docs

- docs/api/llm-providers.md — For details on the headers used for each provider.
- docs/api/storage.md — For more on the data.json storage location.
