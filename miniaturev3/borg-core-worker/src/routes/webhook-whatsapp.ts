import { CoreEnv, BorgExecutionContext } from "../../../shared/types";
import { WhatsAppWebhookEventSchema } from "../../../shared/whatsapp/whatsapp-types";
import { hmacSha256, timingSafeEqual } from "../../../shared/security/crypto";
import { WhatsAppApi } from "../../../shared/whatsapp/whatsapp-api";
import { WhatsAppBookingOrchestrator } from "../whatsapp-booking";
import { BorgLogger } from "../../../shared/services/borg-logger";

export async function handleWhatsAppWebhook(
  req: Request,
  env: CoreEnv,
  ctx: BorgExecutionContext,
): Promise<Response> {
  const url = new URL(req.url);

  // 1. GET Challenge (Verification)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // 2. POST Webhook (Events)
  if (req.method === "POST") {
    const signature = req.headers.get("X-Hub-Signature-256");
    if (!signature) {
      console.warn("[WhatsAppWebhook] Missing X-Hub-Signature-256 header");
      return new Response("No signature", { status: 401 });
    }

    const body = await req.text();
    const expectedSignature =
      "sha256=" + (await hmacSha256(env.WHATSAPP_APP_SECRET, body));

    if (!(await timingSafeEqual(signature, expectedSignature))) {
      console.warn("[WhatsAppWebhook] HMAC signature mismatch");
      return new Response("Invalid signature", { status: 401 });
    }

    console.log("[WhatsAppWebhook] Payload received, parsing...");

    try {
      const payload = WhatsAppWebhookEventSchema.parse(JSON.parse(body));
      let messageCount = 0;
      for (const entry of payload.entry) {
        for (const change of entry.changes) {
          if (change.value.messages) {
            for (const msg of change.value.messages) {
              messageCount++;
              console.log(
                `[WhatsAppWebhook] Message #${messageCount}: id=${msg.id} from=${msg.from} type=${msg.type}`,
              );

              // 1. Idempotency check
              try {
                await env.DB.prepare(
                  "INSERT INTO processed_wa_messages (wa_message_id, phone_number) VALUES (?, ?)",
                )
                  .bind(msg.id, msg.from)
                  .run();
              } catch (e: unknown) {
                const errMsg = e instanceof Error ? e.message : String(e);
                if (
                  !errMsg.includes("UNIQUE constraint") &&
                  !errMsg.includes("SQLITE_CONSTRAINT")
                ) {
                  console.error(`[WhatsAppWebhook] DB error: ${errMsg}`);
                  return new Response("Internal Server Error", { status: 500 });
                }
                console.log(
                  `[WhatsAppWebhook] Duplicate message skipped: ${msg.id}`,
                );
                continue;
              }

              // 2. Mark as read
              const logger = new BorgLogger(
                "WhatsAppWebhook",
                env.DB,
                ctx.traceId,
                ctx,
              );
              const waApi = new WhatsAppApi(env, logger);
              ctx.waitUntil(waApi.markAsRead(msg.id));

              // 3. Persist message to D1
              ctx.waitUntil(
                env.DB.prepare(
                  "INSERT INTO whatsapp_messages (wa_message_id, phone_number, direction, status, payload) VALUES (?, ?, 'inbound', 'received', ?)",
                )
                  .bind(msg.id, msg.from, JSON.stringify(msg))
                  .run(),
              );

              // 4. Process with Orchestrator
              const orchestrator = new WhatsAppBookingOrchestrator(env, ctx);
              if (msg.type === "text" && msg.text) {
                try {
                  console.log(
                    `[WhatsAppWebhook] Processing text: "${msg.text.body.substring(0, 50)}"`,
                  );
                  await orchestrator.handleMessage(msg.from, msg.text.body);
                  console.log(
                    `[WhatsAppWebhook] Text message processed OK for ${msg.from}`,
                  );
                } catch (err: unknown) {
                  console.error(
                    `[WhatsAppWebhook] Orchestrator error for ${msg.from}:`,
                    err,
                  );
                }
              } else if (msg.type === "interactive" && msg.interactive) {
                try {
                  let replyId: string | undefined;
                  if (msg.interactive.type === "button_reply") {
                    replyId = msg.interactive.button_reply?.id;
                  } else if (msg.interactive.type === "list_reply") {
                    replyId = msg.interactive.list_reply?.id;
                  }

                  if (replyId) {
                    console.log(
                      `[WhatsAppWebhook] Processing interactive: type=${msg.interactive.type} replyId=${replyId}`,
                    );
                    await orchestrator.handleInteractiveReply(
                      msg.from,
                      replyId,
                    );
                    console.log(
                      `[WhatsAppWebhook] Interactive reply processed OK for ${msg.from}`,
                    );
                  }
                } catch (err: unknown) {
                  console.error(
                    `[WhatsAppWebhook] Interactive reply error for ${msg.from}:`,
                    err,
                  );
                }
              } else {
                console.log(
                  `[WhatsAppWebhook] Unhandled message type: ${msg.type} from ${msg.from}`,
                );
              }
            }
          } else {
            console.log(
              `[WhatsAppWebhook] Change received (no messages): field=${Object.keys(change.value).join(",")}`,
            );
          }
        }
      }
      console.log(
        `[WhatsAppWebhook] Processing complete. ${messageCount} message(s) handled.`,
      );
    } catch (e: unknown) {
      console.error("[WhatsAppWebhook] Parse error:", e);
    }

    return new Response("OK", { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
}
