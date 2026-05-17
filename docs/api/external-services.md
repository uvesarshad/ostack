# External Services Integration

> Scope: Third-party API integrations, rate limit retry models, and fallback systems.
> Rendering context: Client
> Project tier: 3
> Last updated: 2026-05-17

## Overview
ogstack connects directly to remote artificial intelligence model servers and code repositories without routing traffic through proxy servers. This peer-to-peer connection provides security, data privacy, and direct response streams.

## Integrated Services

### Anthropic Claude API
- Purpose: Streaming completions, structured tool usage, and agentic loops.
- Owner: ClaudeProvider in src/providers/claude.ts.
- Credentials: Saved in settings as apiKey.
- Rates and Limits: Subject to Anthropic tier token limits. Network requests use fetchWithRetry to handle temporary 429 rate throttles.

### Google AI Studio Gemini API
- Purpose: Primary completions and Context Scout relevance scoring (typically using gemini-2.0-flash-lite).
- Owner: GeminiProvider in src/providers/gemini.ts and Context Scout.
- Credentials: Saved in settings as apiKey or scoutApiKey.
- Rates and Limits: Highly cost-effective; free tier available. Fails gracefully if limits are exhausted.

### OpenAI API
- Purpose: Primary completions.
- Owner: OpenAIProvider in src/providers/openai.ts.
- Credentials: Saved in settings as apiKey.

### x.ai Grok API
- Purpose: Primary completions.
- Owner: GrokProvider in src/providers/grok.ts.
- Credentials: Saved in settings as apiKey.

### Ollama Local Server
- Purpose: Offline completions.
- Owner: OllamaProvider in src/providers/ollama.ts.
- Credentials: None required. Connects over HTTP to a configurable host (defaulting to http://localhost:11434).

### GitHub API and Raw CDN
- Purpose: Downloading and importing custom skill definitions.
- Owner: ImportSkillModal in src/import-skill-modal.ts.
- API Endpoints: Requests folder listings from api.github.com and pulls skill files from raw.githubusercontent.com.
- Rate Limits: Subject to GitHub's unauthenticated IP rate limits.

## Fallback Behaviors
- Context Scout Outages: If Google Gemini AI Studio is unreachable, returns 429 throttles, or times out (8 seconds ceiling), scoutContext catches the exception, yields control, and lets the pipeline execute with metadata-only BFS scoring.
- Cloud API Failures: Connection timeouts or invalid credentials in the main provider display a formatted error block, detach the streaming indicator, and return the editor to an idle state.

## Update Triggers
- When a new remote API or third-party service provider is added.
- When credential settings or environment parameters are refactored.
- When error capture structures or fallback triggers are changed.

AGENT UPDATE: update docs/api/external-services.md when third-party endpoints or credential variables change.

## Related Docs
- docs/overview.md — Tech stack.
- docs/api/llm-providers.md — SSE provider streams.
- docs/modules/context-engine.md — Context Scout settings.
