import type { StorageAdapter } from "grammy";
import type { TitaniumSession } from "./types";

export class RelationalSessionAdapter
  implements StorageAdapter<TitaniumSession>
{
  constructor(private db: D1Database) {}

  async read(key: string): Promise<TitaniumSession | undefined> {
    const [_, chatId, botId] = key.split(":");
    if (!chatId || !botId) return undefined;

    const row = await this.db
      .prepare(
        "SELECT step_data, paso_actual FROM factory_sessions WHERE chat_id = ? AND bot_id = ? AND estado_flujo = 'activo' LIMIT 1",
      )
      .bind(chatId, botId)
      .first<{ step_data: string; paso_actual: number }>();

    if (!row) return undefined;

    return {
      step_data: JSON.parse(row.step_data),
      paso_actual: row.paso_actual,
    };
  }

  async write(key: string, value: TitaniumSession): Promise<void> {
    const [_, chatId, botId] = key.split(":");
    if (!chatId || !botId) return;

    const session_id = `S-${Date.now()}-${chatId.slice(-4)}`;
    const step_data = JSON.stringify(value.step_data || {});
    const paso_actual = value.paso_actual || 0;
    const platform = "telegram"; // For now, handle platform in engine
    const expires_at = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    await this.db
      .prepare(
        "INSERT INTO factory_sessions (session_id, bot_id, platform, chat_id, paso_actual, step_data, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(bot_id, platform, chat_id, estado_flujo) WHERE estado_flujo NOT IN ('confirmado', 'cancelado') DO UPDATE SET paso_actual = excluded.paso_actual, step_data = excluded.step_data, updated_at = CURRENT_TIMESTAMP",
      )
      .bind(
        session_id,
        botId,
        platform,
        chatId,
        paso_actual,
        step_data,
        expires_at,
      )
      .run();
  }

  async delete(_key: string): Promise<void> {
    // Implement soft delete or mark as cancelled
  }
}
