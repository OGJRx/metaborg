import { describe, it, expect } from "vitest";
import { getVenezuelaTimeParts } from "../shared/ui/timezone";

describe("Timezone Utils", () => {
  it("getVenezuelaTimeParts returns correct parts for a given date", () => {
    const date = new Date("2024-10-10T12:00:00Z");
    const parts = getVenezuelaTimeParts(date);
    expect(parts.year).toBe(2024);
    expect(parts.month).toBe(10);
    expect(parts.day).toBe(10);
    // VET is UTC-4
    expect(parts.hour).toBe(8);
  });

  it("getVenezuelaTimeParts defaults to now", () => {
    const parts = getVenezuelaTimeParts();
    expect(parts.year).toBeGreaterThanOrEqual(2024);
  });
});
