import { BotConfigSchema } from "../src/factory/schemas";

const kinds = [
  "open_chat",
  "agendado",
  "tool_specialist",
  "kernel_admin",
] as const;

type BotKind = (typeof kinds)[number];

function getFullConfig(kind: BotKind): Record<string, unknown> {
  const base = { bot_kind: kind };
  switch (kind) {
    case "open_chat":
      return {
        ...base,
        system_prompt: "You are a helpful assistant.",
        welcome_message: "Hello!",
        menu_json: "[]",
      };
    case "agendado":
      return {
        ...base,
        business_identity: {
          name: "Test Business",
          welcome_message: "Welcome to our booking system",
          cancel_message: "❌ Operación cancelada.",
          confirm_message: "✅ Cita confirmada",
          invalid_input_message: "⚠️ Entrada no válida.",
          summary_header: "📋 RESUMEN",
          confirm_prompt: "¿Confirmar?",
          confirm_yes_label: "SÍ",
          confirm_no_label: "NO",
        },
        scheduling: {
          capacity_per_slot: 1,
          slot_duration_minutes: 30,
          booking_horizon_days: 7,
          buffer_arrival_minutes: 15,
        },
        office_hours: {
          work_days: [false, true, true, true, true, true, false],
          open_hour: 9,
          close_hour: 18,
          timezone: "America/Caracas",
        },
        steps: [
          {
            id: "service",
            type: "select",
            label: "Servicio",
            prompt: "Seleccione un servicio",
            options: [{ label: "Corte", value: "corte" }],
          },
        ],
        appointment_mapping: {
          date_step_id: "date",
          time_step_id: "time",
        },
        cancel_keywords: ["cancelar"],
        help_keywords: ["ayuda"],
      };
    case "tool_specialist":
      return {
        ...base,
        system_prompt: "Specialist prompt",
        welcome_message: "Welcome specialist",
        lookup_source: "obd_db",
      };
    case "kernel_admin":
      return {
        ...base,
        system_prompt: "Admin system prompt",
        tools_enabled: ["list_tickets"],
      };
  }
}

console.log("🚀 Validating Config Matrix for all bot_kind...");

let failed = false;

for (const kind of kinds) {
  console.log(`\nChecking [${kind}]...`);
  const fullConfig = getFullConfig(kind);

  try {
    BotConfigSchema.parse(fullConfig);
    console.log(`✅ [${kind}] Config is valid via BotConfigSchema.`);
  } catch (e) {
    // @ts-expect-error - e is unknown
    console.error(`❌ [${kind}] Sample FAILED validation:`, e.errors);
    failed = true;
  }

  // Test that invalid config is rejected
  try {
    BotConfigSchema.parse({ bot_kind: kind, invalid: "data" });
    console.error(`❌ [${kind}] ERROR: Invalid data was ACCEPTED!`);
    failed = true;
  } catch (_e) {
    console.log(`✅ [${kind}] Invalid data correctly rejected.`);
  }
}

if (failed) {
  console.error("\n❌ Config Matrix Validation FAILED.");
  process.exit(1);
} else {
  console.log(
    "\n✅ ALL bot_kind configurations are valid and schemas are working correctly.",
  );
  process.exit(0);
}
