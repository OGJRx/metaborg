import { z } from "zod";

export const StepSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/, "step id must be snake_case"),
  type: z.enum([
    "select",
    "multi_select",
    "text",
    "number",
    "date",
    "time",
    "datetime",
  ]),
  label: z.string().min(1).max(60),
  prompt: z.string().min(1).max(2000),
  placeholder: z.string().optional(),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(60),
        value: z.string().min(1).max(100),
      }),
    )
    .optional(),
  validation: z
    .object({
      required: z.boolean().default(true),
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
    })
    .optional(),
  error_message: z.string().optional(),
  visible_if: z
    .object({
      step: z.string(),
      value: z.string(),
    })
    .optional(),
});

export const AgendadoConfigSchema = z.object({
  business_identity: z.object({
    name: z.string().min(1).max(100),
    welcome_message: z.string().max(2000),
    location_label: z.string().max(200).optional(),
    location_maps_url: z.string().url().optional(),
    protocol_message: z.string().max(1000).optional(),
    cancel_message: z.string().default("❌ Operación cancelada."),
    confirm_message: z
      .string()
      .default(
        "✅ <b>¡Cita confirmada!</b>\n\nTu ticket es: <code>${ticketId}</code>",
      ),
    invalid_input_message: z
      .string()
      .default("⚠️ Entrada no válida. Reintenta."),
    summary_header: z.string().default("<b>📋 RESUMEN DE CITA</b>"),
    confirm_prompt: z.string().default("\n¿Desea confirmar la cita?"),
    confirm_yes_label: z.string().default("✅ Confirmar"),
    confirm_no_label: z.string().default("❌ Cancelar"),
  }),
  scheduling: z.object({
    capacity_per_slot: z.number().int().min(1).max(50).default(6),
    slot_duration_minutes: z.number().int().min(5).max(480).default(30),
    booking_horizon_days: z.number().int().min(1).max(90).default(14),
    buffer_arrival_minutes: z.number().int().min(0).max(120).default(30),
  }),
  office_hours: z.object({
    work_days: z.array(z.boolean()).length(7),
    open_hour: z.number().int().min(0).max(23),
    close_hour: z.number().int().min(1).max(24),
    timezone: z.string().default("America/Caracas"),
  }),
  steps: z.array(StepSchema).min(1).max(20),
  appointment_mapping: z
    .object({
      date_step_id: z.string().optional(),
      time_step_id: z.string().optional(),
    })
    .optional(),
  cancel_keywords: z.array(z.string()).default(["cancelar"]),
  help_keywords: z.array(z.string()).default(["ayuda", "reiniciar"]),
});

export const OpenChatConfigSchema = z.object({
  system_prompt: z.string(),
  welcome_message: z.string(),
  menu_json: z.string(),
});

export const ToolSpecialistConfigSchema = z.object({
  system_prompt: z.string(),
  welcome_message: z.string(),
  lookup_source: z.enum(["obd_db", "parts_catalog", "none"]),
});

export const KernelConfigSchema = z.object({
  system_prompt: z.string(),
  tools_enabled: z.array(z.string()).default([
    "list_tickets",
    "get_ticket_detail",
    "daily_summary",
    "generate_invoice",
    "send_reminder",
  ]),
});

export const BotConfigSchema = z.discriminatedUnion("bot_kind", [
  z.object({
    bot_kind: z.literal("open_chat"),
    ...OpenChatConfigSchema.shape,
  }),
  z.object({
    bot_kind: z.literal("agendado"),
    ...AgendadoConfigSchema.shape,
  }),
  z.object({
    bot_kind: z.literal("tool_specialist"),
    ...ToolSpecialistConfigSchema.shape,
  }),
  z.object({
    bot_kind: z.literal("kernel_admin"),
    ...KernelConfigSchema.shape,
  }),
]);

export const ConfigSchema = z.object({
  bot_id: z.string(),
  bot_name: z.string(),
  token_var_name: z.string(),
  bot_kind: z
    .enum(["open_chat", "agendado", "tool_specialist", "kernel_admin"])
    .default("open_chat"),
  config_json: z.string(),
  system_prompt: z.string().optional(),
  welcome_message: z.string().optional(),
  menu_json: z.string().optional(),
  token: z.string().optional(),
  meta_phone_number_id: z.string().optional(),
  meta_app_secret: z.string().optional(),
  stack_id: z.string().optional(),
  owner_id: z.number().optional(),
});

export const PatchConfigSchema = ConfigSchema.partial().omit({ bot_id: true });

export const SummarizeSchema = z.object({
  bot_id: z.string(),
  chat_id: z.string(),
  mode: z.enum(["ai", "manual"]),
  manual_summary: z.string().optional(),
});

export const MemoryQuerySchema = z.object({
  bot_id: z.string(),
  chat_id: z.string(),
  cursor: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export const SequenceSchema = z.object({
  bot_id: z.string(),
  step_number: z.number(),
  title: z.string(),
  description: z.string(),
  payload_json: z.string(),
});

export const MenuSchema = z.array(
  z.object({
    label: z.string(),
    action: z.string(),
  }),
);

export const TelegramUpdateSchema = z
  .object({
    update_id: z.number(),
  })
  .passthrough();

export const GenericSuccessSchema = z.object({
  success: z.boolean(),
});
