import { UiContext } from "../types";
import { smartSplitHtml } from "./html-utils";

export class UiManager {
  static async safeEditOrReply(
    ctx: UiContext,
    t: string,
    o: Record<string, unknown> & { plainText?: boolean } = {},
  ): Promise<void> {
    let finalMsg = t;
    if (!t || t.trim().length === 0) {
      if (ctx.logger) {
        ctx.logger.warn(
          "UI_MANAGER",
          "Empty message rejected, using fallback.",
        );
      }
      finalMsg = "⚠️ [TITANIUM-ERR]: El núcleo devolvió una respuesta vacía.";
    }

    const fragments = smartSplitHtml(finalMsg);
    if (fragments.length > 1 && ctx.logger) {
      ctx.logger.info(
        "UI_MANAGER",
        `Message split into ${fragments.length} parts (total: ${finalMsg.length} chars)`,
      );
    }

    const { plainText, ...options } = o;

    for (let i = 0; i < fragments.length; i++) {
      const fragment = fragments[i];
      if (!fragment) continue;

      const fragOptions: Record<string, unknown> = {
        ...options,
      };
      if (!plainText) {
        fragOptions["parse_mode"] = "HTML";
      }
      if (i > 0) delete fragOptions["reply_markup"];

      const callbackQuery = ctx.callbackQuery;

      if (i === 0 && callbackQuery?.message) {
        try {
          await ctx.editMessageText(fragment, fragOptions);
          continue;
        } catch (e: unknown) {
          if (ctx.logger) {
            ctx.logger.warn(
              "UI_MANAGER",
              `editMessageText failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }

      try {
        await ctx.reply(fragment, fragOptions);
      } catch (e: unknown) {
        if (ctx.logger) {
          ctx.logger.error(
            "UI_MANAGER",
            `reply failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }
  }

  static async safeReply(
    ctx: UiContext,
    t: string,
    o: Record<string, unknown> & { plainText?: boolean } = {},
  ): Promise<void> {
    let finalMsg = t;
    if (!t || t.trim().length === 0) {
      if (ctx.logger) {
        ctx.logger.warn(
          "UI_MANAGER",
          "Empty message rejected, using fallback.",
        );
      }
      finalMsg = "⚠️ [TITANIUM-ERR]: El núcleo devolvió una respuesta vacía.";
    }

    const fragments = smartSplitHtml(finalMsg);
    if (fragments.length > 1 && ctx.logger) {
      ctx.logger.info(
        "UI_MANAGER",
        `Message split into ${fragments.length} parts (total: ${finalMsg.length} chars)`,
      );
    }
    const { plainText, ...options } = o;

    for (let i = 0; i < fragments.length; i++) {
      const fragment = fragments[i];
      if (!fragment) continue;

      const fragOptions: Record<string, unknown> = {
        ...options,
      };
      if (!plainText) {
        fragOptions["parse_mode"] = "HTML";
      }
      if (i > 0) delete fragOptions["reply_markup"];

      try {
        await ctx.reply(fragment, fragOptions);
      } catch (e: unknown) {
        if (ctx.logger) {
          ctx.logger.error(
            "UI_MANAGER",
            `reply failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }
  }
}
