import {
  type ConversationData,
  conversations,
  createConversation,
  type VersionedState,
} from "@grammyjs/conversations";
import { D1Adapter } from "@grammyjs/storage-cloudflare";
import {
  Bot,
  type Context,
  InlineKeyboard,
  type StorageAdapter,
  session,
} from "grammy";
import type { Update } from "grammy/types";
import { RelationalSessionAdapter } from "./adapter";
import { setupBotFather } from "./botfather";
import {
  BotKindSetupRegistry,
  assertNever,
  setupBot,
} from "./registry";
import { BotKind } from "./schemas";
import type { CoreEnv, FactoryContext } from "./types";

// --- FACTORY ENGINE ---

export async function handleUpdate(
  botId: string,
  token: string,
  update: Update,
  env: CoreEnv,
  waitUntil: (promise: Promise<unknown>) => void,
  host = "unknown",
): Promise<Response> {
  if (!env?.DB) {
    console.error(
      JSON.stringify({
        level: "error",
        tag: "BINDING_MISSING",
        botId,
        error:
          "D1 binding 'DB' is undefined. Check wrangler.toml and Cloudflare dashboard.",
        timestamp: new Date().toISOString(),
      }),
    );
    return new Response("Service configuration error", { status: 503 });
  }

  const db = env.DB;

  if (!token?.includes(":") || token.length < 10) {
    console.error(`[FATAL] Invalid token for bot ${botId}`);
    return new Response("Unauthorized: Invalid Token Format", { status: 401 });
  }

  const botIdFromToken = token.split(":")[0];
  const parsedId = Number.parseInt(botIdFromToken ?? "0", 10);

  if (Number.isNaN(parsedId) || parsedId === 0) {
    console.error(`[FATAL] Could not derive ID from token for bot ${botId}`);
    return new Response("Unauthorized: Malformed Token", { status: 401 });
  }

  const botInfo = {
    id: parsedId,
    is_bot: true as const,
    first_name: botId === "botfather" ? "BuildBorg Factory" : "BuildBorg Bot",
    username:
      botId === "botfather"
        ? "BuildBorgFactoryBot"
        : `buildborg_bot_${botIdFromToken}`,
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };

  const bot = new Bot<FactoryContext>(token, { botInfo });

  const currentEnv = env;
  const currentBotId = botId;
  const currentHost = host;
  const currentWaitUntil = waitUntil;
  const _currentDb = db;

  bot.use(async (ctx, next) => {
    ctx.env = currentEnv;
    ctx.botId = currentBotId;
    ctx.host = currentHost;
    ctx.platform = "telegram";
    ctx.waitUntil = currentWaitUntil;
    await next();
  });

  // Session storage (Relational Adapter for Titanium Core)
  const sessionAdapter = new RelationalSessionAdapter(db);

  bot.use(
    session({
      initial: () => ({}),
      storage: sessionAdapter,
      getSessionKey: (ctx) => {
        const chatId = ctx.chat?.id.toString() ?? "unknown";
        return `session:${chatId}:${ctx.botId}`;
      },
    }),
  );

  // Post-session middleware to sync request context to session for conversation fallback
  bot.use(async (ctx, next) => {
    if (ctx.session) {
      ctx.session._titaniumEnv = currentEnv;
      ctx.session._titaniumBotId = currentBotId;
      ctx.session._titaniumHost = currentHost;
    }
    await next();
  });

  // Conversation storage (using dedicated factory_conversations table)
  const convoRaw = await D1Adapter.create<VersionedState<ConversationData>>(
    db,
    "factory_conversations",
  );
  const convoAdapter: StorageAdapter<VersionedState<ConversationData>> = {
    read: (key) => convoRaw.read(key),
    write: (key, value) => convoRaw.write(key, value),
    delete: (key) => convoRaw.delete(key),
  };

  bot.use(
    conversations({
      storage: {
        type: "key",
        adapter: convoAdapter,
        getStorageKey: (ctx: Context & { botId: string }) => {
          const chatId = ctx.chat?.id.toString() ?? "unknown";
          return `convo:${chatId}:${ctx.botId}`;
        },
      },
    }),
  );

  if (botId === "botfather") {
    setupBotFather(botId, bot);
  } else {
    // Lookup bot_kind to decide setup
    const botRow = await db
      .prepare(
        "SELECT bot_kind, config_json FROM factory_bots WHERE bot_id = ?",
      )
      .bind(botId)
      .first<{ bot_kind: BotKind; config_json: string }>();

    if (botRow) {
      const setup = BotKindSetupRegistry[botRow.bot_kind];
      if (setup) {
        setup(botId, bot, botRow.config_json);
      } else {
        assertNever(botRow.bot_kind as never);
      }
    } else {
      setupBot(botId, bot);
    }
  }

  // Attach env/botId/host/waitUntil to update for conversations plugin
  // Grammy's conversations creates new Context for waitFor() without running middleware
  // Mutating the update ensures the new ctx.update.env/botId are available
  Object.assign(update, {
    env: currentEnv,
    botId: currentBotId,
    host: currentHost,
    waitUntil: currentWaitUntil,
  });

  const runUpdate = async () => {
    try {
      await bot.handleUpdate(update);
    } catch (e) {
      console.error(
        JSON.stringify({
          level: "error",
          tag: "UPDATE_FAILURE",
          botId,
          envMissing: !currentEnv?.DB,
          error: String(e),
          timestamp: new Date().toISOString(),
        }),
      );
    }
  };

  waitUntil(runUpdate());

  return new Response("OK");
}

