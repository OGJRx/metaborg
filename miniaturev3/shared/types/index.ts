import { z } from "zod";
import { Context } from "grammy";
import { D1Database } from "@cloudflare/workers-types";
import { BorgLogger } from "../services/borg-logger";

export type BorgExecutionContext = {
  traceId: string;
  waitUntil: (p: Promise<unknown>) => void;
};

export type BorgContextFlavor<T> = {
  env: T;
  executionContext: BorgExecutionContext;
  traceId: string;
  logger: BorgLogger;
};

export type BorgContext<T> = Context & BorgContextFlavor<T>;

export interface MessageCapable {
  reply(
    text: string,
    other?: Record<string, unknown> | undefined,
  ): Promise<unknown>;
  editMessageText(
    text: string,
    other?: Record<string, unknown> | undefined,
  ): Promise<unknown>;
  callbackQuery?:
    | {
        message?: unknown | undefined;
      }
    | undefined;
}

export type Platform = "telegram" | "whatsapp";

export type UiContext = Context & MessageCapable & { logger?: BorgLogger };

/**
 * Branded type for SQLite-compatible date-time strings (YYYY-MM-DD HH:mm:ss).
 * This ensures that only strings formatted by toSqliteDateTime can be used
 * in database operations requiring this specific format.
 */
export type SqliteDateTime = string & { readonly __brand: "SqliteDateTime" };

export interface CoreEnv {
  TELEGRAM_ADMIN_IDS: string;
  FRONTEND_BOT_TOKEN: string;
  BACKEND_BOT_TOKEN: string;
  DB: D1Database;
  OBD_DB: D1Database;
  BORG_SECRET_KEY: string;
  GEMINI_API_KEY: string;
  AI_MODEL_NAME: string;
  FRONTEND_BOT_INFO?: string;
  BACKEND_BOT_INFO?: string;
  WORKER_URL?: string;
  TALLER_LATITUD?: string;
  TALLER_LONGITUD?: string;
  TALLER_MAPS_URL?: string;
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_APP_SECRET: string;
  WHATSAPP_VERIFY_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_API_VERSION: string;
  RETENTION_LOGS_DAYS?: string;
  RETENTION_UPDATES_HOURS?: string;
  RETENTION_WHATSAPP_DAYS?: string;
  BORG_TRACE_ID?: string;
}

export interface UbicacionTaller {
  latitud: number;
  longitud: number;
  mapsUrl: string;
}

export const EphemeralStateSchema = z.object({
  session_id: z.string().optional(),
  telegram_user_id: z.string(),
  telegram_chat_id: z.string().optional(),
  platform: z.enum(["telegram", "whatsapp"]),
  active_mode: z.string().optional().nullable(),
  estado_flujo: z.string(),
  paso_actual: z.number(),
  version: z.number().default(1),
  bot_type: z.enum(["frontend", "backend"]).optional(),
  updated_at: z.string().optional(),
  vehiculo_tipo: z.string().optional().nullable(),
  vehiculo_motor: z.string().optional().nullable(),
  vehiculo_era: z.string().optional().nullable(),
  kilometraje: z.number().optional().nullable(),
  servicio_solicitado: z.string().optional().nullable(),
  fecha_cita: z.string().optional().nullable(),
  hora_cita: z.string().optional().nullable(),
});
export type EphemeralState = z.infer<typeof EphemeralStateSchema>;

export interface AdminNotificationRecord {
  id?: number;
  ticket_id: string;
  vehiculo_tipo: string;
  vehiculo_motor: string;
  vehiculo_era: string;
  servicio_solicitado: string;
  fecha_cita: string;
  hora_cita: string;
  kilometraje: number;
  telegram_user_id: string;
  created_at?: string;
}

export const InterpretationResultSchema = z.object({
  extractedData: z.record(z.string(), z.unknown()),
  relevance: z.enum(["HIGH", "MEDIUM", "IRRELEVANT", "DEGRADED"]),
  suggestion: z.string().optional(),
});
export type InterpretationResult = z.infer<typeof InterpretationResultSchema>;

export enum BotAction {
  BOOK_SERVICE = "B",
  MAIN_MENU = "M",
}

export enum CircuitService {
  GEMINI = "gemini",
  TELEGRAM_API = "telegram_api",
  QUEUE_SATURATION = "queue_saturation",
  WHATSAPP = "whatsapp",
}

export interface AiConversationItem {
  role: "user" | "model";
  parts: { text: string }[];
}

export const BotInfoPayloadSchema = z.object({
  id: z.number(),
  first_name: z.string(),
  username: z.string(),
  is_bot: z.literal(true),
  can_join_groups: z.boolean().default(false),
  can_read_all_group_messages: z.boolean().default(false),
  can_manage_bots: z.boolean().default(false),
  supports_inline_queries: z.boolean().default(false),
  can_connect_to_business: z.boolean().default(false),
  has_main_web_app: z.boolean().default(false),
  has_topics_enabled: z.boolean().default(false),
  allows_users_to_create_topics: z.boolean().default(false),
});
export type BotInfoPayload = z.infer<typeof BotInfoPayloadSchema>;
