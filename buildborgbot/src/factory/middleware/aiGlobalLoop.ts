import type { NextFunction } from "grammy";
import { FormatterLoop } from "../formatter-loop";
import type { FactoryContext } from "../types";

export async function aiGlobalLoopMiddleware(
  ctx: FactoryContext,
  next: NextFunction,
) {
  // Detectar si el bot utiliza IA
  if (!ctx.message?.text || ctx.message.text.startsWith("/")) {
    return next();
  }

  const db = ctx.env.DB;
  const botId = ctx.botId;

  // Consultar bot_kind para decidir si aplicar el loop
  const botRow = await db
    .prepare("SELECT bot_kind FROM factory_bots WHERE bot_id = ?")
    .bind(botId)
    .first<{ bot_kind: string }>();

  if (
    botRow?.bot_kind !== "open_chat" &&
    botRow?.bot_kind !== "tool_specialist"
  ) {
    return next();
  }

  const chatId = ctx.chat?.id;
  if (!chatId) return next();

  const formatter = new FormatterLoop(db, chatId, botId, {
    apiKey: ctx.env.GEMINI_API_KEY,
    modelName: ctx.env.AI_MODEL_NAME || "gemini-3.1-flash-lite",
  });

  // El procesamiento se hace en background, pero llamamos a next()
  // por si hay otros handlers interesados (aunque el loop ya se encargará de responder)
  // O mejor: NO llamamos a next() si vamos a manejar la respuesta íntegramente aquí.
  // Pero para bots tipo "open_chat" el handler estándar de registry.ts
  // solo guarda el mensaje en D1 ahora, así que podemos llamar a next().

  ctx.waitUntil(formatter.execute(ctx, ctx.message.text));
  return next();
}
