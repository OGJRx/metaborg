import { CoreEnv, BorgContext, EphemeralState } from "../../shared/types";
import { BookingCoreService } from "../../shared/services/booking-core";
import { buildCallback, parseCallback } from "../../shared/security";
import { InlineKeyboard } from "grammy";
import { UiManager } from "../../shared/ui/ui-manager";
import { AdminNotificationService } from "../../shared/services/admin-notification";
import { KILOMETRAJE_RANGES } from "../../shared/types/constants";
import {
  escapeHtml,
  formatHourTo12,
  formatDateFriendly,
} from "../../shared/ui/formatters";
import { MOTOR_HELP_MESSAGE } from "../../shared/ui/prompts";
import { BorgLogger } from "../../shared/services/borg-logger";
import { getPlatformErrorFallback } from "../../shared/services/response-helper";

export class BookingOrchestrator {
  private async getCore(ctx: BorgContext<CoreEnv>) {
    return new BookingCoreService(ctx.env.DB);
  }

  async handleUpdate(ctx: BorgContext<CoreEnv>) {
    try {
      const userId = ctx.from?.id;
      const chatId = ctx.chat?.id || userId;
      if (!userId || !chatId) return;

      const core = await this.getCore(ctx);
      const session = await core.getSession(
        String(userId),
        String(chatId),
        "telegram",
      );

      if (ctx.hasCommand("start")) {
        return await this.handleStart(ctx);
      }

      if (ctx.callbackQuery?.data) {
        return await this.handleCallback(ctx, session);
      }

      if (ctx.message?.text) {
        return await this.handleText(ctx, session);
      }
    } catch (error) {
      const logger =
        ctx.logger ||
        new BorgLogger(
          "BookingOrchestrator",
          ctx.env.DB,
          ctx.traceId,
          ctx.executionContext,
        );
      logger.error(
        "handleUpdate",
        `Error in handleUpdate: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      await ctx
        .reply(getPlatformErrorFallback("telegram"), { parse_mode: "HTML" })
        .catch(() => {});
    }
  }

  private async handleStart(ctx: BorgContext<CoreEnv>) {
    const secret = ctx.env.BORG_SECRET_KEY;
    const inlineKeyboard = new InlineKeyboard().text(
      "📅 Agendar Cita",
      await buildCallback("start_booking", "0", secret),
    );
    return await ctx
      .reply(
        "🔱 <b>Bienvenido al Taller Titanium</b>\n\nSoy Borg, tu asistente de servicio automotriz. A continuación puedes seleccionar una opción para comenzar:\n\n📅 <b>Agendar Cita</b> — Inicia el proceso de reservación. El agendado es gratuito y al finalizar tu reserva, recibirás la ubicación exacta de nuestras instalaciones para tu llegada.\n\nTambién puedes usar el menú persistente en tu teclado para un acceso rápido.",
        {
          parse_mode: "HTML",
          reply_markup: inlineKeyboard,
        },
      )
      .then(async (msg: { chat: { id: number } }) => {
        await ctx.api.sendMessage(
          msg.chat.id,
          "👇 Usa el botón o el menú del teclado:",
          {
            reply_markup: {
              keyboard: [[{ text: "📅 Agendar Cita" }]],
              resize_keyboard: true,
              input_field_placeholder: "Presiona el botón para agendar...",
            },
          },
        );
      });
  }

  private async handleCallback(
    ctx: BorgContext<CoreEnv>,
    session: EphemeralState,
  ) {
    const parsed = await parseCallback(
      ctx.callbackQuery?.data || "",
      ctx.env.BORG_SECRET_KEY,
    );
    if (!parsed || !parsed.valid)
      return ctx.answerCallbackQuery("⚠️ Error de sesión");
    if (parsed.expired)
      return ctx.answerCallbackQuery("⚠️ Sesión expirada. Reinicia.");

    const { action, value } = parsed;
    const core = await this.getCore(ctx);
    const secret = ctx.env.BORG_SECRET_KEY;

    if (action === "motor_help") {
      await ctx.reply(MOTOR_HELP_MESSAGE, { parse_mode: "HTML" });
      return await ctx.answerCallbackQuery();
    }

    const result = await core.handleAction(session, action, value);
    await this.renderStep(ctx, result.step, secret, result.newState);
    await ctx.answerCallbackQuery().catch(() => {});
  }

  private async renderStep(
    ctx: BorgContext<CoreEnv>,
    step: {
      status: "PROMPT" | "CONFIRMED" | "CANCELLED" | "EMPTY";
      message: string;
      options?: { label: string; value: string }[];
    },
    secret: string,
    session: EphemeralState,
  ) {
    if (step.status === "CONFIRMED") {
      return await this.handleConfirmed(ctx, step, session);
    }

    if (step.status === "CANCELLED") {
      return await UiManager.safeEditOrReply(ctx, "❌ <b>Cita cancelada.</b>", {
        parse_mode: "HTML",
      });
    }

    const k = new InlineKeyboard();
    if (step.options) {
      const buttons = await this.buildKeyboardButtons(
        step.options,
        session.paso_actual,
        secret,
      );
      this.populateKeyboard(k, buttons, session.paso_actual);
    }

    const replyPromise = UiManager.safeEditOrReply(ctx, step.message, {
      reply_markup: k,
      parse_mode: "HTML",
    });
    ctx.executionContext.waitUntil(replyPromise);
    return;
  }

  private async handleConfirmed(
    ctx: BorgContext<CoreEnv>,
    step: { options?: { label: string; value: string }[] },
    session: EphemeralState,
  ) {
    const ticketId = step.options?.find((o) => o.label === "ticket_id")?.value;
    if (!ticketId) {
      return await UiManager.safeEditOrReply(
        ctx,
        "⚠️ Error al generar ticket. Contacte soporte.",
      );
    }

    const handle = ctx.from?.username
      ? `@${ctx.from.username}`
      : String(ctx.from?.id || "N/A");

    ctx.executionContext.waitUntil(
      AdminNotificationService.dispatch(
        ctx.env,
        session,
        ticketId,
        "telegram",
        handle,
      ),
    );

    const summary = this.buildSummaryMessage(ctx, session, ticketId);
    const keyboard = this.buildSummaryKeyboard(ctx.env);

    await UiManager.safeEditOrReply(ctx, summary, {
      parse_mode: "HTML",
      ...(keyboard.inline_keyboard.length > 0
        ? { reply_markup: keyboard }
        : {}),
    });

    await this.sendConfirmedLocation(ctx, ctx.env);
  }

  private buildSummaryMessage(
    ctx: BorgContext<CoreEnv>,
    session: EphemeralState,
    ticketId: string,
  ): string {
    const fechaFriendly = session.fecha_cita
      ? formatDateFriendly(new Date(session.fecha_cita + "T12:00:00"))
      : "N/A";

    const mapsUrl = ctx.env.TALLER_MAPS_URL;
    const lat = parseFloat(ctx.env.TALLER_LATITUD || "0");
    const lon = parseFloat(ctx.env.TALLER_LONGITUD || "0");

    let summary =
      `✅ <b>¡Cita confirmada!</b>\n\n` +
      `📋 <b>Ticket:</b> <code>${escapeHtml(ticketId)}</code>\n` +
      `🚗 <b>Vehículo:</b> ${escapeHtml(session.vehiculo_tipo || "N/A")} / ${escapeHtml(session.vehiculo_motor || "N/A")}\n` +
      `📅 <b>Era:</b> ${escapeHtml(session.vehiculo_era || "N/A")}\n` +
      `📟 <b>Kilometraje:</b> ${session.kilometraje ?? "N/A"} km\n` +
      `🛠️ <b>Servicio:</b> ${escapeHtml(session.servicio_solicitado || "N/A")}\n` +
      `🗓️ <b>Fecha:</b> ${escapeHtml(fechaFriendly)}\n` +
      `⏰ <b>Hora:</b> ${escapeHtml(session.hora_cita ? formatHourTo12(session.hora_cita) : "N/A")}`;

    if (mapsUrl) {
      summary += `\n\n📍 <b>¡Aquí nos encontramos!</b> Te esperamos en Autodiagnóstico JR. Usa el mapa para navegar directamente.`;
    } else if (lat !== 0 && lon !== 0) {
      summary += `\n\n📍 <b>¡Aquí nos encontramos!</b> Te esperamos en Autodiagnóstico JR.`;
    }

    return summary;
  }

  private buildSummaryKeyboard(env: CoreEnv): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    if (env.TALLER_MAPS_URL) {
      keyboard.url("🌐 Ver en Google Maps", env.TALLER_MAPS_URL);
    }
    return keyboard;
  }

  private async sendConfirmedLocation(
    ctx: BorgContext<CoreEnv>,
    env: CoreEnv,
  ): Promise<void> {
    const lat = parseFloat(env.TALLER_LATITUD || "0");
    const lon = parseFloat(env.TALLER_LONGITUD || "0");

    if (lat !== 0 && lon !== 0 && ctx.chat) {
      const locPromise = ctx.api.sendLocation(ctx.chat.id, lat, lon);
      ctx.executionContext.waitUntil(locPromise);
    }
  }

  private async buildKeyboardButtons(
    options: { label: string; value: string }[],
    paso: number,
    secret: string,
  ) {
    const actionMap: Record<number, string> = {
      1: "set_tipo",
      2: "set_motor",
      3: "set_era",
      4: "set_km",
      5: "set_svc",
      6: "set_fecha",
      7: "set_hora",
      8: "conf_booking",
    };

    return await Promise.all(
      options.map(async (opt) => {
        const action =
          paso === 2 && opt.value === "HELP" ? "motor_help" : actionMap[paso];
        return {
          label: opt.label,
          callback: action
            ? await buildCallback(action, opt.value, secret)
            : "",
        };
      }),
    );
  }

  private populateKeyboard(
    k: InlineKeyboard,
    buttons: { label: string; callback: string }[],
    paso: number,
  ) {
    buttons.forEach((btn, i) => {
      if (!btn.callback) return;
      k.text(btn.label, btn.callback);
      if (paso === 1 && i % 2 === 1) k.row();
      else if (paso === 7 && i % 3 === 2) k.row();
      else if ([2, 3, 4, 5, 6, 8].includes(paso) || btn.label === "❓ Ayuda")
        k.row();
    });
  }

  private async handleText(ctx: BorgContext<CoreEnv>, session: EphemeralState) {
    const core = await this.getCore(ctx);
    if (ctx.message?.text === "📅 Agendar Cita") {
      const result = await core.handleAction(session, "start_booking", "0");
      return await this.renderStep(
        ctx,
        result.step,
        ctx.env.BORG_SECRET_KEY,
        result.newState,
      );
    }

    if (session.paso_actual === 4 && ctx.message?.text) {
      const km = parseInt(ctx.message.text);
      if (isNaN(km))
        return await ctx.reply(
          "❌ Por favor ingresa un número válido para el kilometraje.",
        );

      const range = KILOMETRAJE_RANGES.reduce((prev, curr) =>
        Math.abs(curr.value - km) < Math.abs(prev.value - km) ? curr : prev,
      );

      const result = await core.handleAction(
        session,
        "set_km",
        String(range.value),
      );
      return await this.renderStep(
        ctx,
        result.step,
        ctx.env.BORG_SECRET_KEY,
        result.newState,
      );
    }
  }
}
