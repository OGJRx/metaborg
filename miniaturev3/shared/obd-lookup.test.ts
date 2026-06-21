import { describe, it, expect } from "vitest";
import { ObdLookupService } from "./obd-lookup";

describe("ObdLookupService.sanitizeFtsQuery", () => {
  it("should wrap simple words in quotes", () => {
    expect(ObdLookupService.sanitizeFtsQuery("motor")).toBe('"motor"');
    expect(ObdLookupService.sanitizeFtsQuery("engine fail")).toBe(
      '"engine" "fail"',
    );
  });

  it("should remove special characters", () => {
    expect(ObdLookupService.sanitizeFtsQuery('motor "fails"')).toBe(
      '"motor" "fails"',
    );
    expect(ObdLookupService.sanitizeFtsQuery("P0420-77")).toBe('"P0420" "77"');
    expect(ObdLookupService.sanitizeFtsQuery("engine: overheat")).toBe(
      '"engine" "overheat"',
    );
  });

  it("should remove FTS5 reserved words", () => {
    expect(ObdLookupService.sanitizeFtsQuery("motor AND engine")).toBe(
      '"motor" "engine"',
    );
    expect(ObdLookupService.sanitizeFtsQuery("motor OR engine")).toBe(
      '"motor" "engine"',
    );
    expect(ObdLookupService.sanitizeFtsQuery("motor NOT engine")).toBe(
      '"motor" "engine"',
    );
    expect(ObdLookupService.sanitizeFtsQuery("motor NEAR engine")).toBe(
      '"motor" "engine"',
    );
  });

  it("should handle empty or whitespace-only strings", () => {
    expect(ObdLookupService.sanitizeFtsQuery("")).toBe("");
    expect(ObdLookupService.sanitizeFtsQuery("   ")).toBe("");
    expect(ObdLookupService.sanitizeFtsQuery(' " * ( ) - : ')).toBe("");
  });

  it("should handle mixed complex cases", () => {
    const input = 'P0420: "cat" OR (fail) - critical*';
    // Expectation: P0420 cat fail critical (all quoted)
    expect(ObdLookupService.sanitizeFtsQuery(input)).toBe(
      '"P0420" "cat" "fail" "critical"',
    );
  });
});

describe("ObdLookupService.extractCodes", () => {
  it("should extract single OBD-II code", () => {
    expect(ObdLookupService.extractCodes("The code is P0420")).toEqual([
      "P0420",
    ]);
  });

  it("should extract multiple unique OBD-II codes", () => {
    const text = "Found P0420 and also C0035, maybe B1234 too. P0420 again.";
    const expected = ["P0420", "C0035", "B1234"];
    expect(ObdLookupService.extractCodes(text)).toEqual(expected);
  });

  it("should handle mixed case codes", () => {
    expect(ObdLookupService.extractCodes("p0420 and U1234")).toEqual([
      "P0420",
      "U1234",
    ]);
  });

  it("should return empty array when no codes found", () => {
    expect(ObdLookupService.extractCodes("no codes here")).toEqual([]);
  });

  it("should ignore invalid codes", () => {
    // Too short, too long, wrong prefix
    expect(ObdLookupService.extractCodes("P042 P04200 X0420")).toEqual([]);
  });
});
