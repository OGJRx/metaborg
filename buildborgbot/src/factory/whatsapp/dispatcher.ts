import { RelationalSessionAdapter } from "../adapter";
import { handleAgendadoUpdate } from "../flows/agendado";
import { AgendadoConfigSchema } from "../schemas";
import { decrypt, deriveKey } from "../security";
import type { CoreEnv, FactoryContext, TitaniumSession } from "../types";
import {
  validateWhatsAppSignature,
  type WhatsAppInboundEvent,
} from "./inbound";
import { sendWhatsAppMessage } from "./outbound";

export async function handleWhatsAppWebhook(
  req: Request,
  env: CoreEnv,
  ctx: ExecutionContext,
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

  // Idempotency: Mark BEFORE processing
  const updateId = message.id;
  const alreadyProcessed = await env.DB.prepare(
    "SELECT 1 FROM factory_processed_updates WHERE bot_id = ? AND update_id = ?",
  )
    .bind(bot.bot_id, updateId)
    .first();

  if (alreadyProcessed) return new Response("OK");

  await env.DB.prepare(
    "INSERT INTO factory_processed_updates (bot_id, update_id, processed_at) VALUES (?, ?, unixepoch())",
  )
    .bind(bot.bot_id, updateId)
    .run();

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
    const sessionAdapter = new RelationalSessionAdapter(env.DB, "whatsapp");
    const session = await sessionAdapter.read(sessionKey);

    const waContext: Partial<FactoryContext> = {
      botId: bot.bot_id,
      env,
      platform: "whatsapp",
      waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p),
      session: (session as TitaniumSession) || {
        step_data: {},
        paso_actual: 0,
        _titaniumPlatform: "whatsapp",
      },
      chat: {
        id: Number.parseInt(chatId.replace(/\D/g, ""), 10) || 0,
        type: "private",
      },
      from: {
        id: Number.parseInt(chatId.replace(/\D/g, ""), 10) || 0,
        first_name: "WA User",
        is_bot: false,
      },
      message: message.text
        ? ({
            message_id: 0,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 0, type: "private" },
            text: message.text.body,
          } as FactoryContext["message"])
        : undefined,
      callbackQuery: message.interactive
        ? ({
            id: "0",
            from: { id: 0, first_name: "WA", is_bot: false },
            chat_instance: "0",
            data:
              message.interactive.button_reply?.id ||
              message.interactive.list_reply?.id,
          } as FactoryContext["callbackQuery"])
        : undefined,
      reply: (async (text: string) => {
        await sendWhatsAppMessage(phoneNumberId, decryptedToken, {
          messaging_product: "whatsapp",
          to: chatId,
          type: "text",
          text: { body: text },
        });
        return { message_id: 0 } as never;
      }) as FactoryContext["reply"],
      replyInteractiveButtons: async (
        body: string,
        buttons: { id: string; title: string }[],
      ) => {
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
        return { message_id: 0 } as never;
      },
      replyInteractiveList: async (
        body: string,
        button: string,
        sections: {
          title: string;
          rows: { id: string; title: string; description?: string }[];
        }[],
      ) => {
        await sendWhatsAppMessage(phoneNumberId, decryptedToken, {
          messaging_product: "whatsapp",
          to: chatId,
          type: "interactive",
          interactive: {
            type: "list",
            body: { text: body },
            action: {
              button,
              sections: sections as Record<string, unknown>[],
            },
          },
        });
        return { message_id: 0 } as never;
      },
      hasCommand: (cmd: string) => message.text?.body === `/${cmd}`,
    };

    await handleAgendadoUpdate(waContext as FactoryContext, config);

    // Persist session
    ctx.waitUntil(
      sessionAdapter.write(sessionKey, waContext.session).catch((err) => {
        console.error(
          JSON.stringify({
            level: "error",
            tag: "WHATSAPP_SESSION_WRITE_FAILED",
            botId: bot.bot_id,
            chatId,
            error: String(err),
            timestamp: new Date().toISOString(),
          }),
        );
      }),
    );
  }

  return new Response("OK");
}
