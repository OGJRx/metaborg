import { AgendadoConfigSchema } from "../schemas";
import type { CoreEnv } from "../types";
import {
  validateWhatsAppSignature,
  type WhatsAppInboundEvent,
} from "./inbound";

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
    "SELECT bot_id, meta_app_secret, bot_kind, config_json FROM factory_bots WHERE meta_phone_number_id = ?",
  )
    .bind(phoneNumberId)
    .first<{
      bot_id: string;
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
  // For now, we focus on Agendado flow. Specialist and OpenChat will need their own renderers.
  if (bot.bot_kind === "agendado") {
    const _config = AgendadoConfigSchema.parse(JSON.parse(bot.config_json));
    // TODO: Implement a WhatsApp-compatible Context for the flows.
    // For now, we mark as processed to avoid loops.
    await env.DB.prepare(
      "INSERT INTO factory_processed_updates (bot_id, update_id, processed_at) VALUES (?, ?, unixepoch())",
    )
      .bind(bot.bot_id, updateId)
      .run();
  }

  return new Response("OK");
}
