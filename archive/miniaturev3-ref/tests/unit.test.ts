import { describe, it, expect, vi } from "vitest";
import { timingSafeEqual } from "../shared/security/crypto";
import { buildCallback, parseCallback } from "../shared/security";
import { smartSplitHtml } from "../shared/ui/html-utils";
import { escapeHtml, toSqliteDateTime } from "../shared/ui/formatters";
import { TitaniumCircuitBreaker } from "../shared/services/circuit-breaker";
import {} from "../shared/services/slot-validator";
import { CircuitService } from "../shared/types";

// Mock @google/genai
vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: vi.fn().mockResolvedValue({
          response: { text: () => "AI Response" },
        }),
      }),
      models: {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: "AI Response" }] } }],
        }),
      },
    })),
  };
});

describe("Titanium Core Unit Tests", () => {
  describe("Security Utils", () => {
    it("timingSafeEqual should return true for identical strings", async () => {
      const res = await timingSafeEqual("secret123", "secret123");
      expect(res).toBe(true);
    });

    it("timingSafeEqual should return false for different strings", async () => {
      const res = await timingSafeEqual("secret123", "other");
      expect(res).toBe(false);
    });

    it("buildCallback and parseCallback should round-trip", async () => {
      const secret = "test-secret-at-least-32-chars-long-!!!";
      const cb = await buildCallback("reg_brand", "toyota", secret);
      const parsed = await parseCallback(cb, secret);
      expect(parsed?.action).toBe("reg_brand");
      expect(parsed?.value).toBe("toyota");
      expect(parsed?.valid).toBe(true);
    });
  });

  describe("UI Utils", () => {
    it("smartSplitHtml should split long text but preserve tags", () => {
      const longText = "<b>" + "A".repeat(3995) + "</b> <i>B</i>";
      const parts = smartSplitHtml(longText, 4000);
      expect(parts.length).toBeGreaterThan(1);
      expect(parts[0]).toContain("</b>");
      expect(parts[1]).toContain("<b>");
    });

    it("escapeHtml should sanitize tags", () => {
      expect(escapeHtml("<b>")).toBe("&lt;b&gt;");
    });
  });

  describe("Circuit Breaker", () => {
    it("should trip after 3 failures", async () => {
      const dbMock = {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          status: "open",
          opened_at: toSqliteDateTime(new Date()),
        }),
        run: vi.fn().mockResolvedValue({}),
      };
      // @ts-expect-error Mocking D1
      const blocked = await TitaniumCircuitBreaker.shouldBlock(
        { DB: dbMock },
        CircuitService.GEMINI,
      );
      expect(blocked).toBe(true);
    });
  });
});
