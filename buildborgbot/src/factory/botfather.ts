import { createConversation } from "@grammyjs/conversations";
import { type Bot, InlineKeyboard } from "grammy";
import { buildCallback, parseCallback } from "./callback";
import { newBotConversation } from "./conversations";
import { assertEnv } from "./guards";
import type { FactoryContext } from "./types";

/**
 * BotFather Administrative Handlers
 */

export function setupBotFather(_botId: string, bot: Bot<FactoryContext>) {
  bot.use(createConversation(newBotConversation));

  bot.command("start", async (ctx) => {
    assertEnv(ctx);
    const db = ctx.env.DB;
    const apiSecret = ctx.env.TITANIUM_API_SECRET;

    const cbTemplates = await buildCallback(db, apiSecret, {
      bot_id: "botfather",
      action: "bf_templates",
      payload: "",
    });
    const cbBots = await buildCallback(db, apiSecret, {
      bot_id: "botfather",
      action: "bf_mybots",
      payload: "",
    });
    const cbHelp = await buildCallback(db, apiSecret, {
      bot_id: "botfather",
      action: "bf_help",
      payload: "",
    });

    const host = ctx.env.WORKER_HOST;
    const keyboard = new InlineKeyboard()
      .text("📋 Plantillas Bots", cbTemplates)
      .text("📋 Mis Bots", cbBots)
      .row()
      .webApp("🚀 Personalización Profunda", `https://${host}/app/botfather`)
      .row()
      .text("❓ Ayuda", cbHelp);

    await ctx.reply(
      "🤖 <b>UNIDAD CENTRAL FACTORY</b>\n\nBienvenido al núcleo de creación. Soy el BotFather de nueva generación.\n\nOptimiza tus operaciones mediante los siguientes módulos:",
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  });

  bot.command("newbot", async (ctx) => {
    await ctx.conversation.enter("newBotConversation");
  });

  bot.command("mybots", async (ctx) => {
    assertEnv(ctx);
    const bots = await ctx.env.DB.prepare(
      "SELECT bot_name, slug FROM factory_bots",
    ).all<{ bot_name: string; slug: string }>();

    const results = bots.results || [];

    if (results.length === 0) {
      return await ctx.reply("No tienes bots registrados.");
    }

    let list = "<b>Tus Bots:</b>\n\n";
    const host = ctx.env.WORKER_HOST;

    for (const bot of results) {
      list += `• ${bot.bot_name} (<code>${bot.slug}</code>)\n`;
    }

    const keyboard = new InlineKeyboard().webApp(
      "🛠️ Editor",
      `https://${host}/app/botfather`,
    );

    await ctx.reply(list, { parse_mode: "HTML", reply_markup: keyboard });
  });

  bot.command("deletebot", async (ctx) => {
    assertEnv(ctx);
    const slug = ctx.match;
    if (!slug) {
      return await ctx.reply("Usa: /deletebot {slug}");
    }

    const db = ctx.env.DB;
    const bot = await db
      .prepare("SELECT bot_id FROM factory_bots WHERE slug = ?")
      .bind(slug)
      .first<{ bot_id: string }>();

    if (!bot) {
      return await ctx.reply("❌ Bot no encontrado.");
    }

    await db.batch([
      db
        .prepare("DELETE FROM factory_sessions WHERE bot_id = ?")
        .bind(bot.bot_id),
      db
        .prepare("DELETE FROM factory_callback_tokens WHERE bot_id = ?")
        .bind(bot.bot_id),
      db
        .prepare("DELETE FROM factory_processed_updates WHERE bot_id = ?")
        .bind(bot.bot_id),
      db
        .prepare("DELETE FROM factory_circuit_breaker WHERE bot_id = ?")
        .bind(bot.bot_id),
      db.prepare("DELETE FROM factory_bots WHERE bot_id = ?").bind(bot.bot_id),
    ]);

    await ctx.reply(`✅ Bot <code>${slug}</code> eliminado con éxito.`, {
      parse_mode: "HTML",
    });
  });

  // Action dispatcher for BotFather signed callbacks
  bot.on("callback_query:data", async (ctx, next) => {
    assertEnv(ctx);
    const db = ctx.env.DB;
    const apiSecret = ctx.env.TITANIUM_API_SECRET;
    const parsed = await parseCallback(
      db,
      apiSecret,
      "botfather",
      ctx.callbackQuery.data,
    );

    if (!parsed) return await next();

    const { action } = parsed;

    if (action === "bf_templates") {
      await ctx.answerCallbackQuery();
      const kbOpenChat = await buildCallback(db, apiSecret, {
        bot_id: "botfather",
        action: "bf_newbot_template",
        payload: "open_chat",
      });
      const kbAgendado = await buildCallback(db, apiSecret, {
        bot_id: "botfather",
        action: "bf_newbot_template",
        payload: "agendado_generic",
      });
      const kbWorkshop = await buildCallback(db, apiSecret, {
        bot_id: "botfather",
        action: "bf_newbot_template",
        payload: "agendado_workshop",
      });
      const kbSpecialist = await buildCallback(db, apiSecret, {
        bot_id: "botfather",
        action: "bf_newbot_template",
        payload: "tool_specialist",
      });

      await ctx.reply(
        "📋 <b>GALERÍA DE PLANTILLAS</b>\n\n" +
          "<b>1. Chat Abierto (IA)</b>\n" +
          "Ideal para atención al cliente general o asistentes personales. Tú defines su personalidad.\n\n" +
          "<b>2. Agendado Nuevo</b>\n" +
          "Sistema de citas genérico personalizable para cualquier rubro (estética, consultoría, etc).\n\n" +
          "<b>3. Agendado Taller</b>\n" +
          "Plantilla optimizada para talleres mecánicos, con pasos predefinidos para vehículos.\n\n" +
          "<b>4. Especialista Taller (IA+OBD)</b>\n" +
          "El bot más avanzado. Combina IA con base de datos de códigos OBD para diagnóstico técnico.",
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("💬 IA", kbOpenChat)
            .text("📅 Citas", kbAgendado)
            .row()
            .text("🚗 Taller", kbWorkshop)
            .text("🔧 Especialista", kbSpecialist),
        },
      );
    } else if (action === "bf_newbot_template") {
      await ctx.answerCallbackQuery();
      const template = parsed.payload;
      await ctx.conversation.enter("newBotConversation", template);
    } else if (action === "bf_mybots") {
      await ctx.answerCallbackQuery();
      const bots = await ctx.env.DB.prepare(
        "SELECT bot_name, slug FROM factory_bots",
      ).all<{ bot_name: string; slug: string }>();
      const results = bots.results || [];
      if (results.length === 0) {
        await ctx.reply("No tienes bots registrados.");
      } else {
        let list = "<b>Tus Bots:</b>\n\n";
        const host = ctx.env.WORKER_HOST;
        for (const bot of results) {
          list += `• ${bot.bot_name} (<code>${bot.slug}</code>)\n`;
        }
        const keyboard = new InlineKeyboard().webApp(
          "🛠️ Editor",
          `https://${host}/app/botfather`,
        );
        await ctx.reply(list, { parse_mode: "HTML", reply_markup: keyboard });
      }
    } else if (action === "bf_help") {
      await ctx.answerCallbackQuery();
      await ctx.reply(
        "<b>Guía de Comandos</b>\n\n" +
          "/start - Menú principal\n" +
          "/newbot - Crear un nuevo bot\n" +
          "/mybots - Listar tus bots\n" +
          "/deletebot {slug} - Eliminar un bot",
        { parse_mode: "HTML" },
      );
    } else {
      await next();
    }
  });
}
