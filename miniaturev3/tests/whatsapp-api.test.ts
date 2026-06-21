import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhatsAppApi } from "../shared/whatsapp/whatsapp-api";
import { CoreEnv } from "../shared/types";
import { TitaniumCircuitBreaker } from "../shared/services/circuit-breaker";

describe("WhatsAppApi", () => {
  let env: CoreEnv;
  let dbMock: any;

  beforeEach(() => {
    dbMock = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
    };

    env = {
      DB: dbMock,
      WHATSAPP_API_VERSION: "v25.0",
      WHATSAPP_PHONE_NUMBER_ID: "12345",
      WHATSAPP_ACCESS_TOKEN: "token",
    } as any;

    vi.clearAllMocks();
  });

  describe("checkRateLimit", () => {
    it("uses the correct SQL and columns for rate limiting", async () => {
      const api = new WhatsAppApi(env);
      const to = "584121234567";
      const windowStart = Math.floor(Date.now() / 60000);

      dbMock.first.mockResolvedValueOnce({
        request_count: 1,
        window_end: windowStart,
      });

      // @ts-expect-error - accessing private method for test
      const result = await api.checkRateLimit(to);

      expect(result).toBe(true);
      expect(dbMock.prepare).toHaveBeenCalledWith(
        expect.stringContaining(
          "INSERT INTO rate_limits (identity_key, window_start, window_end, request_count)",
        ),
      );
      expect(dbMock.prepare).toHaveBeenCalledWith(
        expect.stringContaining(
          "ON CONFLICT(identity_key) DO UPDATE SET request_count",
        ),
      );
      expect(dbMock.bind).toHaveBeenCalledWith(
        to,
        windowStart,
        windowStart,
        windowStart,
        windowStart,
      );
    });

    it("returns false when per-user rate limit is exceeded", async () => {
      const api = new WhatsAppApi(env);
      const to = "584121234567";

      dbMock.first.mockResolvedValueOnce({
        request_count: 16,
        window_end: 12345,
      });

      // @ts-expect-error - accessing private method for test
      const result = await api.checkRateLimit(to);

      expect(result).toBe(false);
    });

    it("returns true when global rate limit is not exceeded", async () => {
      const api = new WhatsAppApi(env);
      dbMock.first.mockResolvedValue({ request_count: 1 });

      for (let i = 0; i < 5; i++) {
        // @ts-expect-error - accessing private method for test
        expect(await api.checkRateLimit("test")).toBe(true);
      }
    });
  });

  describe("sendMessage", () => {
    it("blocks message if circuit breaker is open", async () => {
      vi.spyOn(TitaniumCircuitBreaker, "shouldBlock").mockResolvedValue(true);

      const api = new WhatsAppApi(env);
      await expect(api.sendMessage("to", "text")).rejects.toThrow(
        "WhatsApp circuit breaker is open",
      );
    });

    it("returns error if rate limit is exceeded", async () => {
      vi.spyOn(TitaniumCircuitBreaker, "shouldBlock").mockResolvedValue(false);
      dbMock.first.mockResolvedValueOnce({ request_count: 16 });

      const api = new WhatsAppApi(env);
      const result = await api.sendMessage("to", "text");
      expect(result).toEqual({ error: "Rate limit exceeded" });
    });
  });
});
