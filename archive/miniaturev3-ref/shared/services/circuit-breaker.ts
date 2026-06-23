import { D1Database } from "@cloudflare/workers-types";
import { CircuitService } from "../types";
import { toSqliteDateTime } from "../ui/formatters";

export class TitaniumCircuitBreaker {
  static async shouldBlock(
    env: { DB: D1Database },
    service: CircuitService,
  ): Promise<boolean> {
    const res = await env.DB.prepare(
      "SELECT status, opened_at FROM circuit_breakers WHERE service = ?",
    )
      .bind(service)
      .first<{ status: string; opened_at: string | null }>();

    if (!res || res.status === "closed") return false;

    if (res.status === "open" && res.opened_at) {
      const elapsed = Date.now() - new Date(res.opened_at).getTime();
      if (elapsed >= 60000) {
        // HALF-OPEN: Permitir 1 request de prueba
        return false;
      }
      return true;
    }

    return false;
  }

  static async recordSuccess(
    env: { DB: D1Database },
    service: CircuitService,
  ): Promise<void> {
    await env.DB.prepare(
      "UPDATE circuit_breakers SET status = 'closed', failure_count = 0, opened_at = NULL, updated_at = ? WHERE service = ?",
    )
      .bind(toSqliteDateTime(new Date()), service)
      .run();
  }

  static async recordFailure(
    env: { DB: D1Database },
    service: CircuitService,
    code?: number,
  ): Promise<void> {
    const now = toSqliteDateTime(new Date());

    const isTripCandidate = code !== undefined && code >= 500 && code !== 503;

    if (isTripCandidate) {
      await env.DB.prepare(
        "INSERT INTO circuit_breakers (service, status, failure_count, last_failure_at, updated_at) " +
          "VALUES (?, 'closed', 1, ?, ?) " +
          "ON CONFLICT(service) DO UPDATE SET " +
          "failure_count = failure_count + 1, " +
          "last_failure_at = ?, " +
          "updated_at = ?, " +
          "opened_at = CASE WHEN status = 'open' OR failure_count + 1 >= 3 THEN ? ELSE opened_at END, " +
          "status = CASE WHEN failure_count + 1 >= 3 THEN 'open' ELSE status END",
      )
        .bind(service, now, now, now, now, now)
        .run();
    } else {
      await env.DB.prepare(
        "INSERT INTO circuit_breakers (service, status, failure_count, last_failure_at, updated_at) " +
          "VALUES (?, 'closed', 1, ?, ?) " +
          "ON CONFLICT(service) DO UPDATE SET " +
          "failure_count = failure_count + 1, " +
          "last_failure_at = ?, " +
          "updated_at = ?",
      )
        .bind(service, now, now, now, now)
        .run();
    }
  }

  static async trip(
    env: { DB: D1Database },
    service: CircuitService,
  ): Promise<void> {
    const now = toSqliteDateTime(new Date());
    await env.DB.prepare(
      "INSERT INTO circuit_breakers (service, status, opened_at, failure_count, updated_at) " +
        "VALUES (?, 'open', ?, 3, ?) " +
        "ON CONFLICT(service) DO UPDATE SET status = 'open', opened_at = ?, failure_count = 3, updated_at = ?",
    )
      .bind(service, now, now, now, now)
      .run();
  }

  static async reset(
    env: { DB: D1Database },
    service: CircuitService,
  ): Promise<void> {
    await this.recordSuccess(env, service);
  }
}
