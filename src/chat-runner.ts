import { App, TFile } from "obsidian";
import { buildVaultContext, formatVaultContext } from "./context-builder";
import { applyScoutResults, scoutContext } from "./context-scout";
import { ChatMessage } from "./chat-store";
import { resolveMentions } from "./mention-resolver";
import { LLMMessage, getProvider } from "./providers/provider-interface";
import { GStackSettings } from "./settings";

const CHAT_SYSTEM_PROMPT = `You are a helpful AI assistant embedded in Obsidian. The user's vault notes are provided below as context.

Help the user think through ideas, answer questions about their notes, and assist with writing and research. Be conversational, direct, and grounded in the notes when relevant.

{{VAULT_CONTEXT}}`;

export async function runChatMessage(
  userText: string,
  history: ChatMessage[],
  app: App,
  settings: GStackSettings,
  activeFile: TFile | null,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (msg: string) => void
): Promise<void> {
  try {
    let systemPrompt = CHAT_SYSTEM_PROMPT;

    if (activeFile) {
      const maxCtx = Math.min(settings.maxTokens, 4000);
      const ctx = await buildVaultContext(app, activeFile, settings, 2, maxCtx);
      if (ctx) {
        let finalCtx = ctx;
        if (settings.scoutEnabled && ctx.candidates.length > 0) {
          const results = await scoutContext(ctx.candidates, ctx, app, settings);
          if (results && results.length > 0) finalCtx = applyScoutResults(ctx, results);
        }
        systemPrompt = systemPrompt.replace("{{VAULT_CONTEXT}}", formatVaultContext(finalCtx));
      } else {
        systemPrompt = systemPrompt.replace("{{VAULT_CONTEXT}}", "(No linked notes found.)");
      }
    } else {
      systemPrompt = systemPrompt.replace("{{VAULT_CONTEXT}}", "(No active note open.)");
    }

    // Inject content of any @[[Note Name]] mentions
    const mentionedContent = await resolveMentions(userText, app);
    if (mentionedContent) {
      systemPrompt += `\n\n${mentionedContent}`;
    }

    const messages: LLMMessage[] = [
      ...history.map((m): LLMMessage => ({ role: m.role, content: m.content })),
      { role: "user", content: userText },
    ];

    const provider = getProvider(settings, vaultBasePath(app));
    const stream = provider.stream({ systemPrompt, messages });

    for await (const token of stream) {
      onToken(token);
    }
    onDone();
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e.status === 401) {
      onError("Invalid API key — check Settings → ogstack");
    } else if (e.status === 0) {
      onError(`Cannot reach ${settings.provider}`);
    } else {
      onError("Something went wrong");
    }
  }
}

function vaultBasePath(app: App): string | undefined {
  const adapter = app.vault.adapter as { getBasePath?: () => string; basePath?: string };
  if (typeof adapter.getBasePath === "function") return adapter.getBasePath();
  if (typeof adapter.basePath === "string") return adapter.basePath;
  return undefined;
}
