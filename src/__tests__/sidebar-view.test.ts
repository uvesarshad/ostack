import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { relativeTime } from "../sidebar-view";

describe("relativeTime", () => {
  const NOW = new Date("2026-05-15T12:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("returns 'just now' for ts within the last 60 seconds", () => {
    expect(relativeTime(NOW)).toBe("just now");
    expect(relativeTime(NOW - 30_000)).toBe("just now");
    expect(relativeTime(NOW - 59_999)).toBe("just now");
  });

  it("returns minute count for 1m..59m ago", () => {
    expect(relativeTime(NOW - 60_000)).toBe("1m ago");
    expect(relativeTime(NOW - 5 * 60_000)).toBe("5m ago");
    expect(relativeTime(NOW - 59 * 60_000)).toBe("59m ago");
  });

  it("returns hour count for 1h..23h ago", () => {
    expect(relativeTime(NOW - 60 * 60_000)).toBe("1h ago");
    expect(relativeTime(NOW - 5 * 60 * 60_000)).toBe("5h ago");
    expect(relativeTime(NOW - 23 * 60 * 60_000)).toBe("23h ago");
  });

  it("returns day count for 1d..6d ago", () => {
    expect(relativeTime(NOW - 24 * 60 * 60_000)).toBe("1d ago");
    expect(relativeTime(NOW - 3 * 24 * 60 * 60_000)).toBe("3d ago");
    expect(relativeTime(NOW - 6 * 24 * 60 * 60_000)).toBe("6d ago");
  });

  it("returns a locale date string for ts >= 7 days ago", () => {
    const week = NOW - 8 * 24 * 60 * 60_000;
    const out = relativeTime(week);
    // Locale formatting varies — assert it's not one of the relative forms
    expect(out).not.toMatch(/^just now$|^\d+m ago$|^\d+h ago$|^\d+d ago$/);
    // Sanity: contains some digit (date number)
    expect(out).toMatch(/\d/);
  });
});
