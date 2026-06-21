import { InlineKeyboard } from "grammy";
import { buildCallback } from "../security";
import { CoreEnv } from "../types";

export class MenuFactory {
  /**
   * Build admin main menu with personalized dashboard URLs using admin Telegram ID.
   * Callback buttons still use BORG_SECRET_KEY for HMAC signing (server-side only).
   */
  static async buildAdminMainMenu(adminId: number, env: CoreEnv) {
    const secret = env.BORG_SECRET_KEY;

    return new InlineKeyboard()
      .text(
        "📊 Gestión de Citas",
        await buildCallback("adm_appts", "0", secret),
      )
      .row()
      .text("🤖 Diagnóstico IA", await buildCallback("adm_ia", "0", secret))
      .row()
      .text(
        "🔔 Citas Recientes",
        await buildCallback("adm_notifs", "0", secret),
      )
      .row()
      .text(
        "🔄 Actualizar Comandos",
        await buildCallback("refresh_cmds", "0", secret),
      );
  }

  static async buildAppointmentsMenu(secret: string): Promise<InlineKeyboard> {
    return new InlineKeyboard()
      .text("📅 Citas de Hoy", await buildCallback("adm_today", "0", secret))
      .row()
      .text(
        "🔜 Próximas 10 Citas",
        await buildCallback("adm_upcoming", "0", secret),
      )
      .row()
      .text("🏠 Menú Principal", await buildCallback("adm_main", "0", secret));
  }

  static async buildIAFeaturesMenu(secret: string): Promise<InlineKeyboard> {
    return new InlineKeyboard()
      .text(
        "🔍 Asistente de Diagnóstico",
        await buildCallback("ia_ia", "0", secret),
      )
      .row()
      .text("🏠 Menú Principal", await buildCallback("adm_main", "0", secret));
  }

  static async buildDiagnosticMenu(secret: string): Promise<InlineKeyboard> {
    return new InlineKeyboard()
      .text("🔢 Códigos OBD", await buildCallback("ia_obd", "0", secret))
      .row()
      .text("🏠 Menú Principal", await buildCallback("adm_main", "0", secret));
  }
}
