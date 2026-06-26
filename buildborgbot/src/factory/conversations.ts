import type { Conversation } from "@grammyjs/conversations";
import { assertEnv } from "./guards";
import { upsertBotConfig } from "./platform";
import { GENERIC_AGENDADO_CONFIG, WORKSHOP_AGENDADO_CONFIG } from "./schemas";
import { getTemplate, listTemplates } from "./templates";
import type { FactoryContext } from "./types";

type Convo = Conversation<FactoryContext, FactoryContext>;

import { InlineKeyboard } from "grammy";

export async function newBotConversation(
  conversation: Convo,
  ctx: FactoryContext,
): Promise<void> {
  await ctx.reply(
    "🆕 <b>NUEVO BOT BORG</b>\n\nSelecciona el tipo de bot que deseas crear:",
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("💬 Chat Abierto (IA)", "kind:open_chat")
        .row()
        .text("📅 Agendado (Nuevo Negocio)", "kind:agendado")
        .row()
        .text("🚗 Taller Mecánico (Agendado)", "kind:tpl_workshop_agendado")
        .row()
        .text("🔧 Taller Mecánico (IA + OBD)", "kind:tpl_workshop_ai")
        .row()
        .text("🛠️ Especialista (OBD/Partes)", "kind:tool_specialist"),
    },
  );

  const kindCtx = await conversation.waitForCallbackQuery(/^kind:/, {
    maxMilliseconds: 5 * 60 * 1000,
  });

  // Defense: extract selection directly from callback data, don't rely on regex match array in re-entries
  const callbackData = kindCtx.callbackQuery?.data || "";
  const selection = callbackData.replace(/^kind:/, "") || "open_chat";

  const isAgendado =
    selection === "agendado" || selection === "tpl_workshop_agendado";
  const isFutureAI = selection === "tpl_workshop_ai";
  const botKind = isAgendado
    ? "agendado"
    : (selection as "open_chat" | "tool_specialist");

  console.log(
    JSON.stringify({
      level: "info",
      tag: "BOT_CREATION_KIND_SELECTED",
      selection,
      isAgendado,
      botKind,
      timestamp: new Date().toISOString(),
    }),
  );
  await kindCtx.answerCallbackQuery();

  if (isFutureAI) {
    await kindCtx.reply(
      "⚠️ <b>PLANTILLA EN DESARROLLO</b>\n\nEl bot de Taller Mecánico con IA + OBD estará disponible en la próxima actualización. Por ahora, usa la opción de Taller Mecánico (Agendado).",
      { parse_mode: "HTML" },
    );
    return;
  }

  let selectedTemplateId = "generic";
  if (selection === "tpl_workshop_agendado") {
    const templates = listTemplates();
    const keyboard = new InlineKeyboard();
    templates.forEach((t, i) => {
      keyboard.text(t.name, `tmpl:${t.id}`);
      if (i % 2 === 1) keyboard.row();
    });
    keyboard.row().text("GENÉRICO (Vacío)", "tmpl:generic");

    await kindCtx.reply(
      "📂 Selecciona la plantilla base para tu bot de agendado:",
      { parse_mode: "HTML", reply_markup: keyboard },
    );

    const tmplCtx = await conversation.waitForCallbackQuery(/^tmpl:/, {
      maxMilliseconds: 5 * 60 * 1000,
    });
    selectedTemplateId =
      tmplCtx.callbackQuery?.data?.replace(/^tmpl:/, "") || "generic";
    await tmplCtx.answerCallbackQuery();
  }

  await kindCtx.reply("🆔 Ingresa el ID único del bot (slug):", {
    parse_mode: "HTML",
  });
  const botIdCtx = await conversation.waitFor("message:text", {
    maxMilliseconds: 5 * 60 * 1000,
  });
  const botId = botIdCtx.message.text.trim();

  // Validation: alpha-numeric, underscores, dashes, 1-64 chars.
  const botIdRegex = /^[a-zA-Z0-9_-]{1,64}$/;
  const reservedSlugs = ["botfather", "api", "health", "webhook"];
  if (!botIdRegex.test(botId) || reservedSlugs.includes(botId.toLowerCase())) {
    await botIdCtx.reply(
      "❌ <b>ID INVÁLIDO</b>\n\nEl ID solo puede contener letras, números, guiones y guiones bajos (máx 64 caracteres), y no puede ser una palabra reservada. Reinicia el proceso con /newbot.",
      { parse_mode: "HTML" },
    );
    return;
  }

  await botIdCtx.reply("📛 Ingresa el nombre público del bot:", {
    parse_mode: "HTML",
  });
  const botNameCtx = await conversation.waitFor("message:text", {
    maxMilliseconds: 5 * 60 * 1000,
  });
  const botName = botNameCtx.message.text;

  await botNameCtx.reply(
    "🔑 Ingresa el <b>Telegram Bot Token</b> (ej: <code>12345:ABCDE...</code>):",
    {
      parse_mode: "HTML",
    },
  );
  const tokenCtx = await conversation.waitFor("message:text", {
    maxMilliseconds: 5 * 60 * 1000,
  });
  const botToken = tokenCtx.message.text;

  let systemPrompt = "";
  if (!isAgendado) {
    await tokenCtx.reply("📜 Ingresa el System Prompt (instrucciones de IA):", {
      parse_mode: "HTML",
    });
    const promptCtx = await conversation.waitFor("message:text", {
      maxMilliseconds: 5 * 60 * 1000,
    });
    systemPrompt = promptCtx.message.text;
  }

  await tokenCtx.reply("⏳ Procesando creación...");

  try {
    assertEnv(tokenCtx);
    const result = await conversation.external(() =>
      upsertBotConfig(
        tokenCtx.env.DB,
        tokenCtx.env,
        {
          bot_id: botId,
          bot_name: botName,
          token: botToken,
          token_var_name: `BOT_TOKEN_${botId
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "_")}`,
          system_prompt: systemPrompt,
          welcome_message: `¡Hola! Soy ${botName}. ¿En qué puedo ayudarte?`,
          menu_json: "[]",
          bot_kind: botKind,
          config_json: isAgendado
            ? JSON.stringify(
                getTemplate(selectedTemplateId) || GENERIC_AGENDADO_CONFIG,
              )
            : JSON.stringify({
                system_prompt: systemPrompt,
                welcome_message: `¡Hola! Soy ${botName}. ¿En qué puedo ayudarte?`,
                menu_json: "[]",
              }),
        },
        tokenCtx.host,
      ),
    );

    if (result.success) {
      if (result.webhook_ok) {
        let msg = `✅ <b>BOT CREADO</b>\n\nID: <code>${botId}</code>\nURL Webhook: <code>/webhook/${botId}</code>`;
        let keyboard: InlineKeyboard | undefined;

        if (botKind === "agendado") {
          msg +=
            "\n\n⚙️ <b>CONFIGURACIÓN PENDIENTE:</b> Este bot de agendado requiere personalización (steps, horarios, etc). Usa el botón de abajo para abrir el editor visual.";
          const webAppUrl = `https://${tokenCtx.host}/app/${botId}`;
          keyboard = new InlineKeyboard().webApp("🛠️ Abrir Editor", webAppUrl);
        }

        // @ts-expect-error - InlineKeyboard is compatible with reply_markup
        await tokenCtx.reply(msg, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
      } else {
        await tokenCtx.reply(
          `⚠️ <b>BOT CREADO CON ADVERTENCIA</b>\n\nID: <code>${botId}</code>\n\nEl bot se registró correctamente pero el <b>webhook NO pudo configurarse</b>.\n\nError: <code>${result.webhook_error}</code>\n\nEl bot no recibirá mensajes hasta que se resuelva este problema. Puedes intentar actualizarlo nuevamente más tarde.`,
          {
            parse_mode: "HTML",
          },
        );
      }
    } else {
      await tokenCtx.reply(
        `❌ Error al crear bot: ${result.error ?? "Unknown error"}`,
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        tag: "NEW_BOT_CONVO_ERROR",
        botId,
        error: String(err),
        timestamp: new Date().toISOString(),
      }),
    );
    await tokenCtx.reply(`❌ Error crítico: ${String(err)}`);
  }
}

export async function feedbackConversation(
  conversation: Convo,
  ctx: FactoryContext,
): Promise<void> {
  await ctx.reply(
    "<b>BUZÓN DE RETROALIMENTACIÓN BORG</b>\n\nDescribe tu problema, sugerencia o reporte de error:",
    {
      parse_mode: "HTML",
    },
  );

  const feedbackCtx = await conversation.waitFor("message:text", {
    maxMilliseconds: 5 * 60 * 1000, // 5 minutos TTL
  });

  if (!feedbackCtx.message?.text) {
    await feedbackCtx.reply(
      "⚠️ Tiempo agotado. La sesión de feedback ha sido cerrada.",
    );
    return;
  }

  const feedback = feedbackCtx.message.text;

  await conversation.external(async () => {
    assertEnv(feedbackCtx);
    await feedbackCtx.env.DB.prepare(
      "INSERT INTO factory_feedback (bot_id, chat_id, user_id, content) VALUES (?, ?, ?, ?)",
    )
      .bind(
        feedbackCtx.botId,
        String(feedbackCtx.chat?.id ?? 0),
        feedbackCtx.from?.id ?? 0,
        feedback,
      )
      .run();
  });

  await feedbackCtx.reply(
    "✅ <b>REGISTRO EXITOSO</b>\n\nTu feedback ha sido almacenado en la memoria central. Gracias por contribuir a la evolución del enjambre.",
    {
      parse_mode: "HTML",
    },
  );
}
