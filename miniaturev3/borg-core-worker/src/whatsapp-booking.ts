import {
  CoreEnv,
  BorgExecutionContext,
  EphemeralState,
} from "../../shared/types";
import { BookingCoreService } from "../../shared/services/booking-core";
import { WhatsAppApi } from "../../shared/whatsapp/whatsapp-api";
import { AdminNotificationService } from "../../shared/services/admin-notification";
import {
  KILOMETRAJE_RANGES,
  WHATSAPP_RENDER_CONFIG,
  MAX_LIST_ROWS,
} from "../../shared/types/constants";
import { formatHourTo12, formatDateFriendly } from "../../shared/ui/formatters";
import { BorgLogger } from "../../shared/services/borg-logger";
import { getPlatformErrorFallback } from "../../shared/services/response-helper";
import { WhatsAppApiError } from "../../shared/whatsapp/whatsapp-errors";
const WHATSAPP_ACTION_MAP: Record<number, string> = {
  1: "set_tipo",
  2: "set_motor",
  3: "set_era",
  4: "set_km",
  5: "set_svc",
  6: "set_fecha",
  7: "set_hora",
  8: "conf_booking",
};

export class WhatsAppBookingOrchestrator {
  private api: WhatsAppApi;
  private core: BookingCoreService;

  constructor(
    private env: CoreEnv,
    private ctx: BorgExecutionContext,
  ) {
    const logger = new BorgLogger(
      "WhatsAppBookingOrchestrator",
      env.DB,
      ctx.traceId,
      ctx,
    );
    this.api = new WhatsAppApi(env, logger);
    this.core = new BookingCoreService(env.DB);
  }

  async handleMessage(phoneNumber: string, text: string) {
    try {
      const session = await this.core.getSession(
        phoneNumber,
        phoneNumber,
        "whatsapp",
      );

      const cleanText = text.trim().toLowerCase();

      // Keywords handling
      if (cleanText === "cancelar") {
        const result = await this.core.handleAction(
          session,
          "conf_booking",
          "no",
        );
        return await this.renderStep(phoneNumber, result.step, result.newState);
      }

      if (cleanText === "reiniciar" || cleanText === "ayuda") {
        const result = await this.core.handleAction(
          session,
          "start_booking",
          "0",
        );
        return await this.renderStep(phoneNumber, result.step, result.newState);
      }

      if (cleanText === "reintentar") {
        if (session.paso_actual > 0 && session.estado_flujo === "iniciado") {
          const step = await this.core.renderStep(session);
          return await this.renderStep(phoneNumber, step, session);
        }
      }

      if (session.paso_actual > 0) {
        // Selection handling (Numeric options) - Fallback for non-interactive
        if (session.paso_actual !== 4) {
          const selection = parseInt(text.trim(), 10);
          if (!isNaN(selection)) {
            const processed = await this.handleSelection(
              phoneNumber,
              session,
              selection,
            );
            if (processed) return;
          }
        }

        // Kilometer handling (Step 4)
        if (session.paso_actual === 4) {
          const km = parseInt(text, 10);
          if (!isNaN(km)) {
            const range = KILOMETRAJE_RANGES.reduce((prev, curr) =>
              Math.abs(curr.value - km) < Math.abs(prev.value - km)
                ? curr
                : prev,
            );
            const result = await this.core.handleAction(
              session,
              "set_km",
              String(range.value),
            );
            return await this.renderStep(
              phoneNumber,
              result.step,
              result.newState,
            );
          }
        }

        // If we reach here and we were in an active flow, it means input was invalid
        const currentStep = await this.core.renderStep(session);
        let errorMsg =
          "❌ Opción inválida. Selecciona una de las opciones del menú o escribe *cancelar* para abortar.";

        if (session.paso_actual === 4) {
          errorMsg =
            "❌ Kilometraje inválido. Por favor ingresa solo números (ej: 50000) o escribe *cancelar* para abortar.";
        }

        return await this.renderStep(
          phoneNumber,
          {
            ...currentStep,
            message: `${errorMsg}\n\n${currentStep.message}`,
          },
          session,
        );
      }

      // No active session or just started
      const result = await this.core.handleAction(
        session,
        "start_booking",
        "0",
      );
      return await this.renderStep(phoneNumber, result.step, result.newState);
    } catch (error) {
      const logger = new BorgLogger(
        "WhatsAppBookingOrchestrator",
        this.env.DB,
        this.ctx.traceId,
        this.ctx,
      );
      logger.error(
        "handleMessage",
        `Error in handleMessage: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.api
        .sendMessage(phoneNumber, getPlatformErrorFallback("whatsapp"))
        .catch(() => {});
    }
  }

  async handleInteractiveReply(phoneNumber: string, replyId: string) {
    try {
      const session = await this.core.getSession(
        phoneNumber,
        phoneNumber,
        "whatsapp",
      );

      if (replyId.startsWith("slots_page:")) {
        const [, pageStr, action] = replyId.split(":");
        const page = parseInt(pageStr || "1", 10);

        const step = await this.core.renderStep(session);
        if (step.options) {
          const cleanBody = step.message
            .replace(/<b>/g, "*")
            .replace(/<\/b>/g, "*")
            .replace(/<br>/g, "\n");

          const stepKey =
            `STEP_${session.paso_actual}` as keyof typeof WHATSAPP_RENDER_CONFIG;
          const config = WHATSAPP_RENDER_CONFIG[stepKey];
          const buttonLabel =
            config && config.type === "list" && config.buttonLabel
              ? config.buttonLabel
              : "Seleccionar";

          await this.paginateAndSendList(
            phoneNumber,
            cleanBody,
            buttonLabel,
            step.options,
            action || "unknown",
            page,
          );
          return;
        }
      }

      if (replyId === "START") {
        const result = await this.core.handleAction(
          session,
          "start_booking",
          "0",
        );
        return await this.renderStep(phoneNumber, result.step, result.newState);
      }

      const firstColonIndex = replyId.indexOf(":");
      if (firstColonIndex === -1) return;
      const action = replyId.substring(0, firstColonIndex);
      const value = replyId.substring(firstColonIndex + 1);

      if (action === "motor_help") {
        await this.api.sendMessage(
          phoneNumber,
          "⚙️ *Ayuda de Motor*\n\nIndica la tecnología de propulsión. Si tienes dudas, consulta el manual de tu vehículo.",
        );
        return;
      }

      const result = await this.core.handleAction(session, action, value);
      await this.renderStep(phoneNumber, result.step, result.newState);
    } catch (error) {
      const logger = new BorgLogger(
        "WhatsAppBookingOrchestrator",
        this.env.DB,
        this.ctx.traceId,
        this.ctx,
      );
      logger.error(
        "handleInteractiveReply",
        `Error processing interactive reply: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.api
        .sendMessage(
          phoneNumber,
          "⚠️ *Error técnico temporal*\n\nLo sentimos, no pudimos procesar tu selección. Por favor escribe *reiniciar* para intentar de nuevo.",
        )
        .catch(() => {});
    }
  }

  private async handleSelection(
    phoneNumber: string,
    session: EphemeralState,
    selection: number,
  ): Promise<boolean> {
    const step = await this.core.renderStep(session);
    if (!step.options || selection <= 0 || selection > step.options.length) {
      return false;
    }

    const opt = step.options[selection - 1];
    if (!opt) return false;

    let action = WHATSAPP_ACTION_MAP[session.paso_actual];
    if (session.paso_actual === 2 && opt.value === "HELP") {
      action = "motor_help";
    }
    if (!action) return false;

    if (action === "motor_help") {
      await this.api.sendMessage(
        phoneNumber,
        "⚙️ *Ayuda de Motor*\n\nIndica la tecnología de propulsión. Si tienes dudas, consulta el manual de tu vehículo.",
      );
      return true;
    }

    const result = await this.core.handleAction(session, action, opt.value);
    await this.renderStep(phoneNumber, result.step, result.newState);
    return true;
  }

  private async renderStep(
    phoneNumber: string,
    step: {
      status: "PROMPT" | "CONFIRMED" | "CANCELLED" | "EMPTY";
      message: string;
      options?: { label: string; value: string }[];
    },
    session: EphemeralState,
  ) {
    try {
      return await this._renderStepInternal(phoneNumber, step, session);
    } catch (error) {
      if (error instanceof WhatsAppApiError) {
        await this.handleWhatsAppApiError(phoneNumber, session, error, step);
      } else {
        throw error;
      }
    }
  }

  private async handleWhatsAppApiError(
    phoneNumber: string,
    session: EphemeralState,
    error: WhatsAppApiError,
    step: {
      status: "PROMPT" | "CONFIRMED" | "CANCELLED" | "EMPTY";
      message: string;
      options?: { label: string; value: string }[];
    },
  ) {
    const logger = new BorgLogger(
      "WhatsAppBookingOrchestrator",
      this.env.DB,
      this.ctx.traceId,
      this.ctx,
    );

    // 1. Log to wa_api_errors
    await this.env.DB.prepare(
      "INSERT INTO wa_api_errors (phone_number, paso_actual, http_status, error_code, fbtrace_id, trace_id, payload_summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        phoneNumber,
        session.paso_actual,
        error.httpStatus,
        error.errorCode || "unknown",
        error.fbtraceId || "N/A",
        this.ctx.traceId,
        JSON.stringify({
          optionCount: step.options?.length,
          status: step.status,
        }),
      )
      .run()
      .catch((e) => logger.error("wa_api_errors_insert", String(e)));

    // 2. Notify Admin
    this.ctx.waitUntil(
      AdminNotificationService.dispatchApiError(this.env, {
        phone: phoneNumber,
        step: session.paso_actual,
        errorCode: error.errorCode || "API_ERROR",
        fbtraceId: error.fbtraceId,
      }),
    );

    // 3. Fallback to plain text
    const cleanBody = step.message
      .replace(/<b>/g, "*")
      .replace(/<\/b>/g, "*")
      .replace(/<br>/g, "\n");

    let textFallback = cleanBody + "\n\n";
    if (step.options) {
      step.options.forEach((opt, i) => {
        textFallback += `${i + 1}. ${opt.label}\n`;
      });
      textFallback += "\n_Escribe el número para seleccionar._";
    }

    await this.api.sendMessage(phoneNumber, textFallback).catch(() => {});
  }

  private async _renderStepInternal(
    phoneNumber: string,
    step: {
      status: "PROMPT" | "CONFIRMED" | "CANCELLED" | "EMPTY";
      message: string;
      options?: { label: string; value: string }[];
    },
    session: EphemeralState,
  ) {
    if (step.status === "CONFIRMED") {
      const ticketId = step.options?.find(
        (o) => o.label === "ticket_id",
      )?.value;

      if (!ticketId) {
        return await this.api.sendMessage(
          phoneNumber,
          "⚠️ Error al generar ticket. Contacte soporte.",
        );
      }

      const notifPromise = AdminNotificationService.dispatch(
        this.env,
        session,
        ticketId,
        "whatsapp",
        phoneNumber,
      );
      this.ctx.waitUntil(notifPromise);

      const fechaFriendly = session.fecha_cita
        ? formatDateFriendly(new Date(session.fecha_cita + "T12:00:00"))
        : "N/A";

      let summary =
        `✅ *¡Cita confirmada!*\n\n` +
        `📋 *Ticket:* \`${ticketId}\`\n` +
        `🚗 *Vehículo:* ${session.vehiculo_tipo} / ${session.vehiculo_motor}\n` +
        `📅 *Era:* ${session.vehiculo_era}\n` +
        `📟 *Kilometraje:* ${session.kilometraje} km\n` +
        `🛠️ *Servicio:* ${session.servicio_solicitado}\n` +
        `🗓️ *Fecha:* ${fechaFriendly}\n` +
        `⏰ *Hora:* ${session.hora_cita ? formatHourTo12(session.hora_cita) : "N/A"}\n\n` +
        `📌 *Protocolo de Recepción:*\n` +
        `- Presenta tu ticket digital al llegar a la bahía.\n` +
        `- Recomendamos llegar 10 minutos antes de tu ventana de atención.\n` +
        `- Estacionamiento disponible para clientes en zona frontal.`;

      if (this.env.TALLER_MAPS_URL) {
        summary += `\n\n📍 *Ubicación:* ${this.env.TALLER_MAPS_URL}`;
      } else if (
        this.env.TALLER_LATITUD &&
        this.env.TALLER_LATITUD !== "0" &&
        this.env.TALLER_LONGITUD &&
        this.env.TALLER_LONGITUD !== "0"
      ) {
        summary += `\n\n📍 *Ubicación:* Autodiagnóstico JR`;
      }

      return await this.api.sendMessage(phoneNumber, summary);
    }

    if (step.status === "CANCELLED") {
      return await this.api.sendMessage(
        phoneNumber,
        "❌ *Proceso de agendamiento interrumpido.*\n\n" +
          "La sesión ha sido cancelada por el usuario. Puedes reiniciar el proceso de reserva en cualquier momento escribiendo *reiniciar*.\n" +
          "Nuestro horario de atención técnica es de Lunes a Viernes, de 7:00 AM a 6:00 PM.",
      );
    }

    const cleanBody = step.message
      .replace(/<b>/g, "*")
      .replace(/<\/b>/g, "*")
      .replace(/<br>/g, "\n");

    const stepKey =
      `STEP_${session.paso_actual}` as keyof typeof WHATSAPP_RENDER_CONFIG;
    const config = WHATSAPP_RENDER_CONFIG[stepKey];

    if (!config || !step.options) {
      return await this.api.sendMessage(phoneNumber, cleanBody);
    }

    const totalRows = step.options.length;
    if (config.type === "list" && totalRows > MAX_LIST_ROWS) {
      const action = WHATSAPP_ACTION_MAP[session.paso_actual] || "unknown";
      const buttonLabel =
        config.type === "list" && config.buttonLabel
          ? config.buttonLabel
          : "Seleccionar";
      return await this.paginateAndSendList(
        phoneNumber,
        cleanBody,
        buttonLabel,
        step.options,
        action,
      );
    }

    const action = WHATSAPP_ACTION_MAP[session.paso_actual];

    if (config.type === "button" && step.options.length <= 3) {
      return await this.api.sendInteractiveButtons(
        phoneNumber,
        cleanBody,
        step.options.map((opt) => ({
          id: opt.value === "HELP" ? "motor_help:1" : `${action}:${opt.value}`,
          title:
            opt.label.length > 20
              ? opt.label.substring(0, 17) + "..."
              : opt.label,
        })),
      );
    }

    if (config.type === "list") {
      const sections: {
        title: string;
        rows: { id: string; title: string; description?: string }[];
      }[] = [];

      if (config.type === "list") {
        if ("sections" in config && config.sections) {
          for (const sec of config.sections) {
            const rows = step.options
              .filter((opt) => {
                const optLabel = opt.label;
                return (
                  sec.rows.includes(optLabel) ||
                  (opt.value === "HELP" && sec.rows.includes("HELP"))
                );
              })
              .map((opt) => ({
                id:
                  opt.value === "HELP"
                    ? "motor_help:1"
                    : `${action}:${opt.value}`,
                title:
                  opt.label.length > 24
                    ? opt.label.substring(0, 21) + "..."
                    : opt.label,
              }));
            if (rows.length > 0) {
              sections.push({ title: sec.title, rows });
            }
          }
        } else {
          // Default section if no sections defined (e.g. dynamic dates/hours)
          sections.push({
            title: "Selecciona una opción",
            rows: step.options.map((opt) => ({
              id: `${action}:${opt.value}`,
              title:
                opt.label.length > 24
                  ? opt.label.substring(0, 21) + "..."
                  : opt.label,
            })),
          });
        }
      }

      const buttonLabel =
        config.type === "list" && config.buttonLabel
          ? config.buttonLabel
          : "Seleccionar";

      return await this.api.sendInteractiveList(
        phoneNumber,
        cleanBody,
        buttonLabel,
        sections,
      );
    }

    // Final Fallback to text
    let fullMessage = cleanBody + "\n\n";
    step.options.forEach((opt, i) => {
      fullMessage += `${i + 1}. ${opt.label}\n`;
    });
    return await this.api.sendMessage(phoneNumber, fullMessage);
  }

  private async paginateAndSendList(
    phone: string,
    bodyText: string,
    buttonLabel: string,
    allOptions: { label: string; value: string }[],
    action: string,
    page = 1,
  ): Promise<unknown> {
    // To keep it simple and predictable, we'll use a fixed item count per page
    // that always leaves room for both buttons (Back + Next) if needed.
    const SAFE_PAGE_SIZE = MAX_LIST_ROWS - 2; // Always leaves 2 slots for nav

    const fixedStartIdx = (page - 1) * SAFE_PAGE_SIZE;
    const pageItems = allOptions.slice(
      fixedStartIdx,
      fixedStartIdx + SAFE_PAGE_SIZE,
    );
    const hasMore = fixedStartIdx + SAFE_PAGE_SIZE < allOptions.length;

    const pageRows = pageItems.map((opt) => ({
      id: `${action}:${opt.value}`,
      title: opt.label,
    }));

    if (page > 1) {
      pageRows.unshift({
        id: `slots_page:1:${action}`, // include action in ID to generalize
        title: "◀️ Volver al inicio",
      });
    }

    if (hasMore) {
      pageRows.push({
        id: `slots_page:${page + 1}:${action}`,
        title: `▶️ Ver más...`,
      });
    }

    const sections = [
      {
        title: `Opciones ${page > 1 ? `(pág. ${page})` : ""}`,
        rows: pageRows,
      },
    ];

    return await this.api.sendInteractiveList(
      phone,
      bodyText,
      buttonLabel,
      sections,
    );
  }
}
