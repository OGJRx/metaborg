import { generateAIResponse } from "../ai-client";
import type { FactoryContext } from "../types";

export async function handleToolSpecialistUpdate(
  ctx: FactoryContext,
  config: { system_prompt: string; lookup_source: string },
) {
  const text = ctx.message?.text;
  if (!text) return;

  let prompt = config.system_prompt;

  if (config.lookup_source === "obd_db") {
    const results = await ctx.env.DB.prepare(
      "SELECT payload_json FROM factory_lookup_data WHERE bot_id = ? AND kind = 'obd' AND key = ?",
    )
      .bind(ctx.botId, text.toUpperCase())
      .first<{ payload_json: string }>();

    if (results) {
      prompt += `\n\nDATOS OBD DEL TALLER:\n${results.payload_json}`;
    }
  }

  try {
    const result = await generateAIResponse(ctx.env.DB, {
      botId: ctx.botId,
      apiKey: ctx.env.GEMINI_API_KEY,
      model: ctx.env.AI_MODEL_NAME || "gemini-1.5-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, { text: `USUARIO: ${text}` }],
        },
      ],
    });

    await ctx.reply(result.text);
  } catch (e) {
    console.error("AI Error:", e);
    await ctx.reply("⚠️ Error procesando con IA.");
  }
}
