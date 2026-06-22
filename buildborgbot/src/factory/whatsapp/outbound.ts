export interface WhatsAppMessagePayload {
  messaging_product: "whatsapp";
  recipient_type?: "individual";
  to: string;
  type: "text" | "interactive";
  text?: {
    body: string;
    preview_url?: boolean;
  };
  interactive?: {
    type: "button" | "list";
    header?: { type: "text"; text: string };
    body: { text: string };
    footer?: { text: string };
    action: any;
  };
}

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  payload: WhatsAppMessagePayload,
): Promise<Response> {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  return await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
