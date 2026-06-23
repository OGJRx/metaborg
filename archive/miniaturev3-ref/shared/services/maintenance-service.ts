import { D1Database } from "@cloudflare/workers-types";
import { CoreEnv } from "../types";
import { toSqliteDateTime } from "../ui/formatters";

export class MaintenanceService {
  static async runAudits(db: D1Database, env: CoreEnv) {
    await db
      .prepare(
        "UPDATE circuit_breakers SET status = 'closed', opened_at = NULL WHERE status = 'open' AND opened_at < ?",
      )
      .bind(toSqliteDateTime(new Date(Date.now() - 3600000)))
      .run();

    await db
      .prepare("DELETE FROM sessions WHERE expires_at < datetime('now')")
      .run();

    await db
      .prepare("DELETE FROM rate_limits WHERE window_end < ?")
      .bind(Math.floor(Date.now() / 60000))
      .run();

    const retentionLogs = parseInt(env.RETENTION_LOGS_DAYS || "7");
    const retentionUpdates = parseInt(env.RETENTION_UPDATES_HOURS || "24");
    const retentionWA = parseInt(env.RETENTION_WHATSAPP_DAYS || "30");

    await db
      .prepare("DELETE FROM system_logs WHERE created_at < ?")
      .bind(
        toSqliteDateTime(
          new Date(Date.now() - retentionLogs * 24 * 3600 * 1000),
        ),
      )
      .run();

    await db
      .prepare("DELETE FROM processed_updates WHERE processed_at < ?")
      .bind(
        toSqliteDateTime(new Date(Date.now() - retentionUpdates * 3600 * 1000)),
      )
      .run();

    await db
      .prepare("DELETE FROM processed_wa_messages WHERE processed_at < ?")
      .bind(
        toSqliteDateTime(new Date(Date.now() - retentionUpdates * 3600 * 1000)),
      )
      .run();

    await db
      .prepare("DELETE FROM whatsapp_messages WHERE created_at < ?")
      .bind(
        toSqliteDateTime(new Date(Date.now() - retentionWA * 24 * 3600 * 1000)),
      )
      .run();

    await this.logDatabaseSize(db);
  }

  private static async logDatabaseSize(db: D1Database) {
    try {
      // NOTE: PRAGMA statements are restricted in Cloudflare D1 Remote mode (SQLITE_AUTH).
      // They only work in local development. We wrap in try/catch to prevent cron failure.
      const pageCountRes = await db
        .prepare("PRAGMA page_count")
        .first<{
          page_count: number;
        }>()
        .catch(() => null);
      const pageSizeRes = await db
        .prepare("PRAGMA page_size")
        .first<{
          page_size: number;
        }>()
        .catch(() => null);

      if (pageCountRes && pageSizeRes) {
        const sizeBytes = pageCountRes.page_count * pageSizeRes.page_size;
        await db
          .prepare(
            "INSERT INTO business_metrics (metric_key, metric_value, platform, bot_type, recorded_at) " +
              "VALUES (?, ?, 'system', 'core', datetime('now')) " +
              "ON CONFLICT(metric_key, platform, bot_type) DO UPDATE SET " +
              "metric_value = excluded.metric_value, recorded_at = excluded.recorded_at",
          )
          .bind("d1_database_size_bytes", sizeBytes)
          .run();
        console.log(`[Maintenance] D1 Database Size: ${sizeBytes} bytes`);
      } else {
        console.log(
          "[Maintenance] D1 Database Size monitoring skipped (PRAGMA restricted in this environment)",
        );
      }
    } catch (e) {
      // Silent fail for size logging to not interrupt other maintenance tasks
      console.warn("[Maintenance] Could not log database size:", e);
    }
  }
}
