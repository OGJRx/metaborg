import { D1Database } from "@cloudflare/workers-types";
import { EphemeralState } from "../types";
import { SlotValidator, validateAppointmentSlot } from "./slot-validator";
import { TicketCreator } from "./ticket-creator";
import {
  VEHICLE_OPTIONS,
  KILOMETRAJE_RANGES,
  SERVICE_OPTIONS,
} from "../types/constants";
import {
  formatDateISO,
  formatDateFriendly,
  toSqliteDateTime,
} from "../ui/formatters";
import { getVenezuelaNow } from "../ui/timezone";

export interface BookingStep {
  status: "PROMPT" | "CONFIRMED" | "CANCELLED" | "EMPTY";
  message: string;
  options?: { label: string; value: string }[];
}

export class BookingCoreService {
  constructor(private db: D1Database) {}

  async getSession(
    platformUserId: string,
    platformChatId: string,
    platform: "telegram" | "whatsapp",
    botType: "frontend" | "backend" = "frontend",
  ): Promise<EphemeralState> {
    const res = await this.db
      .prepare(
        "SELECT session_id, telegram_user_id, telegram_chat_id, platform, active_mode, estado_flujo, paso_actual, bot_type, updated_at, vehiculo_tipo, vehiculo_motor, vehiculo_era, kilometraje, servicio_solicitado, fecha_cita, hora_cita FROM sessions WHERE telegram_user_id = ? AND platform = ? AND bot_type = ? AND estado_flujo NOT IN ('confirmado', 'cancelado') AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY updated_at DESC LIMIT 1",
      )
      .bind(platformUserId, platform, botType)
      .first<EphemeralState>();

    if (res) return res;

    const sessionId = `S-${Date.now()}-${platformUserId.slice(-4)}`;
    const expiresAt = toSqliteDateTime(new Date(Date.now() + 24 * 3600 * 1000));
    const newState: EphemeralState = {
      session_id: sessionId,
      telegram_user_id: platformUserId,
      telegram_chat_id: platformChatId,
      platform: platform,
      estado_flujo: "iniciado",
      paso_actual: 0,
      version: 1,
      bot_type: botType,
    };

    await this.db
      .prepare(
        "INSERT INTO sessions (session_id, telegram_user_id, telegram_chat_id, platform, bot_type, estado_flujo, paso_actual, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        sessionId,
        platformUserId,
        platformChatId,
        platform,
        botType,
        "iniciado",
        0,
        expiresAt,
      )
      .run();

    return newState;
  }

  async updateSession(sessionId: string, data: Partial<EphemeralState>) {
    const allowedKeys: (keyof EphemeralState)[] = [
      "active_mode",
      "estado_flujo",
      "paso_actual",
      "vehiculo_tipo",
      "vehiculo_motor",
      "vehiculo_era",
      "kilometraje",
      "servicio_solicitado",
      "fecha_cita",
      "hora_cita",
    ];
    const entries = Object.entries(data).filter(([k]) =>
      allowedKeys.includes(k as keyof EphemeralState),
    );
    if (entries.length === 0) return;

    const sets = entries.map(([k]) => `${k} = ?`).join(", ");
    const values = entries.map(([, v]) => v);

    await this.db
      .prepare(
        `UPDATE sessions SET ${sets}, updated_at = datetime('now') WHERE session_id = ?`,
      )
      .bind(...values, sessionId)
      .run();
  }

  async handleAction(
    session: EphemeralState,
    action: string,
    value: string,
  ): Promise<{ step: BookingStep; newState: EphemeralState }> {
    const newState = { ...session };

    switch (action) {
      case "start_booking":
        newState.paso_actual = 1;
        break;
      case "set_tipo":
        newState.vehiculo_tipo = value;
        newState.paso_actual = 2;
        break;
      case "set_motor":
        newState.vehiculo_motor = value;
        newState.paso_actual = 3;
        break;
      case "set_era":
        newState.vehiculo_era = value;
        newState.paso_actual = 4;
        break;
      case "set_km":
        newState.kilometraje = parseInt(value, 10);
        newState.paso_actual = 5;
        break;
      case "set_svc":
        newState.servicio_solicitado = value;
        newState.paso_actual = 6;
        break;
      case "set_fecha": {
        const validator = new SlotValidator(this.db);
        const slots = await validator.getAvailableSlots(value);
        const available = slots.filter((sl) => sl.available);
        if (available.length === 0) {
          const currentStep = await this.renderStep(newState);
          return {
            step: {
              ...currentStep,
              message:
                `❌ No hay horas disponibles para la fecha seleccionada (${value}). Por favor elige otro día.\n\n` +
                currentStep.message,
            },
            newState,
          };
        }
        newState.fecha_cita = value;
        newState.paso_actual = 7;
        // Optimization: return immediately with the already fetched slots
        const step = await this.renderStep(newState, slots);
        if (session.session_id) {
          await this.updateSession(session.session_id, newState);
        }
        return { step, newState };
      }
      case "set_hora": {
        if (!newState.fecha_cita) {
          newState.paso_actual = 6;
          return {
            step: await this.renderStep(newState),
            newState,
          };
        }
        const validation = validateAppointmentSlot(newState.fecha_cita, value);
        if (!validation.valid) {
          const currentStep = await this.renderStep(newState);
          return {
            step: {
              ...currentStep,
              message:
                `❌ El horario seleccionado ya no está disponible. Por favor elige otro.\n\n` +
                currentStep.message,
            },
            newState,
          };
        }
        // Double check with DB (Capacity Check)
        const tickets = await this.db
          .prepare(
            "SELECT COUNT(*) as count FROM tickets WHERE fecha_cita = ? AND hora_cita = ? AND estado != 'cancelado'",
          )
          .bind(newState.fecha_cita, value)
          .first<{ count: number }>();

        const isBlocked = await this.db
          .prepare("SELECT 1 FROM blocked_slots WHERE fecha = ? AND hora = ?")
          .bind(newState.fecha_cita, value)
          .first();

        const count = tickets?.count || 0;

        if (isBlocked || count >= 6) {
          const currentStep = await this.renderStep(newState);
          return {
            step: {
              ...currentStep,
              message:
                `❌ El horario seleccionado (${value}) ya ha sido reservado. Por favor elige otro.\n\n` +
                currentStep.message,
            },
            newState,
          };
        }
        newState.hora_cita = value;
        newState.paso_actual = 8;
        break;
      }
      case "conf_booking":
        if (value === "yes") {
          const creator = new TicketCreator(this.db);
          // Atomic check and create
          const res = await creator.createTicketAtomic(newState);
          if (!res.success) {
            newState.paso_actual = 7; // Back to time selection
            // CRITICAL: persist state to D1 so session doesn't get stuck in step 8
            if (session.session_id) {
              await this.updateSession(session.session_id, newState);
            }
            const currentStep = await this.renderStep(newState);
            return {
              step: {
                ...currentStep,
                message:
                  `❌ Lo sentimos, el horario seleccionado ya no está disponible. Por favor elige otro.\n\n` +
                  currentStep.message,
              },
              newState,
            };
          }
          newState.estado_flujo = "confirmado";
          if (!res.ticket_id) {
            throw new Error("ticket_id missing after successful booking");
          }
          // CRITICAL: persist confirmado to D1 so getSession excludes this session
          if (session.session_id) {
            await this.updateSession(session.session_id, newState);
          }
          return {
            step: {
              status: "CONFIRMED",
              message: "CONFIRMED", // Orchestrator handles final UI
              options: [{ label: "ticket_id", value: res.ticket_id }],
            },
            newState,
          };
        } else {
          newState.estado_flujo = "cancelado";
          // CRITICAL: persist cancelado to D1 so getSession excludes this session
          if (session.session_id) {
            await this.updateSession(session.session_id, newState);
          }
          // If we were at a step where we had some info, we could notify
          if (newState.session_id) {
            try {
              await this.db
                .prepare(
                  "INSERT INTO notifications (type, message) VALUES ('appointment_cancelled', ?)",
                )
                .bind(`Sesión de agendamiento cancelada por el usuario.`)
                .run();
            } catch (e) {
              console.error("[BookingCore] Failed to insert notification:", e);
            }
          }
          return {
            step: { status: "CANCELLED", message: "CANCELLED" },
            newState,
          };
        }
    }

    if (!session.session_id) {
      throw new Error("Session ID missing");
    }
    await this.updateSession(session.session_id, newState);
    const step = await this.renderStep(newState);
    return { step, newState };
  }

  private renderDateStep(): BookingStep {
    const today = getVenezuelaNow();
    const todayISO = formatDateISO(today);
    const options = [];
    let count = 0;
    for (let i = 0; i <= 14 && count < 6; i++) {
      const d = new Date(today.getTime() + i * 86400000);
      const dayOfWeek = new Date(
        d.toLocaleString("en-US", { timeZone: "America/Caracas" }),
      ).getDay();

      if ([1, 2, 3, 4, 5].includes(dayOfWeek)) {
        const iso = formatDateISO(d);
        const friendly = formatDateFriendly(d);
        options.push({
          label: iso === todayISO ? `🔥 ${friendly} (Hoy)` : `📅 ${friendly}`,
          value: iso,
        });
        count++;
      }
    }
    return {
      status: "PROMPT",
      message:
        "📅 <b>Selecciona una fecha de servicio:</b>\n\n" +
        "La gestión de bahía requiere una asignación precisa para garantizar la eficiencia operativa de nuestro personal especializado. " +
        "Selecciona una fecha hábil para reservar tu slot de atención. El sistema validará la disponibilidad en tiempo real.",
      options,
    };
  }

  async renderStep(
    s: EphemeralState,
    cachedSlots?: { hora: string; available: boolean }[],
  ): Promise<BookingStep> {
    switch (s.paso_actual) {
      case 1:
        return {
          status: "PROMPT",
          message:
            "🚗 <b>Selecciona el tipo de vehículo:</b>\n\n" +
            "Elige la categoría que mejor describa tu vehículo. Esto nos ayuda a asignar la bahía con la capacidad y herramientas adecuadas.",
          options: VEHICLE_OPTIONS.TYPES.map((t) => ({ label: t, value: t })),
        };
      case 2:
        return {
          status: "PROMPT",
          message:
            "⚙️ <b>Selecciona el tipo de motor:</b>\n\n" +
            "Indica la tecnología de propulsión de tu vehículo. Si no estás seguro, usa el botón de ayuda.",
          options: [
            ...VEHICLE_OPTIONS.MOTORS.map((m) => ({ label: m, value: m })),
            { label: "❓ Ayuda", value: "HELP" },
          ],
        };
      case 3:
        return {
          status: "PROMPT",
          message:
            "📅 <b>Selecciona el periodo de fabricación:</b>\n\n" +
            "El rango de año permite al equipo técnico preparar los protocolos de diagnóstico específicos para tu línea de ensamblaje. " +
            "Esta información es crítica para determinar la compatibilidad de herramientas y software de escaneo. Elige el intervalo correspondiente.",
          options: VEHICLE_OPTIONS.ERAS.map((e) => ({ label: e, value: e })),
        };
      case 4:
        return {
          status: "PROMPT",
          message:
            "📟 <b>Selecciona el rango de kilometraje:</b>\n\n" +
            "El registro del odómetro es fundamental para establecer el intervalo de mantenimiento preventivo y evaluar el desgaste de componentes críticos. " +
            "Indica el rango actual para personalizar tu plan de servicio y proyectar la vida útil de fluidos.",
          options: KILOMETRAJE_RANGES.map((r) => ({
            label: r.label,
            value: r.value.toString(),
          })),
        };
      case 5:
        return {
          status: "PROMPT",
          message:
            "🛠️ <b>Selecciona el servicio solicitado:</b>\n\n" +
            "Cada servicio está diseñado para abordar necesidades específicas de mantenimiento y diagnóstico. " +
            "Desde escaneo computarizado hasta limpieza de sistema de inyección, nuestro equipo técnico cuenta con herramientas especializadas para entregar resultados precisos.",
          options: SERVICE_OPTIONS.map((s) => ({ label: s, value: s })),
        };
      case 6:
        return this.renderDateStep();
      case 7: {
        if (!s.fecha_cita) {
          return {
            status: "PROMPT",
            message: "⚠️ Por favor, selecciona una fecha primero.",
          };
        }
        const slots =
          cachedSlots ||
          (await new SlotValidator(this.db).getAvailableSlots(s.fecha_cita));
        const available = slots.filter((sl) => sl.available);
        if (available.length === 0) {
          return {
            status: "PROMPT",
            message:
              "❌ No hay horas disponibles para esta fecha. El horario laboral ya ha concluido o todos los slots están ocupados.",
          };
        }
        return {
          status: "PROMPT",
          message:
            `⏰ <b>Define tu ventana de atención para ${s.fecha_cita}:</b>\n\n` +
            "Respetar el horario asignado permite optimizar el flujo de trabajo en la bahía y reducir los tiempos de diagnóstico técnico inicial. " +
            "Elige un slot de servicio disponible para confirmar tu cita.",
          options: available.map((sl) => ({ label: sl.hora, value: sl.hora })),
        };
      }
      case 8: {
        const fechaDisplay = s.fecha_cita
          ? formatDateFriendly(new Date(s.fecha_cita + "T12:00:00"))
          : "N/A";
        return {
          status: "PROMPT",
          message:
            `✅ <b>Resumen de tu Cita:</b>\n\n` +
            `🚗 Tipo: ${s.vehiculo_tipo || "N/A"}\n` +
            `⚙️ Motor: ${s.vehiculo_motor || "N/A"}\n` +
            `📅 Era: ${s.vehiculo_era || "N/A"}\n` +
            `📟 KM: ${s.kilometraje}\n` +
            `🛠️ Servicio: ${s.servicio_solicitado || "N/A"}\n` +
            `🗓️ Fecha: ${fechaDisplay}\n` +
            `⏰ Hora: ${s.hora_cita || "N/A"}\n\n` +
            `¿Deseas confirmar esta cita?`,
          options: [
            { label: "✅ Confirmar Cita", value: "yes" },
            { label: "❌ Cancelar", value: "no" },
          ],
        };
      }
      default:
        return { status: "EMPTY", message: "INICIO" };
    }
  }
}
