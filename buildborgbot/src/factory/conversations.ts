import type { Conversation } from "@grammyjs/conversations";
import { assertEnv } from "./guards";
import { upsertBotConfig } from "./platform";
import {
  AGENT_PROMPTS,
  GENERIC_AGENDADO_CONFIG,
  WORKSHOP_AGENDADO_CONFIG,
} from "./schemas";
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
        .text("📅 Agendado Nuevo", "kind:agendado_generic")
        .row()
        .text("🚗 Agendado Taller Mecánico", "kind:agendado_workshop")
        .row()
        .text("🔧 Especialista Taller (IA+OBD)", "kind:tool_specialist"),
    },
  );

  const kindCtx = await conversation.waitForCallbackQuery(/^kind:/, {
    maxMilliseconds: 5 * 60 * 1000,
  });

  // Defense: extract selection directly from callback data, don't rely on regex match array in re-entries
  const callbackData = kindCtx.callbackQuery?.data || "";
  const selection = callbackData.replace(/^kind:/, "") || "open_chat";

  const isAgendado =
    selection === "agendado_generic" || selection === "agendado_workshop";
  const botKind = isAgendado
    ? "agendado"
    : (selection as "open_chat" | "tool_specialist");

  const agendadoConfig =
    selection === "agendado_workshop"
      ? WORKSHOP_AGENDADO_CONFIG
      : GENERIC_AGENDADO_CONFIG;

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

  await kindCtx.reply(
    "🔑 Ingresa el <b>Telegram Bot Token</b> (ej: <code>12345:ABCDE...</code>):",
    {
      parse_mode: "HTML",
    },
  );
  const botTokenCtx = await conversation.waitFor("message:text", {
    maxMilliseconds: 5 * 60 * 1000,
  });
  const botToken = botTokenCtx.message.text.trim();

  await botTokenCtx.reply("⏳ Validando token y obteniendo información...");

  let botInfo: { id: number; first_name: string; username?: string };
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = (await res.json()) as {
      ok: boolean;
      result: { id: number; first_name: string; username?: string };
    };
    if (!data.ok) throw new Error("Token inválido");
    botInfo = data.result;
  } catch (_err) {
    await botTokenCtx.reply(
      "❌ <b>TOKEN INVÁLIDO</b>\n\nNo se pudo obtener información del bot. Verifica el token y reinicia con /newbot.",
      { parse_mode: "HTML" },
    );
    return;
  }

  const botName = botInfo.first_name;
  const botId = botInfo.username || `bot_${botInfo.id}`;

  let systemPrompt = "";
  let liveCtx = botTokenCtx;

  if (botKind === "open_chat") {
    await botTokenCtx.reply(
      `📜 <b>Bot: ${botName}</b>\n\nIngresa el System Prompt (instrucciones de IA). Si deseas usar el valor por defecto, escribe "skip":`,
      {
        parse_mode: "HTML",
      },
    );
    const promptCtx = await conversation.waitFor("message:text", {
      maxMilliseconds: 5 * 60 * 1000,
    });
    systemPrompt =
      promptCtx.message.text.toLowerCase() === "skip"
        ? "Eres un asistente útil y estratégico."
        : promptCtx.message.text;
    liveCtx = promptCtx;
  } else if (botKind === "tool_specialist") {
    systemPrompt = AGENT_PROMPTS.OBD_DIAGNOSTICO;
  }

  await liveCtx.reply("⏳ Procesando registro en la colmena...");

  try {
    // Assert environment on the latest context to ensure live bindings
    assertEnv(liveCtx);

    const result = await conversation.external(() =>
      upsertBotConfig(liveCtx.env.DB, liveCtx.env, {
        bot_id: botId,
        bot_name: botName,
        token: botToken,
        token_var_name: `BOT_TOKEN_${botId
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "_")}`,
        system_prompt: systemPrompt,
        welcome_message: isAgendado
          ? agendadoConfig.business_identity.welcome_message
          : `¡Hola! Soy ${botName}. ¿En qué puedo ayudarte?`,
        menu_json: "[]",
        bot_kind: botKind,
        owner_id: liveCtx.from?.id,
        config_json: isAgendado
          ? JSON.stringify(agendadoConfig)
          : JSON.stringify({
              system_prompt: systemPrompt,
              welcome_message: `¡Hola! Soy ${botName}. ¿En qué puedo ayudarte?`,
              menu_json: "[]",
              ...(botKind === "tool_specialist" && {
                lookup_source: "obd_db",
              }),
            }),
      }),
    );

    if (result.success) {
      if (result.webhook_ok) {
        let msg = `✅ <b>BOT CREADO</b>\n\nID: <code>${botId}</code>\nURL Webhook: <code>/webhook/${botId}</code>`;
        let keyboard: InlineKeyboard | undefined;

        if (botKind === "agendado") {
          msg +=
            "\n\n⚙️ <b>CONFIGURACIÓN PENDIENTE:</b> Este bot de agendado requiere personalización (steps, horarios, etc). Usa el botón de abajo para abrir el editor visual.";
          const webAppUrl = `https://${liveCtx.env.WORKER_HOST}/app/${botId}`;
          keyboard = new InlineKeyboard().webApp("🛠️ Abrir Editor", webAppUrl);
        }

        // @ts-expect-error - InlineKeyboard is compatible with reply_markup
        await liveCtx.reply(msg, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
      } else {
        await liveCtx.reply(
          `⚠️ <b>BOT CREADO CON ADVERTENCIA</b>\n\nID: <code>${botId}</code>\n\nEl bot se registró correctamente pero el <b>webhook NO pudo configurarse</b>.\n\nError: <code>${result.webhook_error}</code>\n\nEl bot no recibirá mensajes hasta que se resuelva este problema. Puedes intentar actualizarlo nuevamente más tarde.`,
          {
            parse_mode: "HTML",
          },
        );
      }
    } else {
      await liveCtx.reply(
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
    await liveCtx.reply(`❌ Error crítico: ${String(err)}`).catch(() => {});
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
