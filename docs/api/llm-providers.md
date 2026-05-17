# LLM API Providers

> Scope: Streaming APIs, Server-Sent Events (SSE), tool-use pipelines, and secure shell-less CLI executors.
> Rendering context: Client
> Project tier: 3
> Last updated: 2026-05-17

## Overview
ogstack does not load heavyweight external SDKs. Instead, it interacts directly with artificial intelligence APIs using native browser fetch or Obsidian requestUrl. LLM integrations are divided into streaming web providers and local command-line interface (CLI) process adapters.

## Core Provider interface
All providers conform to the contract defined in provider-interface.ts.
- LLMMessage: Type representing message nodes containing user or assistant roles and content strings.
- LLMRequest: The payload container passing system prompts, message arrays, and model slugs.
- LLMProvider: Interface enforcing a stream generator method yielding text tokens.

## Cloud API Providers
- ClaudeProvider: Implements claude.ts. It handles both standard text streams and structured tool-use calls. It parses Server-Sent Events (SSE) from Anthropic, tracking content_block_start, content_block_delta, and content_block_stop. When the model invokes a tool, it accumulates partial json chunks from input_json_delta, parses the merged string, and executes the vault tool.
- OpenAIProvider, GeminiProvider, GrokProvider, and OllamaProvider: Implement openai.ts, gemini.ts, grok.ts, and ollama.ts. They communicate via custom POST requests, buffering streaming chunks into user-facing text updates. Network calls are wrapped in fetchWithRetry to handle temporary rate limits (429 and 503 HTTP status responses) gracefully.

## Safe CLI Subprocess Executors
- CliProvider: Implements cli.ts to interact with local binaries like claude, codex, or gemini CLI.
- Subprocess Hardening: Spawns processes with shell set to false. This prevents command injection vulnerabilities since argument arrays are handed directly to the operating system kernel, completely bypassing shell interpreters.
- Windows Extension probe: On Windows systems, since shell: false does not automatically resolve shell command files, resolveBinary walks the environmental PATH and PATHEXT system settings, locating command extensions like .cmd, .bat, or .exe manually before calling spawn.
- Parameter validation: Before spawning the binary, inputs are checked against SHELL_METACHAR_RX and MODEL_NAME_RX, instantly blocking execution if unsafe characters or whitespaces are found outside quotes.
- JSONL parsing: When calling codex-cli, it buffers stdout chunks and parses individual JSONL lines to extract the assistant agent's streamed response.

## Stream Timeout Controls
Cloud streams combine the user's abort event signal with a hard-coded 120s timeout controller. If a network chunk or SSE stream hangs for more than 120 seconds, the combined controller signals an abort to free runtime resources and avoid frozen states.

## Update Triggers
- When a new API provider class is introduced under src/providers.
- When the SSE stream parsing pattern is modified in claude.ts.
- When argument compilers or security checks are altered in cli.ts.

AGENT UPDATE: update docs/api/llm-providers.md when provider structures, CLI executors, or security checks change.

## Related Docs
- docs/overview.md — Tech stack.
- docs/api/external-services.md — Third-party service credentials.
- docs/state/app-state.md — Storing message buffers.
