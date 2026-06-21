import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseCallback, buildCallback } from "./index";

describe("parseCallback expiration", () => {
  const secret = "test-secret";

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should mark a fresh callback as NOT expired", async () => {
    const now = new Date("2024-05-20T12:00:00Z");
    vi.setSystemTime(now);

    const callback = await buildCallback("reg_brand", "toyota", secret);
    const parsed = await parseCallback(callback, secret);

    expect(parsed?.valid).toBe(true);
    expect(parsed?.expired).toBe(false);
  });

  it("should mark a callback older than 5 minutes as expired", async () => {
    const start = new Date("2024-05-20T12:00:00Z");
    vi.setSystemTime(start);

    const callback = await buildCallback("reg_brand", "toyota", secret);

    // Advance time by 6 minutes
    const later = new Date(start.getTime() + 6 * 60 * 1000);
    vi.setSystemTime(later);

    const parsed = await parseCallback(callback, secret);

    expect(parsed?.valid).toBe(true);
    expect(parsed?.expired).toBe(true);
  });

  it("should mark a callback exactly 5 minutes old as NOT expired", async () => {
    const start = new Date("2024-05-20T12:00:00Z");
    vi.setSystemTime(start);

    const callback = await buildCallback("reg_brand", "toyota", secret);

    // Advance time by exactly 5 minutes
    const later = new Date(start.getTime() + 5 * 60 * 1000);
    vi.setSystemTime(later);

    const parsed = await parseCallback(callback, secret);

    expect(parsed?.valid).toBe(true);
    expect(parsed?.expired).toBe(false);
  });
});
