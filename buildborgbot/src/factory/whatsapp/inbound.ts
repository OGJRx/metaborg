import { timingSafeEqual } from "../security";

/**
 * Validates the HMAC signature from WhatsApp/Meta.
 * x-hub-signature-256 header must match HMAC-SHA256(payload, app_secret)
 */
export async function validateWhatsAppSignature(
  payload: string,
  signatureHeader: string,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader.startsWith("sha256=")) return false;
  const signature = signatureHeader.substring(7);

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const hashArray = Array.from(new Uint8Array(mac));
  const digest = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return await timingSafeEqual(digest, signature, appSecret);
}

export interface WhatsAppInboundEvent {
  object: "whatsapp_business_account";
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: "whatsapp";
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: { name: string };
          wa_id: string;
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          text?: { body: string };
          type: string;
          interactive?: {
            type: "button_reply" | "list_reply";
            button_reply?: { id: string; title: string };
            list_reply?: { id: string; title: string; description: string };
          };
        }>;
      };
      field: "messages";
    }>;
  }>;
}
