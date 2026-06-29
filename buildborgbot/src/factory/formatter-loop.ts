import { getGeminiStream, type StreamConfig } from "./ai-stream-client";
import type { FactoryContext } from "./types";

export class FormatterLoop {
  private clockEmojis = [
    "🕛",
    "🕐",
    "🕑",
    "🕒",
    "🕓",
    "🕔",
    "🕕",
    "🕖",
    "🕗",
    "🕘",
    "🕙",
    "🕚",
  ];

  constructor(
    private db: D1Database,
    private chatId: number,
    private botId: string,
    private config: StreamConfig,
  ) {}

  private balanceHtmlTags(input: string): string {
    const tagRegex = /<\/?([a-zA-Z0-9-]+)(?:\s+[^>]*)?>/g;
    const openTagsStack: string[] = [];
    let match: RegExpExecArray | null;

    const sanitized = input
      .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/g, "&amp;")
      .replace(
        /<(?![/]?(b|strong|i|em|u|s|strike|del|span|pre|code|a)\b)/gi,
        "&lt;",
      )
      .replace(
        /(?<!<(b|strong|i|em|u|s|strike|del|span|pre|code|a)\b[^>]*)>/gi,
        "&gt;",
      );

    // biome-ignore lint/suspicious/noAssignInExpressions: logic requires it
    while ((match = tagRegex.exec(sanitized)) !== null) {
      const fullTag = match[0];
      const tagName = match[1]?.toLowerCase() || "";
      const isClosing = fullTag.startsWith("</");

      if (!isClosing) {
        openTagsStack.push(tagName);
      } else {
        const lastOpen = openTagsStack.at(-1);
        if (lastOpen === tagName) {
          openTagsStack.pop();
        }
      }
    }

    let balanced = sanitized;
    while (openTagsStack.length > 0) {
      const tagToClose = openTagsStack.pop();
      balanced += `</${tagToClose}>`;
    }

    return balanced;
  }

  private async persistFragment(
    chunkIndex: number,
    text: string,
  ): Promise<void> {
    try {
      await this.db
        .prepare(
          "INSERT INTO factory_messages (bot_id, chat_id, role, content, chunk_index) VALUES (?, ?, 'assistant_fragment', ?, ?)",
        )
        .bind(this.botId, String(this.chatId), text, chunkIndex)
        .run();
    } catch (err) {
      console.error("[D1 Save] Fallo al guardar fragmento:", err);
    }
  }

  public async execute(ctx: FactoryContext, userInput: string): Promise<void> {
    const draftId = ctx.session.draftId || Math.floor(Math.random() * 1000000);
    ctx.session.draftId = draftId;

    let accumulatedText = "";
    let isFirstChunkReceived = false;
    let emojiIndex = 0;
    let chunkCounter = 0;

    let fallbackMode: "DRAFT" | "EDIT" | "CONSOLIDATED" = "DRAFT";
    let editMessageId: number | null = null;
    let lastDeliveredText = "";

    const deliverPayload = async (text: string, isFinal = false) => {
      const safeText = this.balanceHtmlTags(text);
      if (safeText === lastDeliveredText && !isFinal) return;

      if (fallbackMode === "DRAFT") {
        try {
          // Usar ctx.api.raw para asegurar compatibilidad si no está en grammY aún
          await ctx.api.raw.sendMessageDraft({
            chat_id: this.chatId,
            draft_id: draftId,
            text: safeText,
            parse_mode: "HTML",
          });
          if (isFinal) {
            await ctx.reply(safeText, { parse_mode: "HTML" });
          }
          lastDeliveredText = safeText;
          return;
        } catch (err) {
          console.warn(
            "[Loop Fallback] sendMessageDraft fallido. Escalando a EDIT.",
            String(err),
          );
          fallbackMode = "EDIT";
        }
      }

      if (fallbackMode === "EDIT") {
        try {
          if (editMessageId === null) {
            const sent = await ctx.reply(safeText, { parse_mode: "HTML" });
            editMessageId = sent.message_id;
          } else {
            await ctx.api.editMessageText(
              this.chatId,
              editMessageId,
              safeText,
              { parse_mode: "HTML" },
            );
          }
          lastDeliveredText = safeText;
          return;
        } catch (err) {
          console.warn(
            "[Loop Fallback] editMessageText falló. Escalando a CONSOLIDATED.",
            String(err),
          );
          fallbackMode = "CONSOLIDATED";
        }
      }

      if (isFinal && fallbackMode === "CONSOLIDATED") {
        await ctx.reply(safeText, { parse_mode: "HTML" }).catch(async () => {
          const plainText = text.replace(/<[^>]*>/g, "");
          await ctx.reply(plainText);
        });
      }
    };

    const animationInterval = setInterval(() => {
      if (isFirstChunkReceived) return;
      const emoji = this.clockEmojis[emojiIndex % this.clockEmojis.length];
      emojiIndex++;
      ctx.waitUntil(deliverPayload(`<i>Procesando... ${emoji}</i>`));
    }, 500); // 500ms for safer UI updates

    try {
      const stream = getGeminiStream(this.config, userInput);

      for await (const chunk of stream) {
        if (!isFirstChunkReceived) {
          isFirstChunkReceived = true;
          clearInterval(animationInterval);
        }

        accumulatedText += chunk;
        chunkCounter++;

        ctx.waitUntil(this.persistFragment(chunkCounter, chunk));
        // Debounce delivery
        if (chunkCounter % 5 === 0 || chunk.includes("\n")) {
          ctx.waitUntil(deliverPayload(accumulatedText));
        }
      }

      await deliverPayload(accumulatedText, true);
      delete ctx.session.draftId;
    } catch (error) {
      clearInterval(animationInterval);
      console.error("[Loop Error Fatal]", error);
      const cleanFallback =
        accumulatedText.replace(/<[^>]*>/g, "") ||
        "Error al procesar la respuesta.";
      await ctx.reply(cleanFallback).catch(() => {});
    } finally {
      clearInterval(animationInterval);
    }
  }
}
