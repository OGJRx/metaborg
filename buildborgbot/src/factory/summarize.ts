import { GoogleGenerativeAI } from "@google/generative-ai";

export async function summarizeConversation(
  db: D1Database,
  botId: string,
  chatId: string,
  env: { GEMINI_API_KEY: string; AI_MODEL_NAME: string },
  manualSummary?: string,
): Promise<string> {
  let summary = "";

  if (manualSummary) {
    summary = manualSummary;
  } else {
    const historyRows = await db
      .prepare(
        "SELECT role, content FROM factory_messages WHERE bot_id = ? AND chat_id = ? ORDER BY message_id ASC",
      )
      .bind(botId, chatId)
      .all<{ role: string; content: string }>();

    const fullText = (historyRows.results || [])
      .map(
        (r) => `${r.role === "model" ? "Asistente" : "Usuario"}: ${r.content}`,
      )
      .join("\n\n");

    const ai = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    const model = ai.getGenerativeModel({ model: env.AI_MODEL_NAME });
    const resultPromise = model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Resume la siguiente conversación en máximo 500 palabras, preservando datos críticos, decisiones tomadas y contexto relevante. Formato: texto plano.\n\nCONVERSACIÓN:\n${fullText}`,
            },
          ],
        },
      ],
    });
    const result = await resultPromise;
    summary = result.response.text() ?? "";
  }

  if (!summary) throw new Error("Failed to generate summary");

  await db.batch([
    db
      .prepare("DELETE FROM factory_messages WHERE bot_id = ? AND chat_id = ?")
      .bind(botId, chatId),
    db
      .prepare(
        "INSERT INTO factory_messages (bot_id, chat_id, message_id, role, content) VALUES (?, ?, 0, 'model', ?)",
      )
      .bind(botId, chatId, summary),
  ]);

  return summary;
}
