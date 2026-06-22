import { AgendadoConfigSchema, StepSchema } from "../schemas";
import { FactoryContext, TitaniumSession } from "../types";
import { InlineKeyboard } from "grammy";
import { z } from "zod";

type AgendadoConfig = z.infer<typeof AgendadoConfigSchema>;

export async function handleAgendadoUpdate(
  ctx: FactoryContext,
  config: AgendadoConfig,
) {
  const session = ctx.session as TitaniumSession & {
    step_data?: Record<string, string>;
    paso_actual?: number;
  };

  if (!session.step_data) session.step_data = {};
  if (session.paso_actual === undefined) session.paso_actual = 0;

  const text = ctx.message?.text;
  const callbackData = ctx.callbackQuery?.data;

  // Handle help/cancel keywords
  if (text) {
    if (config.cancel_keywords.includes(text.toLowerCase())) {
      session.paso_actual = -1; // Cancelled state
      return await ctx.reply("❌ Operación cancelada.");
    }
    if (config.help_keywords.includes(text.toLowerCase())) {
      session.paso_actual = 0;
      session.step_data = {};
    }
  }

  // Handle Start
  if (ctx.hasCommand("start") || session.paso_actual === 0) {
    session.paso_actual = 0;
    session.step_data = {};
    await ctx.reply(config.business_identity.welcome_message, {
        parse_mode: "HTML"
    });
    return await renderStep(ctx, config, 0);
  }

  // Handle Confirmation Callbacks
  if (callbackData === "conf_yes") {
      // Atomic Ticket Creation
      const ticketId = `T-${Date.now()}-${ctx.chat?.id.toString().slice(-4)}`;
      await ctx.env.DB.prepare(
          "INSERT INTO factory_tickets (ticket_id, bot_id, session_id, platform, chat_id, step_data) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(
          ticketId,
          ctx.botId,
          "S-FIXME", // In a real app we'd get session_id from DB
          "telegram",
          ctx.chat?.id.toString(),
          JSON.stringify(session.step_data)
      ).run();

      await ctx.env.DB.prepare(
          "UPDATE factory_sessions SET estado_flujo = 'confirmado' WHERE bot_id = ? AND chat_id = ? AND estado_flujo = 'activo'"
      ).bind(ctx.botId, ctx.chat?.id.toString()).run();

      return await ctx.reply(`✅ <b>¡Cita confirmada!</b>\n\nTu ticket es: <code>${ticketId}</code>`, { parse_mode: "HTML" });
  }

  if (callbackData === "conf_no") {
      await ctx.env.DB.prepare(
        "UPDATE factory_sessions SET estado_flujo = 'cancelado' WHERE bot_id = ? AND chat_id = ? AND estado_flujo = 'activo'"
      ).bind(ctx.botId, ctx.chat?.id.toString()).run();
      return await ctx.reply("❌ Cita cancelada.");
  }

  // Handle Callback or Text Input
  const currentStep = config.steps[session.paso_actual];
  if (!currentStep) return;

  let value: string | undefined;
  if (callbackData && callbackData.startsWith("step:")) {
      const parts = callbackData.split(":");
      if (parts[1] === currentStep.id) {
          value = parts[2];
      }
  } else if (text && ["text", "number"].includes(currentStep.type)) {
      value = text;
  }

  if (value) {
      // Validate
      const isValid = validateInput(currentStep, value);
      if (!isValid) {
          return await ctx.reply(currentStep.error_message || "⚠️ Entrada no válida. Reintenta.");
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

function validateInput(step: z.infer<typeof StepSchema>, value: string): boolean {
    if (step.type === "number") {
        const n = Number(value);
        if (isNaN(n)) return false;
        if (step.validation?.min !== undefined && n < step.validation.min) return false;
        if (step.validation?.max !== undefined && n > step.validation.max) return false;
    }
    if (step.type === "text" && step.validation?.pattern) {
        const regex = new RegExp(step.validation.pattern);
        if (!regex.test(value)) return false;
    }
    return true;
}

async function renderStep(ctx: FactoryContext, config: AgendadoConfig, index: number) {
    const step = config.steps[index];
    if (!step) return;

    const keyboard = new InlineKeyboard();
    if (step.type === "select" && step.options) {
        step.options.forEach((opt, i) => {
            keyboard.text(opt.label, `step:${step.id}:${opt.value}`);
            if (i % 2 === 1) keyboard.row();
        });
    } else if (step.type === "date") {
        // Simple date picker simulation
        const today = new Date();
        for (let i = 1; i <= 5; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() + i);
            const iso = d.toISOString().split("T")[0];
            if (iso) {
                keyboard.text(iso, `step:${step.id}:${iso}`);
                keyboard.row();
            }
        }
    }

    await ctx.reply(step.prompt, {
        parse_mode: "HTML",
        reply_markup: keyboard.inline_keyboard.length > 0 ? keyboard : undefined
    });
}

async function renderSummary(ctx: FactoryContext, config: AgendadoConfig, data: Record<string, string>) {
    let summary = `<b>📋 RESUMEN DE CITA</b>\n\n`;
    config.steps.forEach(step => {
        const val = data[step.id];
        summary += `<b>${step.label}:</b> ${val}\n`;
    });

    summary += `\n¿Desea confirmar la cita?`;

    const keyboard = new InlineKeyboard()
        .text("✅ Confirmar", "conf_yes")
        .text("❌ Cancelar", "conf_no");

    await ctx.reply(summary, {
        parse_mode: "HTML",
        reply_markup: keyboard
    });
}
