import { BotConfigSchema } from "./schemas";
import { decrypt, deriveKey, encrypt } from "./security";
import type { CoreEnv } from "./types";
export async function isUpdateProcessed(
  db: D1Database,
  botId: string,
  updateId: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 FROM factory_processed_updates WHERE bot_id = ? AND update_id = ?",
    )
    .bind(botId, updateId)
    .first();
  return !!row;
}
export async function markUpdateProcessed(
  db: D1Database,
  botId: string,
  updateId: number,
) {
  return db
    .prepare(
      "INSERT INTO factory_processed_updates (bot_id, update_id, processed_at) VALUES (?, ?, unixepoch())",
    )
    .bind(botId, updateId);
}
export async function cleanupProcessedUpdates(db: D1Database) {
  await db
    .prepare(
      "DELETE FROM factory_processed_updates WHERE processed_at < unixepoch('now', '-1 day')",
    )
    .run();
}
export async function isAdmin(
  db: D1Database,
  env: { ADMIN_TELEGRAM_IDS?: string },
  userId: number,
): Promise<boolean> {
  const envAdmins = (env.ADMIN_TELEGRAM_IDS || "").split(",");
  const dbAdminsRow = await db
    .prepare(
      "SELECT value FROM factory_platform_config WHERE key = 'admin_telegram_ids'",
    )
    .first<{ value: string }>();
  const dbAdmins = (dbAdminsRow?.value || "").split(",");
  const allAdmins = [...envAdmins, ...dbAdmins].map((id) => id.trim());
  return allAdmins.includes(String(userId));
}
export async function upsertBotConfig(
  db: D1Database,
  env: CoreEnv,
  validated: {
    bot_id: string;
    bot_name: string;
    token_var_name: string;
    system_prompt: string;
    welcome_message: string;
    menu_json: string;
    bot_kind: "open_chat" | "agendado" | "tool_specialist" | "kernel_admin";
    config_json: string;
    token?: string;
    stack_id?: string;
    owner_id?: number;
  },
): Promise<{
  success: boolean;
  webhook_ok?: boolean;
  webhook_error?: string;
  error?: string;
  details?: unknown;
}> {
  const existing = await db
    .prepare(
      "SELECT slug, webhook_secret, token, token_iv FROM factory_bots WHERE bot_id = ?",
    )
    .bind(validated.bot_id)
    .first<{
      slug: string;
      webhook_secret: string;
      token: string | null;
      token_iv: string | null;
    }>();
  const slug = existing?.slug || validated.bot_id;
  const webhookSecret = existing?.webhook_secret || crypto.randomUUID();
  let tokenCiphertext = existing?.token || null;
  let tokenIv = existing?.token_iv || null;
  const key = await deriveKey(env.TITANIUM_API_SECRET);

  let parsedConfigJson: Record<string, unknown>;
  try {
    parsedConfigJson = JSON.parse(validated.config_json);
  } catch {
    return { success: false, error: "config_json must be valid JSON" };
  }

  // Prohibir bot_kind dentro de config_json si discrepa
  if (
    parsedConfigJson["bot_kind"] &&
    parsedConfigJson["bot_kind"] !== validated.bot_kind
  ) {
    return {
      success: false,
      error: "bot_kind in config_json must match request bot_kind",
    };
  }

  // Validar discriminatedUnion completo
  try {
    BotConfigSchema.parse({
      bot_kind: validated.bot_kind,
      ...parsedConfigJson,
    });
  } catch (e) {
    return { success: false, error: "Invalid config for bot_kind", details: e };
  }

  if (validated.token) {
    const encrypted = await encrypt(validated.token, key);
    tokenCiphertext = encrypted.ciphertext;
    tokenIv = encrypted.iv;
  }
  await db
    .prepare(
      "INSERT INTO factory_bots (bot_id, bot_name, token_var_name, system_prompt, welcome_message, menu_json, bot_kind, config_json, slug, webhook_secret, token, token_iv, stack_id, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET bot_name=excluded.bot_name, token_var_name=excluded.token_var_name, system_prompt=excluded.system_prompt, welcome_message=excluded.welcome_message, menu_json=excluded.menu_json, bot_kind=excluded.bot_kind, config_json=excluded.config_json, token=excluded.token, token_iv=excluded.token_iv, stack_id=excluded.stack_id, owner_id=excluded.owner_id, updated_at=CURRENT_TIMESTAMP",
    )
    .bind(
      validated.bot_id,
      validated.bot_name,
      validated.token_var_name,
      validated.system_prompt,
      validated.welcome_message,
      validated.menu_json,
      validated.bot_kind,
      validated.config_json,
      slug,
      webhookSecret,
      tokenCiphertext,
      tokenIv,
      validated.stack_id || null,
      validated.owner_id || null,
    )
    .run();
  let plainToken: string | null = null;
  if (tokenCiphertext && tokenIv)
    plainToken = await decrypt(tokenCiphertext, tokenIv, key);
  else if (validated.token) plainToken = validated.token;
  let webhook_ok = true;
  let webhook_error: string | undefined;
  if (plainToken && webhookSecret) {
    if (!env.WORKER_HOST?.includes(".")) {
      console.error(
        JSON.stringify({
          level: "error",
          tag: "WEBHOOK_INVALID_HOST",
          botId: validated.bot_id,
          slug,
          host: env.WORKER_HOST,
          timestamp: new Date().toISOString(),
        }),
      );
      webhook_ok = false;
      webhook_error = `Invalid or missing WORKER_HOST: "${env.WORKER_HOST}". Expected public domain.`;
      await db
        .prepare(
          "UPDATE factory_bots SET webhook_last_error = ? WHERE bot_id = ?",
        )
        .bind(webhook_error, validated.bot_id)
        .run();
    } else {
      const webhookUrl = `https://${env.WORKER_HOST}/webhook/${slug}`;
      const telegramApiUrl = `https://api.telegram.org/bot${plainToken}/setWebhook`;
      try {
        const tgRes = await fetch(telegramApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: webhookUrl,
            secret_token: webhookSecret,
            allowed_updates: ["message", "callback_query"],
          }),
        });
        const tgData = (await tgRes.json()) as {
          ok: boolean;
          description?: string;
        };
        if (tgData.ok) {
          console.log(
            JSON.stringify({
              level: "info",
              tag: "WEBHOOK_SET",
              botId: validated.bot_id,
              slug,
              host: env.WORKER_HOST,
              webhookUrl,
              timestamp: new Date().toISOString(),
            }),
          );
          await db
            .prepare(
              "UPDATE factory_bots SET webhook_configured_at = CURRENT_TIMESTAMP, webhook_last_error = NULL WHERE bot_id = ?",
            )
            .bind(validated.bot_id)
            .run();
        } else {
          console.error(
            JSON.stringify({
              level: "error",
              tag: "WEBHOOK_SET_FAILED",
              botId: validated.bot_id,
              slug,
              host: env.WORKER_HOST,
              webhookUrl,
              telegramError: tgData.description,
              timestamp: new Date().toISOString(),
            }),
          );
          webhook_ok = false;
          webhook_error = tgData.description || "Unknown error";
          await db
            .prepare(
              "UPDATE factory_bots SET webhook_last_error = ? WHERE bot_id = ?",
            )
            .bind(webhook_error, validated.bot_id)
            .run();
        }
      } catch (e) {
        console.error(
          JSON.stringify({
            level: "error",
            tag: "WEBHOOK_SET_ERROR",
            botId: validated.bot_id,
            slug,
            host: env.WORKER_HOST,
            webhookUrl,
            error: String(e),
            timestamp: new Date().toISOString(),
          }),
        );
        webhook_ok = false;
        webhook_error = String(e);
        await db
          .prepare(
            "UPDATE factory_bots SET webhook_last_error = ? WHERE bot_id = ?",
          )
          .bind(webhook_error, validated.bot_id)
          .run();
      }
    }
  }
  return {
    success: true,
    ...(webhook_ok !== undefined && { webhook_ok }),
    ...(webhook_error !== undefined && { webhook_error }),
  };
}
