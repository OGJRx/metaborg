import { describe, it, expect, vi, beforeEach } from "vitest";
import { TitaniumCircuitBreaker } from "../shared/services/circuit-breaker";
import { CircuitService } from "../shared/types";
import { toSqliteDateTime } from "../shared/ui/formatters";

describe("TitaniumCircuitBreaker", () => {
  let dbMock: any;
  let env: any;

  beforeEach(() => {
    dbMock = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(),
      run: vi.fn(),
    };
    env = { DB: dbMock };
  });

  it("shouldBlock returns false if no entry exists", async () => {
    dbMock.first.mockResolvedValueOnce(null);
    const result = await TitaniumCircuitBreaker.shouldBlock(
      env,
      CircuitService.WHATSAPP,
    );
    expect(result).toBe(false);
  });

  it("shouldBlock returns true if status is open and recently opened", async () => {
    const now = Date.now();
    dbMock.first.mockResolvedValueOnce({
      status: "open",
      opened_at: toSqliteDateTime(new Date(now - 30000)), // 30s ago
    });
    const result = await TitaniumCircuitBreaker.shouldBlock(
      env,
      CircuitService.WHATSAPP,
    );
    expect(result).toBe(true);
  });

  it("shouldBlock returns false if status is open but 60s passed (half-open)", async () => {
    const now = Date.now();
    dbMock.first.mockResolvedValueOnce({
      status: "open",
      opened_at: toSqliteDateTime(new Date(now - 70000)), // 70s ago
    });
    const result = await TitaniumCircuitBreaker.shouldBlock(
      env,
      CircuitService.WHATSAPP,
    );
    expect(result).toBe(false);
  });

  it("recordSuccess updates status to closed", async () => {
    await TitaniumCircuitBreaker.recordSuccess(env, CircuitService.WHATSAPP);
    expect(dbMock.prepare).toHaveBeenCalledWith(
      expect.stringContaining("status = 'closed'"),
    );
  });

  it("recordFailure increments failure count and trips if >= 3", async () => {
    // This part is hard to test with just one run call because of the CASE logic
    // but we can verify the SQL
    await TitaniumCircuitBreaker.recordFailure(
      env,
      CircuitService.WHATSAPP,
      500,
    );
    expect(dbMock.prepare).toHaveBeenCalledWith(
      expect.stringContaining(
        "CASE WHEN status = 'open' OR failure_count + 1 >= 3 THEN ? ELSE opened_at END",
      ),
    );

    await TitaniumCircuitBreaker.recordFailure(env, CircuitService.WHATSAPP);
    expect(dbMock.prepare).toHaveBeenCalledWith(
      expect.stringContaining("failure_count = failure_count + 1"),
    );
  });

  it("trip sets status to open and failure count to 3", async () => {
    await TitaniumCircuitBreaker.trip(env, CircuitService.WHATSAPP);
    expect(dbMock.prepare).toHaveBeenCalledWith(
      expect.stringContaining("'open', ?, 3"),
    );
  });
});
