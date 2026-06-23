import { D1Database } from "@cloudflare/workers-types";
import { AdminNotificationRecord, EphemeralState, CoreEnv } from "../types";
import { AdminAuthService, TelegramApiFactory } from "../security";
import { escapeHtml } from "../ui/formatters";
import { WhatsAppApiErrorAlert } from "../whatsapp/whatsapp-errors";

export class AdminNotificationService {
  constructor(private db: D1Database) {}

  async saveNotification(record: AdminNotificationRecord): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO admin_notifications (ticket_id, vehiculo_tipo, vehiculo_motor, vehiculo_era, " +
          "servicio_solicitado, fecha_cita, hora_cita, kilometraje, telegram_user_id) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        record.ticket_id,
        record.vehiculo_tipo,
        record.vehiculo_motor,
        record.vehiculo_era,
        record.servicio_solicitado,
        record.fecha_cita,
        record.hora_cita,
        record.kilometraje,
        record.telegram_user_id,
      )
      .run();
  }

  async getRecentNotifications(
    limit: number = 5,
    offset: number = 0,
  ): Promise<AdminNotificationRecord[]> {
    const res = await this.db
      .prepare(
        "SELECT id, ticket_id, vehiculo_tipo, vehiculo_motor, vehiculo_era, " +
          "servicio_solicitado, fecha_cita, hora_cita, kilometraje, telegram_user_id, created_at " +
          "FROM admin_notifications ORDER BY created_at DESC LIMIT ? OFFSET ?",
      )
      .bind(limit, offset)
      .all<AdminNotificationRecord>();
    return res.results;
  }

  async getTotalCount(): Promise<number> {
    const res = await this.db
      .prepare("SELECT COUNT(*) as total FROM admin_notifications")
      .first<{ total: number }>();
    return res?.total ?? 0;
  }

  async getGenericNotifications(
    limit: number = 5,
  ): Promise<{ id: number; message: string; created_at: string }[]> {
    const res = await this.db
      .prepare(
        "SELECT id, message, created_at FROM notifications ORDER BY created_at DESC LIMIT ?",
      )
      .bind(limit)
      .all<{ id: number; message: string; created_at: string }>();
    return res.results;
  }

  static async dispatch(
    env: CoreEnv,
    session: EphemeralState,
    ticketId: string,
    platform: "telegram" | "whatsapp",
    userHandle?: string,
  ): Promise<void> {
    const backendApi = TelegramApiFactory.create(env, "backend");
    const adminIds = AdminAuthService.parseAdminIds(env);

    const platformLabel = platform === "whatsapp" ? "WhatsApp" : "Telegram";
    const originLine = userHandle
      ? `${platformLabel} (${escapeHtml(userHandle)})`
      : platformLabel;

    let successCount = 0;
    for (const adminId of adminIds) {
      const notifBody =
        `🔔 <b>Nueva Cita Confirmada</b>\n\n` +
        `📋 <b>Ticket:</b> <code>${escapeHtml(ticketId)}</code>\n` +
        `📱 <b>Origen:</b> ${originLine}\n` +
        `🚗 <b>Vehículo:</b> ${escapeHtml(session.vehiculo_tipo || "N/A")} / ${escapeHtml(session.vehiculo_motor || "N/A")}\n` +
        `📅 <b>Era:</b> ${escapeHtml(session.vehiculo_era || "N/A")}\n` +
        `📻 <b>Km:</b> ${session.kilometraje ?? "N/A"}\n` +
        `🔧 <b>Servicio:</b> ${escapeHtml(session.servicio_solicitado || "N/A")}\n` +
        `📆 <b>Fecha:</b> ${escapeHtml(session.fecha_cita || "N/A")}\n` +
        `🕐 <b>Hora:</b> ${escapeHtml(session.hora_cita || "N/A")}`;

      await backendApi
        .sendMessage(adminId, notifBody, { parse_mode: "HTML" })
        .then(() => {
          successCount++;
        })
        .catch((err: unknown) => {
          console.error("[AdminNotif] Failed to send to:", adminId, {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }
    console.log(
      `[AdminNotif] Dispatched ${successCount}/${adminIds.length} for ticket:`,
      ticketId,
    );

    const service = new AdminNotificationService(env.DB);
    await service.saveNotification({
      ticket_id: ticketId,
      vehiculo_tipo: session.vehiculo_tipo || "",
      vehiculo_motor: session.vehiculo_motor || "",
      vehiculo_era: session.vehiculo_era || "",
      servicio_solicitado: session.servicio_solicitado || "",
      fecha_cita: session.fecha_cita || "",
      hora_cita: session.hora_cita || "",
      kilometraje: session.kilometraje ?? 0,
      telegram_user_id: session.telegram_user_id,
    });
  }

  static async dispatchApiError(
    env: CoreEnv,
    alert: WhatsAppApiErrorAlert,
  ): Promise<void> {
    const backendApi = TelegramApiFactory.create(env, "backend");
    const adminIds = AdminAuthService.parseAdminIds(env);
    const now = new Date().toISOString();

    const notifBody =
      `🚨 <b>Error WhatsApp API</b>\n\n` +
      `⚠️ <code>${escapeHtml(alert.errorCode)}</code>\n` +
      `📱 Paso: ${alert.step} | Tel: ${escapeHtml(alert.phone)}\n` +
      `🔗 fbtrace_id: <code>${escapeHtml(alert.fbtraceId || "N/A")}</code>\n` +
      `📅 Hora: <code>${escapeHtml(now)}</code>`;

    for (const adminId of adminIds) {
      await backendApi
        .sendMessage(adminId, notifBody, { parse_mode: "HTML" })
        .catch((err: unknown) => {
          console.error("[AdminNotif] Failed to send API error to:", adminId, {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }
  }
}
