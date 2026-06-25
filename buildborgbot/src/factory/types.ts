import type { ConversationFlavor } from "@grammyjs/conversations";
import type { Context, SessionFlavor } from "grammy";
import type { z } from "zod";
import type { MenuSchema } from "./schemas";

export const FACTORY_ENV_SYMBOL = Symbol("TITANIUM_FACTORY_ENV");

export interface CoreEnv {
  DB: D1Database;
  GEMINI_API_KEY: string;
  AI_MODEL_NAME: string;
  TITANIUM_API_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  MIGRATION_KEY?: string;
  ADMIN_TELEGRAM_IDS?: string;
  BOT_TOKENS: Record<string, string | undefined>;
}

export interface FactoryBotConfig {
  bot_id: string;
  bot_name: string;
  token_var_name: string;
  system_prompt: string;
  welcome_message: string;
  menu_json: string;
  bot_kind: "open_chat" | "agendado" | "tool_specialist";
  config_json: string;
  meta_phone_number_id?: string;
  meta_app_secret?: string;
  webhook_secret_hash?: string;
}

export interface FactorySequence {
  step_number: number;
  title: string;
  description: string;
  payload_json: string;
}

export interface TitaniumSession extends Record<string, unknown> {
  _titaniumEnv?: CoreEnv;
  _titaniumBotId?: string;
  _titaniumHost?: string;
  step_data?: Record<string, string>;
  paso_actual?: number;
  estado_flujo?: "iniciado" | "completado" | "confirmado" | "cancelado";
}

export type FactoryContext = Context &
  SessionFlavor<TitaniumSession> & {
    conversation: ConversationFlavor<Context>["conversation"];
    env: CoreEnv;
    botId: string;
    host: string;
    platform: "telegram" | "whatsapp";
    waitUntil: (promise: Promise<unknown>) => void;
    replyInteractiveButtons?: (
      body: string,
      buttons: { id: string; title: string }[],
    ) => Promise<unknown>;
    replyInteractiveList?: (
      body: string,
      button: string,
      sections: {
        title: string;
        rows: { id: string; title: string; description?: string }[];
      }[],
    ) => Promise<unknown>;
    hasCommand?: (cmd: string) => boolean;
  };

export type Menu = z.infer<typeof MenuSchema>;
