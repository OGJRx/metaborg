import { InlineKeyboard } from "grammy";
import type { z } from "zod";
import type { AgendadoConfigSchema, StepSchema } from "../schemas";
import type { FactoryContext } from "../types";

type AgendadoConfig = z.infer<typeof AgendadoConfigSchema>;
type Step = z.infer<typeof StepSchema>;

export interface RenderOptions {
  ctx: FactoryContext;
  config: AgendadoConfig;
  step?: Step;
  options: { label: string; value: string }[] | undefined;
  text: string;
}

export abstract class RenderAdapter {
  abstract renderPrompt(opts: RenderOptions): Promise<void>;
  abstract renderSummary(
    opts: RenderOptions & { data: Record<string, string> },
  ): Promise<void>;
  abstract renderConfirmation(
    opts: RenderOptions & { ticketId: string },
  ): Promise<void>;
  abstract renderImprovedConfirmation(
    opts: RenderOptions & {
      ticketId: string;
      fechaCita: string;
      horaCita: string;
      stepData: Record<string, string>;
    },
  ): Promise<void>;
  abstract renderCancellation(opts: RenderOptions): Promise<void>;
}

export class TelegramRenderAdapter extends RenderAdapter {
  async renderPrompt(opts: RenderOptions): Promise<void> {
    const keyboard = new InlineKeyboard();
    if (opts.options) {
      opts.options.forEach((opt, i) => {
        keyboard.text(opt.label, `step:${opts.step?.id}:${opt.value}`);
        if (i % 2 === 1) keyboard.row();
      });
    }

    await opts.ctx.reply(opts.text, {
      parse_mode: "HTML",
      ...(keyboard.inline_keyboard.length > 0
        ? { reply_markup: keyboard }
        : {}),
    });
  }

  async renderSummary(
    opts: RenderOptions & { data: Record<string, string> },
  ): Promise<void> {
    let summary = `${opts.config.business_identity.summary_header}\n\n`;
    opts.config.steps.forEach((step) => {
      const val = opts.data[step.id];
      if (val) {
        summary += `<b>${step.label}:</b> ${val}\n`;
      }
    });

    summary += opts.config.business_identity.confirm_prompt;

    const keyboard = new InlineKeyboard()
      .text(opts.config.business_identity.confirm_yes_label, "conf_yes")
      .text(opts.config.business_identity.confirm_no_label, "conf_no");

    await opts.ctx.reply(summary, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }

  async renderConfirmation(
    opts: RenderOptions & { ticketId: string },
  ): Promise<void> {
    const msg = opts.config.business_identity.confirm_message.replace(
      `${"${"}ticketId}`,
      opts.ticketId,
    );
    await opts.ctx.reply(msg, { parse_mode: "HTML" });

    if (opts.config.business_identity.location_maps_url) {
      const keyboard = new InlineKeyboard().url(
        "🌐 Ver en Google Maps",
        opts.config.business_identity.location_maps_url,
      );
      await opts.ctx.reply(
        opts.config.business_identity.protocol_message || "Te esperamos.",
        {
          parse_mode: "HTML",
          reply_markup: keyboard,
        },
      );
    }
  }

  async renderImprovedConfirmation(
    opts: RenderOptions & {
      ticketId: string;
      fechaCita: string;
      horaCita: string;
      stepData: Record<string, string>;
    },
  ): Promise<void> {
    const timezone = opts.config.office_hours.timezone || "America/Caracas";
    const nombre = opts.stepData.nombre || "Cliente";
    const servicio = opts.stepData.servicio || "Servicio seleccionado";
    const vehiculo =
      opts.stepData.vehiculo ||
      (opts.stepData.placa
        ? `${opts.stepData.marca || ""} ${opts.stepData.modelo || ""} (${opts.stepData.placa})`.trim()
        : null);

    let summary = "✅ <b>CITA CONFIRMADA</b>\n\n";
    summary += `🎫 <b>Ticket:</b> <code>${opts.ticketId}</code>\n`;
    summary += `👤 <b>Cliente:</b> ${nombre}\n`;
    summary += `🔧 <b>Servicio:</b> ${servicio}\n`;
    if (vehiculo) summary += `🚗 <b>Vehículo:</b> ${vehiculo}\n`;
    summary += `📅 <b>Fecha:</b> ${opts.fechaCita}\n`;
    summary += `⏰ <b>Hora:</b> ${opts.horaCita} (${timezone})\n`;
    if (opts.stepData.notas) {
      summary += `📝 <b>Notas:</b> ${opts.stepData.notas}\n`;
    }

    summary += `\n<i>${opts.config.business_identity.protocol_message || "Te esperamos."}</i>`;

    const keyboard = new InlineKeyboard();
    if (opts.config.business_identity.location_maps_url) {
      keyboard.url(
        "🌐 Ver en Google Maps",
        opts.config.business_identity.location_maps_url,
      );
    }

    await opts.ctx.reply(summary, {
      parse_mode: "HTML",
      ...(keyboard.inline_keyboard.length > 0
        ? { reply_markup: keyboard }
        : {}),
    });
  }

  async renderCancellation(opts: RenderOptions): Promise<void> {
    await opts.ctx.reply(opts.config.business_identity.cancel_message, {
      parse_mode: "HTML",
    });
  }
}

export class WhatsAppRenderAdapter extends RenderAdapter {
  async renderPrompt(opts: RenderOptions): Promise<void> {
    const cleanBody = opts.text
      .replace(/<b>/g, "*")
      .replace(/<\/b>/g, "*")
      .replace(/<br>/g, "\n");

    if (opts.options && opts.options.length > 0) {
      if (opts.options.length <= 3) {
        // Use buttons
        await opts.ctx.replyInteractiveButtons?.(
          cleanBody,
          opts.options.map((opt) => ({
            id: `step:${opts.step?.id}:${opt.value}`,
            title:
              opt.label.length > 20
                ? `${opt.label.substring(0, 17)}...`
                : opt.label,
          })),
        );
      } else {
        // Use list
        await opts.ctx.replyInteractiveList?.(cleanBody, "Seleccionar", [
          {
            title: opts.step?.label || "Opciones",
            rows: opts.options.map((opt) => ({
              id: `step:${opts.step?.id}:${opt.value}`,
              title:
                opt.label.length > 24
                  ? `${opt.label.substring(0, 21)}...`
                  : opt.label,
            })),
          },
        ]);
      }
      return;
    }

    await opts.ctx.reply(cleanBody);
  }

  async renderSummary(
    opts: RenderOptions & { data: Record<string, string> },
  ): Promise<void> {
    let summary = `*${opts.config.business_identity.summary_header.replace(/<[^>]*>/g, "")}*\n\n`;
    opts.config.steps.forEach((step) => {
      const val = opts.data[step.id];
      if (val) {
        summary += `*${step.label}:* ${val}\n`;
      }
    });
    const prompt = opts.config.business_identity.confirm_prompt.replace(
      /<[^>]*>/g,
      "",
    );

    await opts.ctx.replyInteractiveButtons?.(`${summary}\n${prompt}`, [
      {
        id: "conf_yes",
        title: opts.config.business_identity.confirm_yes_label.substring(0, 20),
      },
      {
        id: "conf_no",
        title: opts.config.business_identity.confirm_no_label.substring(0, 20),
      },
    ]);
  }

  async renderConfirmation(
    opts: RenderOptions & { ticketId: string },
  ): Promise<void> {
    const msg = opts.config.business_identity.confirm_message
      .replace(`${"${"}ticketId}`, opts.ticketId)
      .replace(/<[^>]*>/g, "");
    await opts.ctx.reply(`✅ ${msg}`);
    if (opts.config.business_identity.location_maps_url) {
      await opts.ctx.reply(
        `📍 Ubicación: ${opts.config.business_identity.location_maps_url}`,
      );
    }
  }

  async renderImprovedConfirmation(
    opts: RenderOptions & {
      ticketId: string;
      fechaCita: string;
      horaCita: string;
      stepData: Record<string, string>;
    },
  ): Promise<void> {
    const nombre = opts.stepData.nombre || "Cliente";
    const servicio = opts.stepData.servicio || "Servicio seleccionado";
    const msg =
      `✅ *CITA CONFIRMADA*\n\n` +
      `*Ticket:* ${opts.ticketId}\n` +
      `*Cliente:* ${nombre}\n` +
      `*Servicio:* ${servicio}\n` +
      `*Fecha:* ${opts.fechaCita}\n` +
      `*Hora:* ${opts.horaCita}\n\n` +
      `_Te esperamos._`;

    await opts.ctx.reply(msg);
    if (opts.config.business_identity.location_maps_url) {
      await opts.ctx.reply(
        `📍 Ubicación: ${opts.config.business_identity.location_maps_url}`,
      );
    }
  }

  async renderCancellation(opts: RenderOptions): Promise<void> {
    await opts.ctx.reply(
      `❌ ${opts.config.business_identity.cancel_message.replace(/<[^>]*>/g, "")}`,
    );
  }
}

export function getRenderAdapter(platform: string): RenderAdapter {
  return platform === "whatsapp"
    ? new WhatsAppRenderAdapter()
    : new TelegramRenderAdapter();
}
