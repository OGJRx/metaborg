import type { D1Database } from "@cloudflare/workers-types";

export interface SlotValidationResult {
  valid: boolean;
  errorCode?: string;
}

export function getNowInTZ(timezone: string): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });

  const now = new Date();
  const parts = formatter.formatToParts(now);
  const p: Record<string, string> = {};
  for (const part of parts) {
    p[part.type] = part.value;
  }

  const year = p["year"];
  const month = (p["month"] ?? "1").padStart(2, "0");
  const day = (p["day"] ?? "1").padStart(2, "0");
  const hour = (p["hour"] ?? "0").padStart(2, "0");
  const minute = (p["minute"] ?? "0").padStart(2, "0");
  const second = (p["second"] ?? "0").padStart(2, "0");

  // This returns a date whose components match the timezone's local time,
  // even if the environment is in a different timezone (like UTC).
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
}

export function validateAppointmentSlot(
  fecha: string,
  hora: string,
  workDays: boolean[],
  bufferMinutes: number,
  timezone: string,
): SlotValidationResult {
  const nowInTZ = getNowInTZ(timezone);

  // Buffer check
  const citaDate = new Date(`${fecha}T${hora}:00`);
  if (citaDate.getTime() < nowInTZ.getTime() + bufferMinutes * 60 * 1000) {
    return { valid: false, errorCode: "PAST_OR_BUFFER" };
  }

  // Work days check (0=Sunday, 1=Monday, ..., 6=Saturday)
  const dayOfWeek = citaDate.getDay();
  if (!workDays[dayOfWeek]) {
    return { valid: false, errorCode: "NON_WORKING_DAY" };
  }

  return { valid: true };
}

export class SlotValidator {
  constructor(private db: D1Database) {}

  async getAvailableSlots(
    botId: string,
    fecha: string,
    config: {
      capacity: number;
      duration: number;
      openHour: number;
      closeHour: number;
      workDays: boolean[];
      bufferMinutes: number;
      timezone: string;
    },
  ): Promise<{ hora: string; available: boolean }[]> {
    const tickets = await this.db
      .prepare(
        "SELECT hora_cita, COUNT(*) as count FROM factory_tickets WHERE bot_id = ? AND fecha_cita = ? AND estado != 'cancelado' GROUP BY hora_cita",
      )
      .bind(botId, fecha)
      .all<{ hora_cita: string; count: number }>();

    // We can also have a factory_blocked_slots table if needed, but for now let's stick to capacity
    const capacityMap = new Map<string, number>();
    tickets.results?.forEach((r) => {
      capacityMap.set(r.hora_cita, r.count);
    });

    const allSlots = [];
    for (let h = config.openHour; h < config.closeHour; h++) {
      for (let m = 0; m < 60; m += config.duration) {
        const hora = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        const used = capacityMap.get(hora) || 0;

        const validation = validateAppointmentSlot(
          fecha,
          hora,
          config.workDays,
          config.bufferMinutes,
          config.timezone,
        );

        allSlots.push({
          hora,
          available: used < config.capacity && validation.valid,
        });
      }
    }
    return allSlots;
  }
}

export async function createTicketAtomic(
  db: D1Database,
  data: {
    botId: string;
    sessionId: string | undefined;
    platform: string;
    chatId: string;
    stepData: string;
    fechaCita: string;
    horaCita: string;
    capacity: number;
  },
): Promise<{ success: boolean; ticketId?: string }> {
  if (!data.sessionId) {
    console.warn(
      `[TITANIUM] createTicketAtomic: Missing sessionId for bot ${data.botId} (chatId: ${data.chatId})`,
    );
  }

  const ticketId =
    `T-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`.toUpperCase();

  const res = await db
    .prepare(
      `INSERT INTO factory_tickets (ticket_id, bot_id, session_id, platform, chat_id, step_data, fecha_cita, hora_cita, estado)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'confirmado'
      WHERE (SELECT COUNT(*) FROM factory_tickets WHERE bot_id = ? AND fecha_cita = ? AND hora_cita = ? AND estado != 'cancelado') < ?`,
    )
    .bind(
      ticketId,
      data.botId,
      data.sessionId || null,
      data.platform,
      data.chatId,
      data.stepData,
      data.fechaCita,
      data.horaCita,
      data.botId,
      data.fechaCita,
      data.horaCita,
      data.capacity,
    )
    .run();

  if (res.meta.changes === 0) {
    return { success: false };
  }

  return { success: true, ticketId };
}
