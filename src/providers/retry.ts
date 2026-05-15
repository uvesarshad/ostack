// One-shot retry helper for the streaming providers. We only retry on transient
// rate-limit (429) and service-unavailable (503) responses — anything else is
// either a configuration error (400/401/403) or a network failure that won't
// fix itself in 1s.
//
// If the server sends a Retry-After header, we honor it (capped at 10s so a
// runaway value can't lock the chat). Otherwise we wait 1s.

const RETRYABLE_STATUSES = new Set([429, 503]);
const DEFAULT_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10_000;

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: { maxRetries?: number; signal?: AbortSignal } = {}
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 1;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init);
    if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries) {
      return response;
    }
    const wait = parseRetryAfter(response.headers.get("retry-after")) ?? DEFAULT_BACKOFF_MS;
    // Drain the body so the connection can be reused
    try { await response.text(); } catch { /* ignore */ }
    await sleep(Math.min(wait, MAX_BACKOFF_MS), options.signal);
  }
  // unreachable — the loop above either returns or throws via sleep abort
  throw new Error("retry loop exhausted");
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  // Either "<seconds>" or an HTTP-date. We only handle the seconds form —
  // providers we talk to (Anthropic, OpenAI, Gemini, Grok) all use seconds.
  const secs = parseInt(header, 10);
  if (!isNaN(secs) && secs >= 0) return secs * 1000;
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
