import type { Update } from "grammy/types";
import { cleanupExpiredCallbacks } from "./factory/callback";
import { handleUpdate } from "./factory/engine";
import {
  cleanupProcessedUpdates,
  isUpdateProcessed,
  upsertBotConfig,
} from "./factory/platform";
import {
  AgendadoConfigSchema,
  ConfigSchema,
  MemoryQuerySchema,
  PatchConfigSchema,
  SequenceSchema,
  SummarizeSchema,
  TelegramUpdateSchema,
} from "./factory/schemas";
import { decrypt, deriveKey, timingSafeEqual } from "./factory/security";
import { summarizeConversation } from "./factory/summarize";
import type { CoreEnv } from "./factory/types";
import { handleWhatsAppWebhook } from "./factory/whatsapp/dispatcher";
import { getMiniAppAsset } from "./miniapp/app";

async function validateTelegramInitData(
  initData: string,
  botToken: string,
): Promise<boolean> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return false;

  params.delete("hash");
  const sortedKeys = Array.from(params.keys()).sort();
  const dataCheckString = sortedKeys
    .map((key) => `${key}=${params.get(key)}`)
    .join("\n");

  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const baseKey = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    encoder.encode(botToken),
  );

  const signatureKey = await crypto.subtle.importKey(
    "raw",
    baseKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    signatureKey,
    encoder.encode(dataCheckString),
  );

  const hashArray = Array.from(new Uint8Array(signature));
  const hexHash = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hexHash === hash;
}

export default {
  async fetch(
    request: Request,
    env: CoreEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Health Check
    if (url.pathname === "/api/health") {
      try {
        await env.DB.prepare("SELECT 1").run();
        return Response.json({ status: "ok", db: "ok" });
      } catch (e) {
        console.error("Health check DB error:", e);
        return Response.json({ status: "error", db: "error" }, { status: 503 });
      }
    }

    if (url.pathname === "/webhook/whatsapp") {
      return await handleWhatsAppWebhook(request, env, ctx);
    }

    if (url.pathname.startsWith("/app/")) {
      const parts = url.pathname.split("/");
      const slug = parts[2] || "";
      const assetPath =
        parts.length > 3 && parts[3] !== ""
          ? parts.slice(3).join("/")
          : "index.html";

      const bot = await env.DB.prepare(
        "SELECT bot_name, bot_kind, config_json FROM factory_bots WHERE slug = ? OR bot_id = ?",
      )
        .bind(slug, slug)
        .first<{ bot_name: string; bot_kind: string; config_json: string }>();

      if (!bot) return new Response("Not Found", { status: 404 });

      // Sanitize assetPath to prevent path traversal
      const sanitizedAssetPath = assetPath
        .replace(/\.\./g, "")
        .replace(/\/+/g, "/")
        .replace(/^\//, "");

      const asset = getMiniAppAsset(
        sanitizedAssetPath,
        bot.bot_name,
        bot.bot_kind,
        bot.config_json,
      );

      return new Response(asset.content, {
        headers: { "content-type": asset.contentType },
      });
    }

    if (url.pathname === "/api/miniapp/config" && request.method === "POST") {
      const initData = request.headers.get("X-Telegram-Init-Data");
      if (!initData) return new Response("Missing initData", { status: 401 });

      const params = new URLSearchParams(initData);
      const userJson = params.get("user");
      if (!userJson)
        return new Response("Invalid user in initData", { status: 401 });

      const slug = url.searchParams.get("slug");
      if (!slug) return new Response("Missing slug", { status: 400 });

      const bot = await env.DB.prepare(
        "SELECT token, token_iv, bot_kind FROM factory_bots WHERE slug = ?",
      )
        .bind(slug)
        .first<{ token: string; token_iv: string; bot_kind: string }>();
      if (!bot) return new Response("Bot not found", { status: 404 });

      const key = await deriveKey(env.TITANIUM_API_SECRET);
      const plainToken = await decrypt(bot.token, bot.token_iv, key);

      const isValid = await validateTelegramInitData(initData, plainToken);
      if (!isValid) return new Response("Invalid signature", { status: 403 });

      const newConfig = (await request.json()) as Record<string, unknown>;

      // Validation logic: Ensure the config matches the bot_kind
      try {
        if (bot.bot_kind === "agendado") {
          AgendadoConfigSchema.parse(newConfig);
        }
      } catch (e) {
        return Response.json(
          { error: "Invalid configuration for bot_kind", details: e },
          { status: 400 },
        );
      }

      await env.DB.prepare(
        "UPDATE factory_bots SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?",
      )
        .bind(JSON.stringify(newConfig), slug)
        .run();

      return Response.json({ success: true });
    }

    // --- Webhook Route (Titanium Slug-based) ---
    if (url.pathname.startsWith("/webhook/")) {
      const parts = url.pathname.split("/");
      if (parts.length !== 3)
        return new Response("Invalid webhook path", { status: 400 });
      const slug = parts[2];
      if (!slug) return new Response("slug required", { status: 400 });

      const incomingSecret = request.headers.get(
        "X-Telegram-Bot-Api-Secret-Token",
      );
      if (!incomingSecret) {
        console.error(
          JSON.stringify({
            level: "error",
            tag: "WEBHOOK_AUTH_MISSING",
            slug,
            timestamp: new Date().toISOString(),
          }),
        );
        return new Response("Forbidden: Secret missing", { status: 403 });
      }

      // Special case: BotFather admin bot (not in factory_bots table)
      if (slug === "botfather") {
        if (
          !(await timingSafeEqual(
            incomingSecret,
            env.TITANIUM_API_SECRET,
            env.TITANIUM_API_SECRET,
          ))
        ) {
          console.error(
            JSON.stringify({
              level: "error",
              tag: "WEBHOOK_AUTH_INVALID",
              slug: "botfather",
              timestamp: new Date().toISOString(),
            }),
          );
          return new Response("Forbidden: Invalid secret", { status: 403 });
        }

        const body = await request.json();
        const update = TelegramUpdateSchema.parse(body) as Update;

        // Idempotency: Mark BEFORE processing
        if (await isUpdateProcessed(env.DB, "botfather", update.update_id)) {
          return new Response("OK (already processed)");
        }

        await env.DB.prepare(
          "INSERT INTO factory_processed_updates (bot_id, update_id, processed_at) VALUES (?, ?, unixepoch())",
        )
          .bind("botfather", update.update_id)
          .run();

        ctx.waitUntil(cleanupProcessedUpdates(env.DB));
        ctx.waitUntil(cleanupExpiredCallbacks(env.DB));

        return await handleUpdate(
          "botfather",
          env.TELEGRAM_BOT_TOKEN,
          update,
          env,
          ctx.waitUntil.bind(ctx),
          request.headers.get("host") || "unknown",
        );
      }

      // Regular user bot: lookup by slug in factory_bots
      const botConfig = await env.DB.prepare(
        "SELECT bot_id, token, token_iv, webhook_secret, bot_kind, config_json FROM factory_bots WHERE slug = ?",
      )
        .bind(slug)
        .first<{
          bot_id: string;
          token: string | null;
          token_iv: string | null;
          webhook_secret: string;
        }>();

      if (!botConfig) return new Response("Bot not found", { status: 404 });

      // Validate webhook secret (Timing-safe comparison)
      if (
        !(await timingSafeEqual(
          incomingSecret,
          botConfig.webhook_secret,
          env.TITANIUM_API_SECRET,
        ))
      ) {
        console.error(
          JSON.stringify({
            level: "error",
            tag: "WEBHOOK_AUTH_INVALID",
            botId: botConfig.bot_id,
            slug,
            timestamp: new Date().toISOString(),
          }),
        );
        return new Response("Forbidden: Invalid secret", { status: 403 });
      }

      const body = await request.json();
      const update = TelegramUpdateSchema.parse(body) as Update;

      // Idempotency: Mark BEFORE processing
      if (await isUpdateProcessed(env.DB, botConfig.bot_id, update.update_id)) {
        return new Response("OK (already processed)");
      }

      await env.DB.prepare(
        "INSERT INTO factory_processed_updates (bot_id, update_id, processed_at) VALUES (?, ?, unixepoch())",
      )
        .bind(botConfig.bot_id, update.update_id)
        .run();

      // Cleanup old updates (lazy)
      ctx.waitUntil(cleanupProcessedUpdates(env.DB));
      ctx.waitUntil(cleanupExpiredCallbacks(env.DB));

      // Decrypt token
      let token: string;
      if (botConfig.token && botConfig.token_iv) {
        const key = await deriveKey(env.TITANIUM_API_SECRET);
        token = await decrypt(botConfig.token, botConfig.token_iv, key);
      } else {
        return new Response("Internal configuration error: Token missing", {
          status: 500,
        });
      }

      return await handleUpdate(
        botConfig.bot_id,
        token,
        update,
        env,
        ctx.waitUntil.bind(ctx),
        request.headers.get("host") || "unknown",
      );
    }

    // --- Platform Admins API ---
    if (url.pathname === "/api/factory/admins") {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (request.method === "GET") {
        const row = await env.DB.prepare(
          "SELECT value FROM factory_platform_config WHERE key = 'admin_telegram_ids'",
        ).first<{ value: string }>();
        return Response.json({ admins: row?.value || "" });
      }

      if (request.method === "POST") {
        const body = (await request.json()) as { admins: string };
        await env.DB.prepare(
          "INSERT INTO factory_platform_config (key, value) VALUES ('admin_telegram_ids', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
          .bind(body.admins)
          .run();
        return Response.json({ success: true });
      }
    }

    // --- Config API ---
    if (url.pathname === "/api/factory/config" && request.method === "POST") {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      const body = await request.json();
      const validated = ConfigSchema.parse(body);

      const result = await upsertBotConfig(
        env.DB,
        env,
        {
          bot_id: validated.bot_id,
          bot_name: validated.bot_name,
          token_var_name: validated.token_var_name,
          system_prompt: validated.system_prompt || "",
          welcome_message: validated.welcome_message || "",
          menu_json: validated.menu_json || "[]",
          bot_kind: validated.bot_kind,
          config_json: validated.config_json,
          ...(validated.token !== undefined && { token: validated.token }),
          ...(validated.stack_id !== undefined && {
            stack_id: validated.stack_id,
          }),
          ...(validated.owner_id !== undefined && {
            owner_id: validated.owner_id,
          }),
        },
        request.headers.get("host") || "unknown",
      );

      return Response.json(result);
    }

    // --- Memory API ---
    if (url.pathname === "/api/factory/memory") {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (request.method === "GET") {
        const params = Object.fromEntries(url.searchParams);
        const { bot_id, chat_id, cursor, limit } =
          MemoryQuerySchema.parse(params);

        let query =
          "SELECT bot_id, chat_id, message_id, role, content, created_at FROM factory_messages WHERE bot_id = ? AND chat_id = ?";
        const bindings: (string | number)[] = [bot_id, chat_id];

        if (cursor !== undefined) {
          query += " AND message_id < ?";
          bindings.push(cursor);
        }

        query += " ORDER BY message_id DESC LIMIT ?";
        bindings.push(limit + 1);

        const messages = await env.DB.prepare(query)
          .bind(...bindings)
          .all<{ message_id: number }>();
        const results = messages.results || [];
        const hasMore = results.length > limit;
        if (hasMore) results.pop();

        const lastItem = results[results.length - 1];
        const nextCursor = hasMore && lastItem ? lastItem.message_id : null;

        return Response.json({ results, hasMore, nextCursor });
      }

      if (request.method === "DELETE") {
        const botId = url.searchParams.get("bot_id");
        const chatId = url.searchParams.get("chat_id");
        const includeSummary =
          url.searchParams.get("include_summary") === "true";

        if (!botId || !chatId) {
          return Response.json(
            { error: "bot_id and chat_id required" },
            { status: 400 },
          );
        }

        let query =
          "DELETE FROM factory_messages WHERE bot_id = ? AND chat_id = ?";
        if (!includeSummary) {
          query += " AND message_id != 0";
        }

        await env.DB.prepare(query).bind(botId, chatId).run();
        return Response.json({ success: true });
      }
    }

    // --- Summarize API ---
    if (
      url.pathname === "/api/factory/memory/summarize" &&
      request.method === "POST"
    ) {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      const body = await request.json();
      const { bot_id, chat_id, mode, manual_summary } =
        SummarizeSchema.parse(body);

      try {
        const summary = await summarizeConversation(
          env.DB,
          bot_id,
          chat_id,
          env,
          mode === "manual" ? manual_summary : undefined,
        );
        return Response.json({ success: true, summary });
      } catch (err) {
        return Response.json(
          { error: String(err) },
          { status: mode === "manual" && !manual_summary ? 400 : 500 },
        );
      }
    }

    // --- Sequences API ---
    if (url.pathname === "/api/factory/sequences") {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (request.method === "GET") {
        const botId = url.searchParams.get("bot_id");
        if (!botId)
          return Response.json({ error: "bot_id required" }, { status: 400 });

        const sequences = await env.DB.prepare(
          "SELECT step_number, title, description, payload_json, created_at FROM factory_sequences WHERE bot_id = ? ORDER BY title ASC, step_number ASC",
        )
          .bind(botId)
          .all();
        return Response.json(sequences.results);
      }

      if (request.method === "POST") {
        const body = await request.json();
        const validated = SequenceSchema.parse(body);

        await env.DB.prepare(
          "INSERT INTO factory_sequences (bot_id, step_number, title, description, payload_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(bot_id, title, step_number) DO UPDATE SET description=excluded.description, payload_json=excluded.payload_json, created_at=CURRENT_TIMESTAMP",
        )
          .bind(
            validated.bot_id,
            validated.step_number,
            validated.title,
            validated.description,
            validated.payload_json,
          )
          .run();
        return Response.json({ success: true });
      }
    }

    // --- Bots API ---
    if (url.pathname === "/api/factory/bots" && request.method === "GET") {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }
      const bots = await env.DB.prepare(
        "SELECT bot_id, bot_name, token_var_name, system_prompt, welcome_message, menu_json, slug, webhook_secret FROM factory_bots",
      ).all();
      return Response.json(bots.results);
    }

    if (url.pathname.startsWith("/api/factory/bots/")) {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }
      const botId = url.pathname.split("/")[4];
      if (!botId) return new Response("bot_id required", { status: 400 });

      if (request.method === "DELETE") {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM factory_sessions WHERE key LIKE ?").bind(
            `${botId}:%`,
          ),
          env.DB.prepare(
            "DELETE FROM factory_callback_tokens WHERE bot_id = ?",
          ).bind(botId),
          env.DB.prepare(
            "DELETE FROM factory_processed_updates WHERE bot_id = ?",
          ).bind(botId),
          env.DB.prepare(
            "DELETE FROM factory_circuit_breaker WHERE bot_id = ?",
          ).bind(botId),
          env.DB.prepare("DELETE FROM factory_bots WHERE bot_id = ?").bind(
            botId,
          ),
        ]);
        return Response.json({ success: true });
      }

      if (request.method === "PATCH") {
        const body = await request.json();
        const validated = PatchConfigSchema.parse(body);

        const updates: string[] = [];
        const values: (string | number | undefined)[] = [];

        Object.entries(validated).forEach(([key, value]) => {
          if (value !== undefined) {
            updates.push(`${key} = ?`);
            values.push(value);
          }
        });

        if (updates.length === 0) return Response.json({ success: true });

        values.push(botId);
        await env.DB.prepare(
          `UPDATE factory_bots SET ${updates.join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE bot_id = ?`,
        )
          .bind(...values)
          .run();

        return Response.json({ success: true });
      }
    }

    // --- Sync Webhook API ---
    if (
      url.pathname === "/api/factory/sync-webhook" &&
      request.method === "POST"
    ) {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      const webhookUrl = `https://${request.headers.get("host") || url.host}/webhook/botfather`;
      const telegramUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${env.TITANIUM_API_SECRET}&allowed_updates=["message","callback_query"]`;

      try {
        const res = await fetch(telegramUrl);
        const data = (await res.json()) as {
          ok: boolean;
          description?: string;
        };

        if (data.ok) {
          return Response.json({ success: true, webhookUrl });
        }
        return Response.json(
          { success: false, error: data.description },
          { status: 500 },
        );
      } catch (err) {
        return Response.json(
          { success: false, error: String(err) },
          { status: 500 },
        );
      }
    }

    // Return not found as fallback
    return new Response("Not Found", { status: 404 });
  },
};
