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
import { assertNever, BotKindSetupRegistry, setupOrphanBot } from "./registry";
import type { BotKind } from "./schemas";
import {
  type CoreEnv,
  type FactoryContext,
  type TitaniumSession,
} from "./types";

// --- FACTORY ENGINE ---

// Use WeakRef to allow GC of old bot instances while keeping them cached for performance
const botCache = new Map<string, WeakRef<Bot<FactoryContext>>>();

// Map incoming updates to their respective environments without polluting the Update object with Symbols
const updateEnvMap = new WeakMap<Update, CoreEnv>();

export function getUpdateEnv(update: Update): CoreEnv | undefined {
  return updateEnvMap.get(update);
}

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

  let botRef = botCache.get(botId);
  let bot = botRef?.deref();

  if (!bot) {
    bot = new Bot<FactoryContext>(token, { botInfo });
    botCache.set(botId, new WeakRef(bot));

    await setupBotMiddleware(bot, botId, env, waitUntil, host);
  }

  const currentEnv = env;
  const currentBotId = botId;
  const currentHost = host;
  const currentWaitUntil = waitUntil;

  // Store env in WeakMap associated with the update object
  updateEnvMap.set(update, currentEnv);

  // Attach other metadata to update (safe as they are serializable or just strings)
  Object.assign(update, {
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
    // Retrieve request-specific context from the update object or WeakMap
    const reqContext = ctx.update as unknown as {
      host?: string;
      waitUntil?: (promise: Promise<unknown>) => void;
    };

    const injectedEnv = updateEnvMap.get(ctx.update);

    console.log(
      JSON.stringify({
        tag: "MW_INJECT",
        botId,
        hasInjectedEnv: !!injectedEnv,
        hasFallback: !!env.DB,
        timestamp: new Date().toISOString(),
      }),
    );

    ctx.env = injectedEnv || env;
    ctx.botId = botId;
    ctx.host = reqContext.host || _host;
    ctx.platform = "telegram";
    ctx.waitUntil = reqContext.waitUntil || _waitUntil;

    await next();
  });

  // Session storage
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

  bot.use(async (ctx, next) => {
    if (ctx.session) {
      ctx.session._titaniumBotId = ctx.botId;
      ctx.session._titaniumHost = ctx.host;
      ctx.session._titaniumPlatform = ctx.platform;
    }
    await next();
  });

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
      setupOrphanBot(botId, bot);
    }
  }
}
