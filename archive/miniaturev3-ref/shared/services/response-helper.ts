import { Platform } from "../types";

export class ResponseHelper {
  static json(d: unknown, s = 200): Response {
    return new Response(JSON.stringify(d), {
      status: s,
      headers: { "Content-Type": "application/json" },
    });
  }
  static text(t: string, s = 200): Response {
    return new Response(t, { status: s });
  }
}

export function getPlatformErrorFallback(platform: Platform): string {
  switch (platform) {
    case "telegram":
      return "⚠️ <b>Error del sistema.</b>\nIntenta de nuevo.";
    case "whatsapp":
      return "*Error del sistema*\nIntenta de nuevo más tarde.";
    default:
      return "Error del sistema.";
  }
}
