import { InlineKeyboard } from "grammy";
import type { z } from "zod";
import type { AgendadoConfigSchema, StepSchema } from "../schemas";
import type { FactoryContext } from "../types";

type AgendadoConfig = z.infer<typeof AgendadoConfigSchema>;

export async function handleAgendadoUpdate(
  ctx: FactoryContext,
  config: AgendadoConfig,
) {
  const session = ctx.session;

  if (!session.step_data) session.step_data = {};
  if (session.paso_actual === undefined) session.paso_actual = 0;

  const text = ctx.message?.text;
  const callbackData = ctx.callbackQuery?.data;

  // Handle help/cancel keywords
  if (text) {
    if (config.cancel_keywords.includes(text.toLowerCase())) {
      session.paso_actual = -1; // Cancelled state
      return await ctx.reply(config.business_identity.cancel_message);
    }
    if (config.help_keywords.includes(text.toLowerCase())) {
      session.paso_actual = 0;
      session.step_data = {};
    }
  }

  // Handle Start
  const firstStep = config.steps[0];
  if (
    ctx.hasCommand("start") ||
    (session.paso_actual === 0 &&
      !callbackData &&
      (!firstStep || !session.step_data[firstStep.id]))
  ) {
    session.paso_actual = 0;
    session.step_data = {};
    await ctx.reply(config.business_identity.welcome_message, {
      parse_mode: "HTML",
    });
    return await renderStep(ctx, config, 0);
  }

  if (session.paso_actual === -1) return; // Silent ignore if cancelled until start

  // Handle Confirmation Callbacks
  if (callbackData === "conf_yes") {
    const ticketId = `T-${ctx.botId.slice(0, 4)}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    await ctx.env.DB.prepare(
      "INSERT INTO factory_tickets (ticket_id, bot_id, session_id, platform, chat_id, step_data) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        ticketId,
        ctx.botId,
        `S-${ctx.chat?.id}-${Date.now()}`,
        "telegram",
        ctx.chat?.id.toString(),
        JSON.stringify(session.step_data),
      )
      .run();

    await ctx.env.DB.prepare(
      "UPDATE factory_sessions SET estado_flujo = 'confirmado' WHERE bot_id = ? AND chat_id = ? AND estado_flujo = 'activo'",
    )
      .bind(ctx.botId, ctx.chat?.id.toString())
      .run();

    const msg = config.business_identity.confirm_message.replace(
      "${ticketId}",
      ticketId,
    );
    return await ctx.reply(msg, { parse_mode: "HTML" });
  }

  if (callbackData === "conf_no") {
    await ctx.env.DB.prepare(
      "UPDATE factory_sessions SET estado_flujo = 'cancelado' WHERE bot_id = ? AND chat_id = ? AND estado_flujo = 'activo'",
    )
      .bind(ctx.botId, ctx.chat?.id.toString())
      .run();
    return await ctx.reply(config.business_identity.cancel_message);
  }

  // Handle Callback or Text Input
  const currentStep = config.steps[session.paso_actual];
  if (!currentStep) return;

  let value: string | undefined;
  if (callbackData?.startsWith("step:")) {
    const parts = callbackData.split(":");
    if (parts[1] === currentStep.id) {
      // Validate callback value against options if select/multi_select
      if (
        currentStep.type === "select" ||
        currentStep.type === "multi_select"
      ) {
        const optMatch = currentStep.options?.find((o) => o.value === parts[2]);
        if (optMatch) value = parts[2];
      } else {
        value = parts[2];
      }
    }
  } else if (text) {
    if (["text", "number"].includes(currentStep.type)) {
      value = text;
    }
  }

  if (value) {
    const isValid = validateInput(currentStep, value);
    if (!isValid) {
      return await ctx.reply(
        currentStep.error_message ||
          config.business_identity.invalid_input_message,
      );
    }

    session.step_data[currentStep.id] = value;
    session.paso_actual++;

    if (session.paso_actual >= config.steps.length) {
      return await renderSummary(ctx, config, session.step_data);
    } else {
      return await renderStep(ctx, config, session.paso_actual);
    }
  }
}

function validateInput(
  step: z.infer<typeof StepSchema>,
  value: string,
): boolean {
  if (step.type === "number") {
    const n = Number(value);
    if (Number.isNaN(n)) return false;
    if (step.validation?.min !== undefined && n < step.validation.min)
      return false;
    if (step.validation?.max !== undefined && n > step.validation.max)
      return false;
  }
  if (step.type === "text" && step.validation?.pattern) {
    const regex = new RegExp(step.validation.pattern);
    if (!regex.test(value)) return false;
  }
  return true;
}

async function renderStep(
  ctx: FactoryContext,
  config: AgendadoConfig,
  index: number,
) {
  const step = config.steps[index];
  if (!step) return;

  const keyboard = new InlineKeyboard();
  if (
    (step.type === "select" || step.type === "multi_select") &&
    step.options
  ) {
    step.options.forEach((opt, i) => {
      keyboard.text(opt.label, `step:${step.id}:${opt.value}`);
      if (i % 2 === 1) keyboard.row();
    });
  } else if (step.type === "date") {
    const today = new Date();
    const horizon = config.scheduling.booking_horizon_days;
    for (let i = 1; i <= horizon; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const iso = d.toISOString().split("T")[0];
      if (iso) {
        keyboard.text(iso, `step:${step.id}:${iso}`);
        if (i % 3 === 0) keyboard.row();
      }
    }
  } else if (step.type === "time") {
    const { open_hour, close_hour } = config.office_hours;
    for (let h = open_hour; h < close_hour; h++) {
      const time = `${h.toString().padStart(2, "0")}:00`;
      keyboard.text(time, `step:${step.id}:${time}`);
      if ((h - open_hour + 1) % 4 === 0) keyboard.row();
    }
  }

  const replyMarkup =
    keyboard.inline_keyboard.length > 0 ? keyboard : undefined;
  await ctx.reply(step.prompt, {
    parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function renderSummary(
  ctx: FactoryContext,
  config: AgendadoConfig,
  data: Record<string, string>,
) {
  let summary = `${config.business_identity.summary_header}\n\n`;
  config.steps.forEach((step) => {
    const val = data[step.id];
    summary += `<b>${step.label}:</b> ${val}\n`;
  });

  summary += config.business_identity.confirm_prompt;

  const keyboard = new InlineKeyboard()
    .text(config.business_identity.confirm_yes_label, "conf_yes")
    .text(config.business_identity.confirm_no_label, "conf_no");

  await ctx.reply(summary, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}
