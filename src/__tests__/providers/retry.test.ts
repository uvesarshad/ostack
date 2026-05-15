import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry } from "../../providers/retry";

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns the response unchanged on 2xx", async () => {
    const ok = new Response("hi", { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok));
    const r = await fetchWithRetry("https://x", {});
    expect(r.status).toBe(200);
  });

  it("returns the response unchanged on non-retryable 4xx", async () => {
    const f = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", f);
    const r = await fetchWithRetry("https://x", {});
    expect(r.status).toBe(401);
    expect(f).toHaveBeenCalledTimes(1); // no retry on 401
  });

  it("retries once on 429 then returns the next response", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    const p = fetchWithRetry("https://x", {});
    await vi.advanceTimersByTimeAsync(1100);
    const r = await p;
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("retries once on 503", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("unavail", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    const p = fetchWithRetry("https://x", {});
    await vi.advanceTimersByTimeAsync(1100);
    await p;
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("honors Retry-After header (seconds form)", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(
        new Response("wait", {
          status: 429,
          headers: { "Retry-After": "3" },
        })
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    const p = fetchWithRetry("https://x", {});
    // 1.5s isn't enough — Retry-After says 3s
    await vi.advanceTimersByTimeAsync(1500);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1600);
    await p;
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("caps Retry-After at 10s", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(
        new Response("wait", {
          status: 429,
          headers: { "Retry-After": "999" },
        })
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    const p = fetchWithRetry("https://x", {});
    await vi.advanceTimersByTimeAsync(10_100);
    await p;
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries and returns the final failing response", async () => {
    const f = vi.fn().mockResolvedValue(new Response("nope", { status: 429 }));
    vi.stubGlobal("fetch", f);
    const p = fetchWithRetry("https://x", {}, { maxRetries: 1 });
    await vi.advanceTimersByTimeAsync(1500);
    const r = await p;
    expect(r.status).toBe(429);
    expect(f).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});
