import { createConversation } from "@grammyjs/conversations";
import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { buildCallback, parseCallback } from "./callback";
import { feedbackConversation } from "./conversations";
import { handleAgendadoUpdate } from "./flows/agendado";
import { handleToolSpecialistUpdate } from "./flows/specialist";
import {
  handleAction,
  handleConfirmAndProcess,
  handleSummarize,
} from "./handlers";
import { aiGlobalLoopMiddleware } from "./middleware/aiGlobalLoop";
import {
  AgendadoConfigSchema,
  type BotKind,
  MenuSchema,
  ToolSpecialistConfigSchema,
} from "./schemas";
import type { FactoryContext, Menu } from "./types";

export type SetupFn = (
  botId: string,
  bot: Bot<FactoryContext>,
  configJson: string,
) => void;

export const BotKindSetupRegistry: Record<BotKind, SetupFn> = {
  open_chat: setupBot,
  agendado: setupAgendadoBot,
  tool_specialist: setupSpecialistBot,
  kernel_admin: setupKernelAdminBot,
} as const;

export function assertNever(
  x: never,
  msg = "Exhaustiveness check failed",
): never {
  throw new Error(`${msg}: ${JSON.stringify(x)}`);
}

export function setupBot(
  botId: string,
  bot: Bot<FactoryContext>,
  _configJson?: string,
) {
  bot.use(createConversation(feedbackConversation));

  // Inyectar el loop global para procesamiento IA sin confirmación
  bot.use(aiGlobalLoopMiddleware);

  bot.command("start", async (ctx) => {
    const currentDb = ctx.env.DB;
    const config = await currentDb
      .prepare(
        "SELECT welcome_message, menu_json FROM factory_bots WHERE bot_id = ?",
      )
      .bind(ctx.botId)
      .first<{ welcome_message: string; menu_json: string }>();

    if (!config) return;

    const keyboard = new InlineKeyboard();
    let menu: Menu = [];
    try {
      const parsed = JSON.parse(config.menu_json);
      menu = MenuSchema.parse(parsed);
      for (let i = 0; i < menu.length; i++) {
        const btn = menu[i];
        if (!btn) continue;
        const cb = await buildCallback(currentDb, ctx.env.TITANIUM_API_SECRET, {
          bot_id: ctx.botId,
          action: btn.action,
          payload: "",
        });
        keyboard.text(btn.label, cb);
        if (i % 2 === 1) keyboard.row();
      }
    } catch (e) {
      console.error(
        JSON.stringify({
          level: "error",
          tag: "MENU_PARSING_ERROR",
          botId: ctx.botId,
          error: String(e),
          timestamp: new Date().toISOString(),
        }),
      );
    }

    await ctx.reply(config.welcome_message, {
      reply_markup: keyboard,
    });

    const replyKeyboard: {
      keyboard: { text: string }[][];
      resize_keyboard: boolean;
    } = {
      keyboard: [],
      resize_keyboard: true,
    };

    menu.forEach((btn) => {
      replyKeyboard.keyboard.push([{ text: btn.label }]);
    });

    if (replyKeyboard.keyboard.length > 0) {
      await ctx.reply("Accediendo al menú...", {
        reply_markup: replyKeyboard,
      });
    }
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.message.text.startsWith("/")) return await next();

    const db = ctx.env.DB;
    const config = await db
      .prepare("SELECT menu_json FROM factory_bots WHERE bot_id = ?")
      .bind(ctx.botId)
      .first<{ menu_json: string }>();

    if (config) {
      try {
        const parsed = JSON.parse(config.menu_json);
        const menu = MenuSchema.parse(parsed);
        const match = menu.find((btn) => btn.label === ctx.message.text);
        if (match) {
          return await handleAction(ctx, match.action);
        }
      } catch (e) {
        console.error(
          JSON.stringify({
            level: "error",
            tag: "MENU_MATCH_ERROR",
            botId: ctx.botId,
            error: String(e),
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }
    await next();
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const db = ctx.env.DB;
    const apiSecret = ctx.env.TITANIUM_API_SECRET;

    const parsed = await parseCallback(db, apiSecret, ctx.botId, data);
    if (!parsed) {
      if (data === "fact_summarize") {
        await handleSummarize(ctx);
      }
      return await ctx.answerCallbackQuery("⚠️ Sesión expirada o inválida.");
    }

    const { action, payload } = parsed;

    if (action === "feedback" || action.startsWith("sequence_")) {
      await handleAction(ctx, action);
    } else if (action === "fact_exec") {
      const msgId = Number.parseInt(payload, 10);
      if (!Number.isNaN(msgId)) {
        await handleConfirmAndProcess(ctx, msgId);
      }
    } else if (action === "fact_summarize") {
      await handleSummarize(ctx);
    } else {
      await handleAction(ctx, action);
    }

    await ctx.answerCallbackQuery().catch((err: unknown) => {
      console.error(
        JSON.stringify({
          level: "error",
          tag: "CALLBACK_QUERY_ERROR",
          botId: ctx.botId,
          chatId: ctx.chat?.id,
          error: String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    });
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;

    if (!ctx.chat) return;

    // Persistencia básica del mensaje del usuario
    await ctx.env.DB.prepare(
      "INSERT INTO factory_messages (bot_id, chat_id, role, content) VALUES (?, ?, 'user', ?)",
    )
      .bind(ctx.botId, String(ctx.chat.id), text)
      .run();
  });

  bot.catch(async (err) => {
    console.error(
      JSON.stringify({
        level: "error",
        tag: "GRAMMY_ERROR",
        botId: botId,
        error: String(err),
        timestamp: new Date().toISOString(),
      }),
    );
    try {
      if (err.ctx) {
        await err.ctx.reply("⚠️ Error interno. Por favor, intenta de nuevo.", {
          parse_mode: "HTML",
        });
      }
    } catch (_replyErr) {
      // Ignore errors during reply in catch
    }
  });
}

export function setupAgendadoBot(
  botId: string,
  bot: Bot<FactoryContext>,
  configJson: string,
) {
  try {
    const config = AgendadoConfigSchema.parse(JSON.parse(configJson));

    // GUARD: Agendado bots must NEVER have AI processing
    // If system_prompt is present in config, log warning
    if (configJson.includes("system_prompt")) {
      console.warn(
        JSON.stringify({
          level: "warn",
          tag: "AGENDADO_AI_CONTAMINATION",
          botId,
          message:
            "Agendado bot config contains AI-related fields. This is a configuration error.",
          timestamp: new Date().toISOString(),
        }),
      );
    }

    bot.on(["message", "callback_query"], async (ctx) => {
      await handleAgendadoUpdate(ctx, config);
    });
  } catch (e) {
    console.error(`Failed to parse agendado config for bot ${botId}: ${e}`);
  }

  bot.catch(async (err) => {
    console.error(
      JSON.stringify({
        level: "error",
        tag: "GRAMMY_AGENDADO_ERROR",
        botId: botId,
        error: String(err),
        timestamp: new Date().toISOString(),
      }),
    );
  });
}

export function setupSpecialistBot(
  botId: string,
  bot: Bot<FactoryContext>,
  configJson: string,
) {
  try {
    const _config = ToolSpecialistConfigSchema.parse(JSON.parse(configJson));

    // Inyectar el loop global para procesamiento IA sin confirmación
    bot.use(aiGlobalLoopMiddleware);

    bot.on("message:text", async (ctx) => {
      await handleToolSpecialistUpdate(ctx, _config);
    });
  } catch (e) {
    console.error(
      JSON.stringify({
        level: "error",
        tag: "TOOL_SPECIALIST_CONFIG_INVALID",
        botId,
        error: String(e),
        timestamp: new Date().toISOString(),
      }),
    );
  }
}

export function setupKernelAdminBot(
  botId: string,
  bot: Bot<FactoryContext>,
  _configJson: string,
) {
  console.log(
    JSON.stringify({
      level: "info",
      tag: "KERNEL_ADMIN_INIT",
      botId,
      timestamp: new Date().toISOString(),
    }),
  );
  bot.command("start", async (ctx) => {
    await ctx.reply("🔧 Kernel Admin Bot — Pendiente de implementación", {
      parse_mode: "HTML",
    });
  });
}

export function setupOrphanBot(botId: string, bot: Bot<FactoryContext>) {
  console.log(
    JSON.stringify({
      level: "warn",
      tag: "ORPHAN_BOT_FALLBACK",
      botId,
      message:
        "Bot not found in factory_bots or has unknown bot_kind. Running safe fallback.",
      timestamp: new Date().toISOString(),
    }),
  );

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "⚠️ Este bot no está configurado correctamente. Contacta al administrador de la fábrica.",
      { parse_mode: "HTML" },
    );
  });

  // Reject all messages — NO AI processing
  bot.on("message:text", async (ctx) => {
    await ctx.reply(
      "⚠️ Bot sin configurar. Usa el comando /start para más información.",
    );
  });

  bot.catch(async (err) => {
    console.error(
      JSON.stringify({
        level: "error",
        tag: "GRAMMY_ORPHAN_ERROR",
        botId,
        error: String(err),
        timestamp: new Date().toISOString(),
      }),
    );
  });
}
