import {
  type ConversationData,
  conversations,
  type VersionedState,
} from "@grammyjs/conversations";
import { D1Adapter } from "@grammyjs/storage-cloudflare";
import { Bot, type Context, MemorySessionStorage, session } from "grammy";
import type { Update } from "grammy/types";
import { RelationalSessionAdapter } from "./adapter";
import { setupBotFather } from "./botfather";
import {
  assertNever,
  BotKindSetupRegistry,
  setupOrphanBot,
} from "./registry";
import type { BotKind } from "./schemas";
import {
  type CoreEnv,
  FACTORY_ENV_SYMBOL,
  type FactoryContext,
  type TitaniumSession,
} from "./types";

// --- FACTORY ENGINE ---

const botCache = new Map<string, Bot<FactoryContext>>();

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

  const _db = env.DB;

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

  let bot = botCache.get(botId);

  if (!bot) {
    bot = new Bot<FactoryContext>(token, { botInfo });
    botCache.set(botId, bot);

    await setupBotMiddleware(bot, botId, env, waitUntil, host);
  }

  const currentEnv = env;
  const currentBotId = botId;
  const currentHost = host;
  const currentWaitUntil = waitUntil;

  // Attach env/botId/host/waitUntil to update for conversations plugin
  // Grammy's conversations creates new Context for waitFor() without running middleware
  // Mutating the update ensures the new ctx.update.env/botId are available
  // We use FACTORY_ENV_SYMBOL to prevent D1 bindings from being serialized into sessions
  Object.assign(update, {
    [FACTORY_ENV_SYMBOL]: currentEnv,
    botId: currentBotId,
    host: currentHost,
    waitUntil: currentWaitUntil,
  });

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
    // Even if it fails, we usually want to return 200 to Telegram unless we want them to retry
    // For MVP, let's just return 200 and rely on logs.
  }

  return new Response("OK");
}

async function setupBotMiddleware(
  bot: Bot<FactoryContext>,
  botId: string,
  env: CoreEnv,
  _waitUntil: (promise: Promise<unknown>) => void,
  _host: string,
): Promise<void> {
  const db = env.DB;

  bot.use(async (ctx, next) => {
    // Retrieve request-specific context from the update object
    const reqContext = ctx.update as unknown as {
      [FACTORY_ENV_SYMBOL]?: CoreEnv;
      host?: string;
      waitUntil?: (promise: Promise<unknown>) => void;
    };

    // Use closure-captured fallbacks if the update-based injection failed
    // This is critical for conversation re-entries where grammY might clone the context/update
    const injectedEnv = reqContext[FACTORY_ENV_SYMBOL];
    ctx.env = injectedEnv || ctx.session?._titaniumEnv || env;

    // Persist in session to survive waitFor re-entries in conversations
    if (injectedEnv && ctx.session) {
      ctx.session._titaniumEnv = injectedEnv;
    }

    ctx.botId = botId;
    ctx.host = reqContext.host || _host;
    ctx.platform = "telegram";
    ctx.waitUntil = reqContext.waitUntil || _waitUntil;

    await next();
  });

  // Session storage
  // BotFather uses memory storage to avoid FK constraints (it's not in factory_bots table)
  // All other bots use RelationalSessionAdapter
  const sessionAdapter =
    botId === "botfather"
      ? new MemorySessionStorage<TitaniumSession>()
      : new RelationalSessionAdapter(db);

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

  // Post-session middleware to sync request context to session metadata
  bot.use(async (ctx, next) => {
    if (ctx.session) {
      // We no longer store the entire 'env' in the session because it contains
      // non-serializable D1 bindings. handleUpdate already injects 'env' into ctx.update.
      ctx.session._titaniumBotId = ctx.botId;
      ctx.session._titaniumHost = ctx.host;
      ctx.session._titaniumPlatform = ctx.platform;
    }
    await next();
  });

  // Conversation storage (using dedicated factory_conversations table)
  const convoAdapter = await D1Adapter.create<VersionedState<ConversationData>>(
    db,
    "factory_conversations",
  );

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
    // Lookup bot_kind to decide setup during initialization
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
      // Bot not in DB or unrecognized kind — safe fallback, NO AI
      setupOrphanBot(botId, bot);
    }
  }
}
