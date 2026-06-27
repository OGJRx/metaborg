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
        `✅ <b>¡Cita confirmada!</b>\n\nTu ticket es: <code>${"${"}ticketId}</code>`,
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
  system_prompt: z
    .string()
    .default(
      "Responde SIEMPRE en texto plano. Prohibido usar HTML, Markdown, asteriscos, hashtags, backticks o cualquier formato.",
    ),
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
  tools_enabled: z
    .array(z.string())
    .default([
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

export const BotKindEnum = z.enum([
  "open_chat",
  "agendado",
  "tool_specialist",
  "kernel_admin",
]);
export type BotKind = z.infer<typeof BotKindEnum>;

export const ConfigSchema = z.object({
  bot_id: z.string(),
  bot_name: z.string(),
  token_var_name: z.string(),
  bot_kind: BotKindEnum.default("open_chat"),
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

export const WORKSHOP_AGENDADO_CONFIG: z.infer<typeof AgendadoConfigSchema> = {
  business_identity: {
    name: "Taller Mecánico",
    welcome_message:
      "🚗 <b>Bienvenido al Centro de Servicio</b>\n\nSoy tu asistente virtual. Estoy aquí para ayudarte a agendar tu cita de mantenimiento de manera rápida y sencilla.",
    location_label: "Sede Principal",
    location_maps_url: "https://maps.google.com",
    protocol_message:
      "📍 Te esperamos en nuestra sede. Recuerda llegar 15 minutos antes.",
    cancel_message: "❌ Operación cancelada. Estamos a tu orden.",
    confirm_message: `✅ <b>¡Cita confirmada!</b>\n\nTu ticket de atención es: <code>${"${"}ticketId}</code>`,
    summary_header: "<b>📋 RESUMEN DE TU CITA</b>",
    confirm_prompt: "\n¿Deseas confirmar estos datos?",
    confirm_yes_label: "✅ Confirmar",
    confirm_no_label: "❌ Cancelar",
    invalid_input_message: "⚠️ Entrada no válida. Por favor, intenta de nuevo.",
  },
  scheduling: {
    capacity_per_slot: 2,
    slot_duration_minutes: 60,
    booking_horizon_days: 14,
    buffer_arrival_minutes: 15,
  },
  office_hours: {
    work_days: [false, true, true, true, true, true, false],
    open_hour: 8,
    close_hour: 17,
    timezone: "America/Caracas",
  },
  steps: [
    {
      id: "vehiculo",
      type: "select",
      label: "Tipo de Vehículo",
      prompt: "Selecciona el tipo de vehículo:",
      options: [
        { label: "Sedán / Compacto", value: "sedan" },
        { label: "Camioneta / SUV", value: "suv" },
        { label: "Moto", value: "moto" },
      ],
    },
    {
      id: "motor",
      type: "select",
      label: "Tipo de Motor",
      prompt: "¿Qué tipo de motor tiene su vehículo?",
      options: [
        { label: "Gasolina", value: "gasolina" },
        { label: "Diesel", value: "diesel" },
        { label: "Híbrido / Eléctrico", value: "electrico" },
      ],
    },
    {
      id: "servicio",
      type: "select",
      label: "Servicio",
      prompt: "Selecciona el servicio requerido:",
      options: [
        { label: "Cambio de Aceite", value: "aceite" },
        { label: "Frenos", value: "frenos" },
        { label: "Diagnóstico Computarizado", value: "scanner" },
        { label: "Mantenimiento Preventivo", value: "preventivo" },
      ],
    },
    {
      id: "fecha",
      type: "date",
      label: "Fecha",
      prompt: "Selecciona el día de tu visita:",
    },
    {
      id: "hora",
      type: "time",
      label: "Hora",
      prompt: "Selecciona el horario disponible:",
    },
  ],
  appointment_mapping: {
    date_step_id: "fecha",
    time_step_id: "hora",
  },
  cancel_keywords: ["cancelar", "salir", "abortar"],
  help_keywords: ["ayuda", "reiniciar", "inicio"],
};

export const GENERIC_AGENDADO_CONFIG: z.infer<typeof AgendadoConfigSchema> = {
  business_identity: {
    name: "Nuevo Negocio",
    welcome_message:
      "📅 <b>Bienvenido al Sistema de Agendado</b>\n\nReserva tu cita de manera rápida y sencilla.",
    cancel_message: "❌ Operación cancelada.",
    confirm_message: `✅ <b>¡Cita confirmada!</b>\n\nTu ticket es: <code>${"${"}ticketId}</code>`,
    summary_header: "<b>📋 RESUMEN DE CITA</b>",
    confirm_prompt: "\n¿Deseas confirmar la cita?",
    confirm_yes_label: "✅ Confirmar",
    confirm_no_label: "❌ Cancelar",
    invalid_input_message: "⚠️ Entrada no válida.",
  },
  scheduling: {
    capacity_per_slot: 1,
    slot_duration_minutes: 30,
    booking_horizon_days: 7,
    buffer_arrival_minutes: 0,
  },
  office_hours: {
    work_days: [false, true, true, true, true, true, false],
    open_hour: 9,
    close_hour: 18,
    timezone: "America/Caracas",
  },
  steps: [
    {
      id: "servicio",
      type: "text",
      label: "Servicio",
      prompt: "¿Qué servicio solicita?",
    },
    {
      id: "fecha",
      type: "date",
      label: "Fecha",
      prompt: "Selecciona la fecha:",
    },
    {
      id: "hora",
      type: "time",
      label: "Hora",
      prompt: "Selecciona la hora:",
    },
  ],
  appointment_mapping: {
    date_step_id: "fecha",
    time_step_id: "hora",
  },
  cancel_keywords: ["cancelar"],
  help_keywords: ["ayuda", "inicio"],
};

export const DEFAULT_AGENDADO_CONFIG = GENERIC_AGENDADO_CONFIG;

export const BORG_VERSION = "9.7.0-TITANIUM";

export const AGENT_PROMPTS = {
  OBD_DIAGNOSTICO: `# OBD DIAGNOSTICO TITANIUM (${BORG_VERSION})
Eres un especialista en diagnostico vehicular OBD-II del Taller Titanium. Tu unica mision es interpretar codigos de falla, sintomas y hipotesis diagnosticas.

## No exceder los 170 tokens de respuestas:
#CRITERIOS DE LA TAREA:
- **Enfoque:** Tu principal métrica de éxito es reducir el recuento de tokens manteniendo el 100% de la intención original.
- **Entrada (Input):** Historial y contexto largo y redundante.
- **Salida (Output):** Debes devolver únicamente el contenido refinado y comprimido.

## MODO DE OPERACION:
- El administrador activo este modo para enviar codigos OBD-II, describir sintomas o plantear hipotesis de diagnostico.
- Responde de forma tecnica, directa y estructurada.
- Si el usuario envia un codigo OBD-II (formato P0xxx, P1xxx, B0xxx, C0xxx, U0xxx), interpreta: causa raiz, gravedad, sintomas comunes y solucion recomendada.
- Si el usuario describe un sintoma sin codigo, genera un diagnostico diferencial con los codigos mas probables.
- Si el usuario plantea una hipotesis (ej. "creo que es el sensor MAF"), confirma o refuta con fundamentos tecnicos y sugiere pruebas adicionales.
- Si el usuario envia multiples codigos de una sola vez, identifica correlaciones entre ellos (fallas sistematicas vs. incidentales).

## REGLAS:
- Prohibido usar simbolos '<' o '>'. Usa 'maximo', 'minimo' o 'menos de'.
- Respuestas en texto plano estructurado. Usa MAYUSCULAS para titulos y guiones para listas. No uses Markdown (#, *, \`, etc.).
- Idioma: Espanol.
- No des contexto de bahias ni precios. Solo diagnostico puro.
- Debes devolver únicamente el contenido refinado y comprimido. Tu principal métrica de éxito es reducir el recuento de tokens manteniendo el 100% de la intención original.
- Tienes acceso a Google Search. Úsalo para investigar códigos OBD propietarios o poco comunes para ofrecer soluciones precisas.

## CONTEXTO DE BASE DE DATOS:
- Si se proporciona un bloque "DATOS OBD DEL TALLER:", prioriza esa información sobre tu conocimiento general.
- Si no hay resultados de DB para un código, indícalo explícitamente: "Código no encontrado en la base de datos del taller. Interpretación basada en conocimiento general."`,
};

export const TelegramUpdateSchema = z
  .object({
    update_id: z.number(),
  })
  .passthrough();

export const GenericSuccessSchema = z.object({
  success: z.boolean(),
});
