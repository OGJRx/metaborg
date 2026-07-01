import type { CoreEnv } from "../types";

export async function notifyFactoryOfTicket(
  env: CoreEnv,
  botId: string,
  botName: string,
  ticket: {
    ticketId: string;
    fechaCita: string;
    horaCita: string;
    stepData: Record<string, string>;
  },
) {
  try {
    // 1. Get owner_id from database
    const bot = await env.DB.prepare(
      "SELECT owner_id FROM factory_bots WHERE bot_id = ?",
    )
      .bind(botId)
      .first<{ owner_id: string }>();

    if (!bot?.owner_id) {
      console.warn(`[Notify] No owner found for bot ${botId}`);
      return;
    }

    const ownerId = bot.owner_id;

    // 2. Build notification message
    const nombre = ticket.stepData["nombre"] || "Cliente";
    const servicio = ticket.stepData["servicio"] || "Servicio general";

    const message =
      `🔔 <b>NUEVA CITA — ${botName}</b>\n\n` +
      `👤 <b>Cliente:</b> ${nombre}\n` +
      `📅 <b>Fecha:</b> ${ticket.fechaCita}\n` +
      `⏰ <b>Hora:</b> ${ticket.horaCita}\n` +
      `🔧 <b>Servicio:</b> ${servicio}\n` +
      `🆔 <b>Ticket:</b> <code>${ticket.ticketId}</code>\n\n` +
      `<i>Gestiona tus bots en el BotFather.</i>`;

    // 3. Send via Telegram Bot API (Factory Bot)
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ownerId,
        text: message,
        parse_mode: "HTML",
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error(`[Notify] Telegram API error: ${error}`);
    } else {
      console.log(`[Notify] Notification sent to owner ${ownerId}`);
    }
  } catch (e) {
    console.error("[Notify] Failed to notify factory:", e);
  }
}
