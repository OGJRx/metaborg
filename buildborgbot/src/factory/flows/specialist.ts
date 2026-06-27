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
    // Extract codes using regex (P0xxx, B0xxx, C0xxx, U0xxx)
    const codeRegex = /[PBCU][0-9][0-9A-F]{3}/gi;
    const matches = text.match(codeRegex);

    if (matches && matches.length > 0) {
      const uniqueCodes = Array.from(
        new Set(matches.map((c) => c.toUpperCase())),
      );
      const dbResults = [];

      for (const code of uniqueCodes) {
        const res = await ctx.env.DB.prepare(
          "SELECT payload_json FROM factory_obd_codes WHERE code = ?",
        )
          .bind(code)
          .first<{ payload_json: string }>();

        if (res) dbResults.push(res.payload_json);
      }

      if (dbResults.length > 0) {
        prompt += `\n\nDATOS OBD DEL TALLER:\n${dbResults.join("\n")}`;
      }
    } else {
      // If no code is found, try a keyword search in descriptions
      const searchResults = await ctx.env.DB.prepare(
        "SELECT payload_json FROM factory_obd_codes WHERE description LIKE ? LIMIT 3",
      )
        .bind(`%${text}%`)
        .all<{ payload_json: string }>();

      if (searchResults.results && searchResults.results.length > 0) {
        prompt += `\n\nDATOS OBD RELACIONADOS:\n${searchResults.results.map((r) => r.payload_json).join("\n")}`;
      }
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
