import { D1Database } from "@cloudflare/workers-types";
import { OFFICE_HOURS, BUFFER_LLEGADA_MINUTOS } from "../types/constants";
import { getVenezuelaTimeParts } from "../ui/timezone";

export function validateAppointmentSlot(
  f: string,
  h: string,
): { valid: boolean; errorCode?: string } {
  const fParts = f.split("-").map(Number);
  const y = fParts[0] ?? 0;
  const m = fParts[1] ?? 0;
  const d = fParts[2] ?? 0;
  const hParts = h.split(":").map(Number);
  const hh = hParts[0] ?? 0;
  const mm = hParts[1] ?? 0;
  const tentativeDate = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const parts = getVenezuelaTimeParts(tentativeDate);
  const localTimeValue = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  const offsetMs = tentativeDate.getTime() - localTimeValue;
  const citaDateUTC = new Date(tentativeDate.getTime() + offsetMs);
  const now = new Date();
  if (
    citaDateUTC.getTime() <
    now.getTime() + BUFFER_LLEGADA_MINUTOS * 60 * 1000
  )
    return { valid: false, errorCode: "PAST_DATE" };

  if (!OFFICE_HOURS.IS_WORK_DAY(parts.dayOfWeek)) {
    return { valid: false, errorCode: "WEEKEND" };
  }

  return { valid: true };
}

export class SlotValidator {
  constructor(private db: D1Database) {
    // TODO(Audit#20-future): Use session.servicio_solicitado + SERVICE_DURATIONS
    // to block contiguous slots based on service duration
  }

  async getAvailableSlots(
    fecha: string,
  ): Promise<{ hora: string; available: boolean }[]> {
    const tickets = await this.db
      .prepare(
        "SELECT hora_cita, COUNT(*) as count FROM tickets WHERE fecha_cita = ? AND estado != 'cancelado' GROUP BY hora_cita",
      )
      .bind(fecha)
      .all<{ hora_cita: string; count: number }>();

    const blocked = await this.db
      .prepare("SELECT hora FROM blocked_slots WHERE fecha = ?")
      .bind(fecha)
      .all<{ hora: string }>();

    const capacityMap = new Map<string, number>();
    tickets.results.forEach((r) => {
      capacityMap.set(r.hora_cita, r.count);
    });

    const blockedSet = new Set(blocked.results.map((r) => r.hora));

    const allSlots = [];
    for (let h = OFFICE_HOURS.OPEN; h < OFFICE_HOURS.CLOSE; h++) {
      for (let m = 0; m < 60; m += OFFICE_HOURS.duracionSlot) {
        const hora = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        const used = capacityMap.get(hora) || 0;
        const isBlocked = blockedSet.has(hora);

        allSlots.push({
          hora,
          available:
            !isBlocked &&
            used < 6 &&
            validateAppointmentSlot(fecha, hora).valid,
        });
      }
    }
    return allSlots;
  }
}
