import { describe, it, expect, vi, beforeEach } from "vitest";
import { MaintenanceService } from "../shared/services/maintenance-service";
import { D1Database } from "@cloudflare/workers-types";
import { CoreEnv } from "../shared/types";

describe("MaintenanceService", () => {
  let dbMock: any;
  let envMock: Partial<CoreEnv>;

  beforeEach(() => {
    dbMock = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({}),
      first: vi.fn().mockImplementation(function (this: any) {
        const sql =
          this.prepare.mock.calls[this.prepare.mock.calls.length - 1][0];
        if (sql.includes("PRAGMA page_count"))
          return Promise.resolve({ page_count: 100 });
        if (sql.includes("PRAGMA page_size"))
          return Promise.resolve({ page_size: 4096 });
        return Promise.resolve({});
      }),
    };
    envMock = {
      RETENTION_LOGS_DAYS: "5",
      RETENTION_UPDATES_HOURS: "12",
    };
  });

  it("runAudits should execute all cleanup queries", async () => {
    await MaintenanceService.runAudits(
      dbMock as unknown as D1Database,
      envMock as CoreEnv,
    );

    // Check if at least some of the expected tables are being cleaned
    expect(dbMock.prepare).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM system_logs"),
    );
    expect(dbMock.prepare).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM processed_updates"),
    );
    expect(dbMock.prepare).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM whatsapp_messages"),
    );

    // Verify size logging was attempted
    expect(dbMock.prepare).toHaveBeenCalledWith(
      expect.stringContaining("PRAGMA page_count"),
    );
    expect(dbMock.prepare).toHaveBeenCalledWith(
      expect.stringContaining("PRAGMA page_size"),
    );
    expect(dbMock.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO business_metrics"),
    );
    expect(dbMock.bind).toHaveBeenCalledWith(
      "d1_database_size_bytes",
      100 * 4096,
    );
  });
});
