import { GoogleGenAI } from "@google/genai/web";
import { SKILL_FORMAT } from "./skill-format";

export interface StreamConfig {
  apiKey: string;
  modelName: string;
}

export async function* getGeminiStream(
  config: StreamConfig,
  userInput: string,
): AsyncGenerator<string, void, unknown> {
  const genAI = new GoogleGenAI({ apiKey: config.apiKey });

  // Respaldo dinámico a gemini-3.1-flash-lite si no viene configurado
  // En 2026 usamos lo más reciente, pero el SDK es v2
  const modelName = config.modelName || "gemini-3.1-flash-lite";
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SKILL_FORMAT,
  });

  const result = await model.generateContentStream(userInput);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      yield text;
    }
  }
}
