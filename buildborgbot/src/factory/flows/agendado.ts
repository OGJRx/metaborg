import type { z } from "zod";
import type { AgendadoConfigSchema, StepSchema } from "../schemas";
import type { FactoryContext, TitaniumSession } from "../types";
import { getRenderAdapter, type RenderAdapter } from "./render-adapter";
import {
  createTicketAtomic,
  getNowInTZ,
  SlotValidator,
} from "./scheduling-logic";

type AgendadoConfig = z.infer<typeof AgendadoConfigSchema>;
type Step = z.infer<typeof StepSchema>;

export async function handleAgendadoUpdate(
  ctx: FactoryContext,
  config: AgendadoConfig,
) {
  const session = ctx.session;
  const adapter = getRenderAdapter(ctx.platform);

  if (!session.step_data) session.step_data = {};
  if (session.paso_actual === undefined) session.paso_actual = 0;

  const text = ctx.message?.text;
  const callbackData = ctx.callbackQuery?.data;

  // Keywords handling
  if (text) {
    const cleanText = text.toLowerCase().trim();
    if (config.cancel_keywords.includes(cleanText)) {
      session.paso_actual = -1;
      session.estado_flujo = "cancelado";
      return await adapter.renderCancellation({
        ctx,
        config,
        text: "",
        options: undefined,
      });
    }
    if (config.help_keywords.includes(cleanText)) {
      session.paso_actual = 0;
      session.step_data = {};
      session.estado_flujo = "iniciado";
    }
  }

  // Handle Start
  if (
    ctx.hasCommand("start") ||
    (session.paso_actual === 0 &&
      !callbackData &&
      Object.keys(session.step_data || {}).length === 0)
  ) {
    session.paso_actual = 0;
    session.step_data = {};
    session.estado_flujo = "iniciado";
    // We don't await welcome message here to avoid double send if renderStep also sends something
    // but the original logic had it.
    await ctx.reply(config.business_identity.welcome_message, {
      parse_mode: "HTML",
    });
    return await renderCurrentStep(ctx, config, session, adapter);
  }

  if (
    session.estado_flujo === "confirmado" ||
    session.estado_flujo === "cancelado"
  ) {
    if (ctx.hasCommand("start")) {
      session.paso_actual = 0;
      session.step_data = {};
      session.estado_flujo = "iniciado";
      return await renderCurrentStep(ctx, config, session, adapter);
    }
    return;
  }

  // Handle Callbacks
  if (callbackData) {
    if (callbackData === "conf_yes") {
      return await handleConfirmation(
        ctx,
        config,
        session,
        adapter,
        ctx.platform,
      );
    }
    if (callbackData === "conf_no") {
      session.estado_flujo = "cancelado";
      return await adapter.renderCancellation({
        ctx,
        config,
        text: "",
        options: undefined,
      });
    }
    if (callbackData.startsWith("step:")) {
      const parts = callbackData.split(":");
      const stepId = parts[1];
      const value = parts.slice(2).join(":");
      if (stepId === config.steps[session.paso_actual]?.id) {
        return await processStepInput(ctx, config, session, adapter, value);
      }
    }
  }

  // Handle Text/Numeric Input (including WhatsApp numeric selection)
  if (text) {
    const currentStep = config.steps[session.paso_actual];
    if (!currentStep) return;

    // Check for summary confirmation shortcuts (1 for Yes, 2 for No in WhatsApp)
    if ((session.paso_actual || 0) >= config.steps.length) {
      if (text.trim() === "1")
        return await handleConfirmation(
          ctx,
          config,
          session,
          adapter,
          ctx.platform,
        );
      if (text.trim() === "2") {
        session.estado_flujo = "cancelado";
        return await adapter.renderCancellation({
          ctx,
          config,
          text: "",
          options: undefined,
        });
      }
    }

    // Numeric selection for select/multi_select
    if (
      currentStep.type === "select" ||
      currentStep.type === "date" ||
      currentStep.type === "time"
    ) {
      const selection = parseInt(text.trim(), 10);
      if (!Number.isNaN(selection)) {
        const options = await getStepOptions(ctx, config, currentStep);
        if (options && selection > 0 && selection <= options.length) {
          const opt = options[selection - 1];
          if (opt)
            return await processStepInput(
              ctx,
              config,
              session,
              adapter,
              opt.value as string,
            );
        }
      }
    }

    // Normal text/number input
    return await processStepInput(ctx, config, session, adapter, text.trim());
  }
}

async function processStepInput(
  ctx: FactoryContext,
  config: AgendadoConfig,
  session: TitaniumSession,
  adapter: RenderAdapter,
  value: string,
) {
  const idx = session.paso_actual ?? 0;
  const currentStep = config.steps[idx];
  if (!currentStep) return;

  if (!validateInput(currentStep, value)) {
    return await ctx.reply(
      currentStep.error_message ||
        config.business_identity.invalid_input_message,
    );
  }

  if (!session.step_data) session.step_data = {};
  session.step_data[currentStep.id] = value;
  session.paso_actual = (session.paso_actual || 0) + 1;

  if ((session.paso_actual || 0) >= config.steps.length) {
    return await adapter.renderSummary({
      ctx,
      config,
      data: session.step_data || {},
      text: "",
      options: undefined,
    });
  } else {
    return await renderCurrentStep(ctx, config, session, adapter);
  }
}

async function handleConfirmation(
  ctx: FactoryContext,
  config: AgendadoConfig,
  session: TitaniumSession,
  adapter: RenderAdapter,
  platform: "telegram" | "whatsapp",
) {
  const dateStepId = config.appointment_mapping?.date_step_id;
  const timeStepId = config.appointment_mapping?.time_step_id;
  const fechaCita =
    dateStepId && session.step_data ? session.step_data[dateStepId] : null;
  const horaCita =
    timeStepId && session.step_data ? session.step_data[timeStepId] : null;

  const res = await createTicketAtomic(ctx.env.DB, {
    botId: ctx.botId,
    platform,
    chatId: ctx.chat?.id.toString() || "unknown",
    stepData: JSON.stringify(session.step_data || {}),
    fechaCita: fechaCita || "",
    horaCita: horaCita || "",
    capacity: config.scheduling.capacity_per_slot,
  });

  if (!res.success) {
    // Find the step index for date or time to go back
    if (timeStepId) {
      const idx = config.steps.findIndex((s) => s.id === timeStepId);
      if (idx !== -1) session.paso_actual = idx;
    }
    return await ctx.reply(
      "❌ Lo sentimos, el horario seleccionado ya no está disponible. Por favor elige otro.",
    );
  }

  session.estado_flujo = "confirmado";

  // Notify Admin (Simple implementation for now)
  try {
    const adminMsg = `🆕 <b>NUEVA CITA CONFIRMADA</b>\n\nBot: ${config.business_identity.name}\nTicket: <code>${res.ticketId}</code>\nPlataforma: ${platform}\nUsuario: ${ctx.chat?.id}\n\n<b>Detalles:</b>\n${Object.entries(
      session.step_data || {},
    )
      .map(([k, v]) => `• ${k}: ${v}`)
      .join("\n")}`;
    // In a real scenario, we'd lookup admin IDs from factory_platform_config
    console.log("Admin Notification:", adminMsg);
  } catch (e) {
    console.error("Failed to send admin notification:", e);
  }

  return await adapter.renderConfirmation({
    ctx,
    config,
    ticketId: res.ticketId || "ERR",
    text: "",
    options: undefined,
  });
}

async function renderCurrentStep(
  ctx: FactoryContext,
  config: AgendadoConfig,
  session: TitaniumSession,
  adapter: RenderAdapter,
) {
  const step = config.steps[session.paso_actual || 0];
  if (!step) return;

  const options = await getStepOptions(ctx, config, step);
  return await adapter.renderPrompt({
    ctx,
    config,
    step,
    options: options
      ? options.map((o) => ({ label: o.label || "", value: o.value || "" }))
      : undefined,
    text: step.prompt,
  });
}

async function getStepOptions(
  ctx: FactoryContext,
  config: AgendadoConfig,
  step: Step,
) {
  if (step.options) return step.options;

  if (step.type === "date") {
    const horizon = config.scheduling.booking_horizon_days;
    const options = [];
    const today = getNowInTZ(config.office_hours.timezone);
    const validator = new SlotValidator(ctx.env.DB);

    for (let i = 0; i <= horizon; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const iso = d.toISOString().split("T")[0];
      const dayOfWeek = d.getDay();

      if (config.office_hours.work_days[dayOfWeek]) {
        // Only include day if it has available slots
        const slots = await validator.getAvailableSlots(ctx.botId, iso, {
          capacity: config.scheduling.capacity_per_slot,
          duration: config.scheduling.slot_duration_minutes,
          openHour: config.office_hours.open_hour,
          closeHour: config.office_hours.close_hour,
          workDays: config.office_hours.work_days,
          bufferMinutes: config.scheduling.buffer_arrival_minutes,
          timezone: config.office_hours.timezone,
        });

        if (slots.some((s) => s.available)) {
          options.push({ label: iso, value: iso });
        }
      }
      if (options.length >= 10) break; // WhatsApp limit
    }
    return options;
  }

  if (step.type === "time") {
    const dateStepId = config.appointment_mapping?.date_step_id;
    const fecha = dateStepId ? ctx.session.step_data?.[dateStepId] : null;
    if (!fecha) return [];

    const validator = new SlotValidator(ctx.env.DB);
    const slots = await validator.getAvailableSlots(ctx.botId, fecha, {
      capacity: config.scheduling.capacity_per_slot,
      duration: config.scheduling.slot_duration_minutes,
      openHour: config.office_hours.open_hour,
      closeHour: config.office_hours.close_hour,
      workDays: config.office_hours.work_days,
      bufferMinutes: config.scheduling.buffer_arrival_minutes,
      timezone: config.office_hours.timezone,
    });

    return slots
      .filter((s) => s.available)
      .map((s) => ({ label: s.hora, value: s.hora }));
  }

  return undefined;
}

function validateInput(step: Step, value: string): boolean {
  if (step.type === "number") {
    const n = Number(value);
    if (Number.isNaN(n)) return false;
    if (step.validation?.min !== undefined && n < step.validation.min)
      return false;
    if (step.validation?.max !== undefined && n > step.validation.max)
      return false;
  }
  // Add more validations from step.validation if needed
  return true;
}
