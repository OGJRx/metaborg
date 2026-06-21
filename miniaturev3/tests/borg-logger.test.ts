import { describe, it, expect, vi, beforeEach } from "vitest";
import { BorgLogger } from "../shared/services/borg-logger";

describe("BorgLogger", () => {
  let dbMock: any;

  beforeEach(() => {
    dbMock = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    };
  });

  it("logs info message to DB", async () => {
    const _env = {};
    const logger = new BorgLogger("test-comp", dbMock, "trace-123");
    await logger.info("test-sub", "hello world");

    expect(dbMock.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO system_logs"),
    );
    expect(dbMock.bind).toHaveBeenCalledWith(
      "test-comp",
      "INFO",
      "hello world",
      JSON.stringify({ action: "test-sub" }),
      "trace-123",
    );
  });

  it("logs error message with stack", async () => {
    const logger = new BorgLogger("test-comp", dbMock);
    await logger.error("test-sub", "oops", "stack-trace");

    expect(dbMock.bind).toHaveBeenCalledWith(
      "test-comp",
      "ERROR",
      "oops",
      JSON.stringify({ action: "test-sub", stack: "stack-trace" }),
      expect.stringMatching(/^gen-/),
    );
  });
});
