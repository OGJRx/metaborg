import { RelationalSessionAdapter } from "../adapter";
import { handleAgendadoUpdate } from "../flows/agendado";
import { AgendadoConfigSchema } from "../schemas";
import { decrypt, deriveKey } from "../security";
import type { CoreEnv, FactoryContext } from "../types";
import {
  validateWhatsAppSignature,
  type WhatsAppInboundEvent,
} from "./inbound";
import { sendWhatsAppMessage } from "./outbound";

export async function handleWhatsAppWebhook(
  req: Request,
  env: CoreEnv,
  _ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(req.url);

  // Verification Challenge
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token && challenge) {
      const bot = await env.DB.prepare(
        "SELECT bot_id FROM factory_bots WHERE webhook_secret = ?",
      )
        .bind(token)
        .first();

      if (bot) return new Response(challenge);
    }
    return new Response("Forbidden", { status: 403 });
  }

  // Handle Event
  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";

  const payload = JSON.parse(body) as WhatsAppInboundEvent;
  const entry = payload.entry?.[0]?.changes?.[0]?.value;

  if (!entry?.metadata?.phone_number_id) {
    return new Response("No phone_number_id", { status: 400 });
  }

  const phoneNumberId = entry.metadata.phone_number_id;

  const bot = await env.DB.prepare(
    "SELECT bot_id, token, meta_app_secret, bot_kind, config_json FROM factory_bots WHERE meta_phone_number_id = ?",
  )
    .bind(phoneNumberId)
    .first<{
      bot_id: string;
      token: string;
      meta_app_secret: string;
      bot_kind: string;
      config_json: string;
    }>();

  if (!bot) return new Response("OK");

  // Secure Signature Validation
  if (bot.meta_app_secret) {
    const isValid = await validateWhatsAppSignature(
      body,
      signature,
      bot.meta_app_secret,
    );
    if (!isValid) {
      console.error(`Invalid WhatsApp signature for bot ${bot.bot_id}`);
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const message = entry.messages?.[0];
  if (!message) return new Response("OK");

  // Idempotency
  const updateId = message.id;
  const alreadyProcessed = await env.DB.prepare(
    "SELECT 1 FROM factory_processed_updates WHERE bot_id = ? AND update_id = ?",
  )
    .bind(bot.bot_id, updateId)
    .first();

  if (alreadyProcessed) return new Response("OK");

  // Dispatch logic
  if (bot.bot_kind === "agendado") {
    const config = AgendadoConfigSchema.parse(JSON.parse(bot.config_json));

    // Decrypt Token
    const key = await deriveKey(env.TITANIUM_API_SECRET);
    const tokenIv = (
      await env.DB.prepare("SELECT token_iv FROM factory_bots WHERE bot_id = ?")
        .bind(bot.bot_id)
        .first<{ token_iv: string }>()
    )?.token_iv;
    if (!tokenIv) return new Response("Token IV missing", { status: 500 });
    const decryptedToken = await decrypt(bot.token, tokenIv, key);

    // Construct a minimal Context compatible with handleAgendadoUpdate
    const chatId = message.from;
    const sessionKey = `session:${chatId}:${bot.bot_id}`;
    const sessionAdapter = new RelationalSessionAdapter(env.DB);
    const session = await sessionAdapter.read(sessionKey);

    const waContext: FactoryContext = {
      botId: bot.bot_id,
      env,
      host: "unknown",
      platform: "whatsapp",
      waitUntil: () => {}, // TODO: Proper waitUntil from ctx if needed
      session: (session as any) || { step_data: {}, paso_actual: 0 },
      chat: {
        id: parseInt(chatId.replace(/\D/g, ""), 10) || 0,
        type: "private",
        first_name: "WA User",
      },
      from: {
        id: parseInt(chatId.replace(/\D/g, ""), 10) || 0,
        first_name: "WA User",
        is_bot: false,
      },
      message: message.text ? (({ text: message.text.body } as any)) : undefined,
      callbackQuery: message.interactive
        ? (({
            data:
              message.interactive.button_reply?.id ||
              message.interactive.list_reply?.id,
          } as any))
        : undefined,
      reply: async (text: string) => {
        await sendWhatsAppMessage(phoneNumberId, decryptedToken, {
          messaging_product: "whatsapp",
          to: chatId,
          type: "text",
          text: { body: text },
        });
        return {} as any;
      },
      replyInteractiveButtons: async (body: string, buttons: any[]) => {
        await sendWhatsAppMessage(phoneNumberId, decryptedToken, {
          messaging_product: "whatsapp",
          to: chatId,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: body },
            action: {
              buttons: buttons.map((b) => ({ type: "reply", reply: b })),
            },
          },
        });
        return {} as any;
      },
      replyInteractiveList: async (
        body: string,
        button: string,
        sections: any[],
      ) => {
        await sendWhatsAppMessage(phoneNumberId, decryptedToken, {
          messaging_product: "whatsapp",
          to: chatId,
          type: "interactive",
          interactive: {
            type: "list",
            body: { text: body },
            action: { button, sections },
          },
        });
        return {} as any;
      },
      hasCommand: (cmd: string) => message.text?.body === `/${cmd}`,
    } as any;

    await handleAgendadoUpdate(waContext, config);

    // Persist session
    await sessionAdapter.write(sessionKey, waContext.session);

    await env.DB.prepare(
      "INSERT INTO factory_processed_updates (bot_id, update_id, processed_at) VALUES (?, ?, unixepoch())",
    )
      .bind(bot.bot_id, updateId)
      .run();
  }

  return new Response("OK");
}
