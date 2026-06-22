import { CoreEnv } from "../types";
import { decrypt, deriveKey, timingSafeEqual } from "./security";
import { handleUpdate } from "./engine";

export async function handleWhatsAppWebhook(
  req: Request,
  env: CoreEnv,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token && challenge) {
      const bot = await env.DB.prepare(
        "SELECT bot_id FROM factory_bots WHERE config_json LIKE ?"
      ).bind(`%${token}%`).first();

      if (bot) return new Response(challenge);
    }
    return new Response("Forbidden", { status: 403 });
  }

  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const payload = JSON.parse(body);

  const entry = payload.entry?.[0]?.changes?.[0]?.value;
  if (!entry?.metadata?.phone_number_id) {
    return new Response("No phone_number_id", { status: 400 });
  }
  const phoneNumberId = entry.metadata.phone_number_id;

  const bot = await env.DB.prepare(
    "SELECT bot_id, token, token_iv, meta_app_secret FROM factory_bots WHERE meta_phone_number_id = ?"
  ).bind(phoneNumberId).first<{ bot_id: string; token: string; token_iv: string; meta_app_secret: string }>();

  if (!bot) return new Response("OK");

  // Decrypt token for engine
  const key = await deriveKey(env.TITANIUM_API_SECRET);
  const plainToken = await decrypt(bot.token, bot.token_iv, key);

  // Dispatch to common engine
  return await handleUpdate(
      bot.bot_id,
      plainToken,
      { update_id: Date.now(), message: { text: entry.messages?.[0]?.text?.body || "", from: { id: entry.messages?.[0]?.from || 0 } } } as any,
      env,
      ctx.waitUntil.bind(ctx),
      url.host
  );
}
