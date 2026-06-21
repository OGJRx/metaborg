import { D1Database } from "@cloudflare/workers-types";
import { EphemeralState } from "../types";
import { SERVICE_DURATIONS } from "../types/constants";

export class TicketCreator {
  constructor(private db: D1Database) {}

  async createTicketAtomic(
    s: EphemeralState,
  ): Promise<{ success: boolean; ticket_id?: string }> {
    if (
      !s.fecha_cita ||
      !s.hora_cita ||
      !s.servicio_solicitado ||
      !s.session_id
    ) {
      throw new Error("Missing required fields for ticket creation");
    }

    const ticket_id = `T-${Date.now()}`;
    const hora_fin = calculateEndTime(
      s.hora_cita,
      SERVICE_DURATIONS[s.servicio_solicitado] || 60,
    );

    const res = await this.db
      .prepare(
        `INSERT INTO tickets (ticket_id, session_id, telegram_user_id, telegram_chat_id, platform,
        vehiculo_tipo, vehiculo_motor, vehiculo_era, servicio_solicitado, fecha_cita, hora_cita, hora_fin, kilometraje)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM tickets WHERE fecha_cita = ? AND hora_cita = ? AND estado != 'cancelado') < 6
        AND NOT EXISTS (
          SELECT 1 FROM blocked_slots WHERE fecha = ? AND hora = ?
        )`,
      )
      .bind(
        ticket_id,
        s.session_id,
        s.telegram_user_id,
        s.telegram_chat_id || "",
        s.platform,
        s.vehiculo_tipo,
        s.vehiculo_motor,
        s.vehiculo_era,
        s.servicio_solicitado,
        s.fecha_cita,
        s.hora_cita,
        hora_fin,
        s.kilometraje,
        s.fecha_cita,
        s.hora_cita,
        s.fecha_cita,
        s.hora_cita,
      )
      .run();

    if (res.meta.changes === 0) {
      return { success: false };
    }

    // Insert generic notification for the dashboard/admin bot
    try {
      await this.db
        .prepare(
          "INSERT INTO notifications (appointment_id, type, message) " +
            "SELECT id, 'appointment_created', ? FROM tickets WHERE ticket_id = ?",
        )
        .bind(
          `Nueva cita creada: ${s.servicio_solicitado} para ${s.vehiculo_tipo} el ${s.fecha_cita} a las ${s.hora_cita}`,
          ticket_id,
        )
        .run();
    } catch (e) {
      console.error("[TicketCreator] Failed to insert notification:", e);
    }

    return { success: true, ticket_id };
  }

  async createTicket(
    s: EphemeralState,
  ): Promise<{ success: boolean; ticket_id: string }> {
    const res = await this.createTicketAtomic(s);
    if (!res.success) throw new Error("Slot already occupied");
    if (!res.ticket_id)
      throw new Error("ticket_id missing after atomic insert");
    return { success: true, ticket_id: res.ticket_id };
  }
}

export const calculateEndTime = (h: string, d: number): string => {
  const parts = h.split(":").map(Number);
  const hh = parts[0] ?? 0;
  const mm = parts[1] ?? 0;
  const total = hh * 60 + mm + d;
  const endH = Math.floor(total / 60) % 24;
  const endM = total % 60;
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
};
