# LLM Providers

> **Scope:** Details the integration with external AI services. **Rendering context:** Isomorphic **Last updated:** 2026-05-14

## Overview

ogstack supports multiple LLM providers through a common interface. Each provider handles its own authentication, request formatting, and stream parsing.

## Supported Providers

### Claude (src/providers/claude.ts)
- Method: Native fetch() with SSE.
- Configuration: Requires an Anthropic API Key.
- Note: Uses a 120s timeout and an AbortController for request cancellation.

### OpenAI (src/providers/openai.ts)
- Method: Native fetch() with SSE.
- Configuration: Requires an OpenAI API Key.
- Note: Supports GPT-4o and GPT-3.5 models.

### Gemini (src/providers/gemini.ts)
- Method: Native fetch() with SSE.
- Configuration: Requires a Google AI Studio API Key.
- Note: Used by default for the Context Scout (gemini-2.0-flash-lite).

### Ollama (src/providers/ollama.ts)
- Method: Obsidian's requestUrl() utility.
- Configuration: Requires a host URL (default: http://localhost:11434).
- Note: Currently uses non-streaming requests (stream: false) and returns the full response at once due to localhost/CORS constraints in some environments.

## Provider Interface

All providers must implement the LLMProvider interface defined in src/providers/provider-interface.ts, which requires a stream() method that returns an AsyncGenerator of strings.

## Related Docs

- docs/architecture/data-flow.md — How the SkillRunner chooses and calls a provider.
- docs/infra/environment.md — For API key environment variable names.
