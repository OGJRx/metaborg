import { describe, it, expect } from "vitest";
import {
  formatHourTo12,
  formatDateFriendly,
  formatDateISO,
} from "../shared/ui/formatters";

describe("Formatters", () => {
  it("formatHourTo12 converts 24h to 12h format", () => {
    expect(formatHourTo12("14:30")).toBe("2:30 PM");
    expect(formatHourTo12("09:15")).toBe("9:15 AM");
    expect(formatHourTo12("00:00")).toBe("12:00 AM");
    expect(formatHourTo12("12:00")).toBe("12:00 PM");
  });

  it("formatDateISO returns YYYY-MM-DD", () => {
    // Using UTC to avoid timezone issues in tests
    const date = new Date("2024-10-10T12:00:00Z");
    expect(formatDateISO(date)).toBe("2024-10-10");
  });

  it("formatDateFriendly returns friendly date string", () => {
    const date = new Date("2024-10-10T12:00:00Z");
    const formatted = formatDateFriendly(date);
    expect(formatted).toMatch(/10/);
    expect(formatted).toMatch(/octubre/i);
  });
});
