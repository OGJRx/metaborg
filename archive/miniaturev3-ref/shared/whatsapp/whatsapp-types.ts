import { z } from "zod";

export const WhatsAppMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  text: z
    .object({
      body: z.string(),
    })
    .optional(),
  interactive: z
    .object({
      type: z.enum(["button_reply", "list_reply"]),
      button_reply: z
        .object({
          id: z.string(),
          title: z.string(),
        })
        .optional(),
      list_reply: z
        .object({
          id: z.string(),
          title: z.string(),
          description: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  type: z.string(),
});

export const WhatsAppWebhookEventSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          value: z.object({
            messaging_product: z.literal("whatsapp"),
            metadata: z.object({
              display_phone_number: z.string(),
              phone_number_id: z.string(),
            }),
            messages: z.array(WhatsAppMessageSchema).optional(),
            statuses: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.string(),
                  recipient_id: z.string(),
                }),
              )
              .optional(),
          }),
          field: z.string(),
        }),
      ),
    }),
  ),
});

export type WhatsAppMessage = z.infer<typeof WhatsAppMessageSchema>;
export type WhatsAppWebhookEvent = z.infer<typeof WhatsAppWebhookEventSchema>;
