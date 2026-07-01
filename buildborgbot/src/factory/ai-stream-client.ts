import { GoogleGenAI } from "@google/genai/web";
import { SKILL_FORMAT } from "./skill-format";

export interface StreamConfig {
  apiKey: string;
  modelName: string;
  systemInstruction?: string;
}

export async function* getGeminiStream(
  config: StreamConfig,
  userInput: string,
): AsyncGenerator<string, void, unknown> {
  const client = new GoogleGenAI({ apiKey: config.apiKey });

  // Respaldo dinámico a gemini-3.1-flash-lite si no viene configurado
  const modelName = config.modelName || "gemini-3.1-flash-lite";

  const responseStream = await client.models.generateContentStream({
    model: modelName,
    contents: [
      {
        role: "user",
        parts: [{ text: userInput }],
      },
    ],
    config: {
      systemInstruction: {
        role: "system",
        parts: [{ text: config.systemInstruction || SKILL_FORMAT }],
      },
    },
  });

  for await (const chunk of responseStream) {
    // Accessing response text in @google/genai v2
    const text =
      chunk.text || chunk.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (text) {
      yield text;
    }
  }
}
