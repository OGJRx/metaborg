import { Context, Bot } from "grammy";
import {
  CoreEnv,
  BorgContext,
  BorgExecutionContext,
  BotInfoPayload,
  BotInfoPayloadSchema,
} from "../types";
import { BorgLogger } from "../services/borg-logger";
import { Update } from "@grammyjs/types";

export interface InjectedUpdate extends Update {
  env: CoreEnv;
  executionContext: BorgExecutionContext;
}

function isInjectedUpdate(update: Update): update is InjectedUpdate {
  return (
    update !== null &&
    typeof update === "object" &&
    "env" in update &&
    "executionContext" in update
  );
}

export function setupBotMiddleware<C extends BorgContext<CoreEnv>>(
  bot: Bot<C>,
  componentName: string,
) {
  bot.use(async (ctx: C, next: () => Promise<void>) => {
    const update = ctx.update;
    if (isInjectedUpdate(update)) {
      if (!update.env || !update.executionContext) return;
      ctx.env = update.env;
      ctx.executionContext = update.executionContext;
    }

    ctx.traceId = ctx.executionContext?.traceId || crypto.randomUUID();
    ctx.logger = new BorgLogger(
      componentName,
      ctx.env?.DB,
      ctx.traceId,
      ctx.executionContext,
    );
    await next();
  });
}

export function idempotencyMiddleware() {
  return async (ctx: Context & { env: CoreEnv }, next: () => Promise<void>) => {
    const updateId = ctx.update.update_id;
    const userId = ctx.from?.id;
    const db = ctx.env?.DB;

    if (!userId || !db) return await next();

    try {
      await db
        .prepare(
          "INSERT INTO processed_updates (update_id, telegram_user_id) VALUES (?, ?)",
        )
        .bind(updateId, userId)
        .run();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      if (error.includes("UNIQUE constraint failed")) {
        console.log(`[Idempotency] Duplicate update ignored: ${updateId}`);
        return;
      }
      console.error(`[Idempotency] Error tracking update ${updateId}:`, error);
    }
    return await next();
  };
}

export function parseBotInfo(info?: string): BotInfoPayload {
  const defaults: BotInfoPayload = {
    id: 1,
    first_name: "Borg",
    username: "borg_bot",
    is_bot: true,
    can_join_groups: false,
    can_read_all_group_messages: false,
    can_manage_bots: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
  };

  if (info) {
    try {
      const parsed = JSON.parse(info);
      const result = BotInfoPayloadSchema.safeParse({ ...defaults, ...parsed });
      if (result.success) return result.data;
    } catch (_e) {
      /* ignore */
    }
  }
  return defaults;
}

export function isUpdate(update: unknown): update is Update {
  return (
    typeof update === "object" &&
    update !== null &&
    "update_id" in update &&
    typeof (update as Update).update_id === "number"
  );
}
