import { getGeminiStream, type StreamConfig } from "./ai-stream-client";
import type { FactoryContext } from "./types";

export class FormatterLoop {
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

  public async execute(ctx: FactoryContext, userInput: string): Promise<void> {
    const draftId =
      ctx.session.draftId ||
      Number.parseInt(crypto.randomUUID().split("-")[0] ?? "0", 16);
    ctx.session.draftId = draftId;

    let accumulatedText = "";
    let isFirstChunkReceived = false;

    let fallbackMode: "DRAFT" | "EDIT" | "CONSOLIDATED" = "DRAFT";
    let editMessageId: number | null = null;
    let lastDeliveredText = "";
    let lastDeliveryTimestamp = 0;

    let pendingFlush: Promise<void> = Promise.resolve();

    const deliverPayload = async (text: string, isFinal = false) => {
      const safeText = this.balanceHtmlTags(text);
      if (safeText === lastDeliveredText && !isFinal) return;

      if (fallbackMode === "DRAFT") {
        try {
          // biome-ignore lint/suspicious/noExplicitAny: sendMessageDraft positional args & is_final
          await (ctx.api as any).sendMessageDraft(
            this.chatId,
            draftId,
            safeText,
            {
              parse_mode: "HTML",
              is_final: isFinal,
            },
          );

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
          // Fallback immediately to CONSOLIDATED delivery in same call
        }
      }

      if (fallbackMode === "CONSOLIDATED") {
        if (isFinal) {
          const sent = await ctx
            .reply(safeText, { parse_mode: "HTML" })
            .catch(async () => {
              const plainText = text.replace(/<[^>]*>/g, "");
              return await ctx.reply(plainText);
            });
          if (sent) editMessageId = sent.message_id;
        } else {
          // If we are in consolidated mode but not final, we might want to skip or just log
          // But to be safe and responsive, we can try to send a message if we don't have one yet
          if (editMessageId === null) {
            const sent = await ctx.reply(safeText, { parse_mode: "HTML" });
            editMessageId = sent.message_id;
          }
        }
        lastDeliveredText = safeText;
      }
    };

    // Initial feedback
    await deliverPayload("<i>Procesando... 🕛</i>");

    try {
      const stream = getGeminiStream(this.config, userInput);

      for await (const chunk of stream) {
        if (!isFirstChunkReceived) {
          isFirstChunkReceived = true;
        }

        accumulatedText += chunk;

        const now = Date.now();
        // Debounce delivery: 1500ms or newline
        if (now - lastDeliveryTimestamp > 1500 || chunk.includes("\n")) {
          lastDeliveryTimestamp = now;
          pendingFlush = pendingFlush.then(() =>
            deliverPayload(accumulatedText),
          );
          await pendingFlush;
        }
      }

      // Final delivery
      await deliverPayload(accumulatedText, true);

      // If we only used DRAFT mode, we need to send the final message as a real message
      // so it stays in the history and we get a message_id
      if (fallbackMode === "DRAFT") {
        const finalMsg = await ctx.reply(
          this.balanceHtmlTags(accumulatedText),
          {
            parse_mode: "HTML",
          },
        );
        editMessageId = finalMsg.message_id;
      }

      // Persist final message
      await this.db
        .prepare(
          "INSERT INTO factory_messages (bot_id, chat_id, message_id, role, content) VALUES (?, ?, ?, 'model', ?)",
        )
        .bind(
          this.botId,
          String(this.chatId),
          editMessageId ?? -1,
          accumulatedText,
        )
        .run()
        .catch((err) =>
          console.error("[D1 Save] Error saving final message:", err),
        );

      delete ctx.session.draftId;
    } catch (error) {
      console.error("[Loop Error Fatal]", error);
      const cleanFallback =
        accumulatedText.replace(/<[^>]*>/g, "") ||
        "Error al procesar la respuesta.";
      await ctx.reply(cleanFallback).catch(() => {});
    }
  }
}
