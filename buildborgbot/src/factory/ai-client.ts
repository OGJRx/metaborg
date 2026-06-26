import { GoogleGenAI } from "@google/genai/web";
import { reportFailure, reportSuccess } from "./resilience";

/**
 * Unified AI Client (Titanium Standard)
 * Uses the modern @google/genai SDK (v2.x) - Web build for Cloudflare Workers
 */

export interface AIContent {
  role: string;
  parts: { text: string }[];
}

export interface AIRequest {
  botId: string;
  apiKey: string;
  model: string;
  systemInstruction?: string;
  contents: AIContent[];
}

export interface AIResponse {
  text: string;
}

export async function generateAIResponse(
  db: D1Database,
  request: AIRequest,
): Promise<AIResponse> {
  const maxRetries = 2;
  const initialDelay = 1000;
  const factor = 2;
  const networkTimeout = 10000; // 10s timeout for Workers environment

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = initialDelay * factor ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const client = new GoogleGenAI({ apiKey: request.apiKey });

      // systemInstruction in v2 is passed in the config
      const config = request.systemInstruction
        ? {
            systemInstruction: {
              role: "system",
              parts: [{ text: request.systemInstruction }],
            },
          }
        : {};

      const modelPromise = client.models.generateContent({
        model: request.model,
        contents: request.contents,
        config: config as any,
      });

      const result = await Promise.race([
        modelPromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("AI_NETWORK_TIMEOUT")),
            networkTimeout,
          ),
        ),
      ]);

      // Accessing response text in @google/genai v2
      // Using result.value.text() helper if available, or direct access.
      const response = result.value;
      let text = "";
      try {
        text = response.text();
      } catch (e) {
        text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }

      if (!text) {
        console.error(
          JSON.stringify({
            tag: "AI_EMPTY_RESPONSE_DEBUG",
            botId: request.botId,
            responseKeys: Object.keys(response),
            hasCandidates: !!response.candidates,
          }),
        );
        throw new Error("EMPTY_AI_RESPONSE");
      }

      await reportSuccess(db, request.botId);
      return { text };
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      // Extract status code if available
      const statusCode = err.status || err.statusCode || 0;
      const errorMessage = error.message.toLowerCase();

      // Retryable errors: 429 (Rate Limit), 5xx (Server Error), Timeout, or specific demand errors
      const isRetryable =
        statusCode === 429 ||
        (statusCode >= 500 && statusCode <= 599) ||
        errorMessage.includes("timeout") ||
        errorMessage.includes("high demand") ||
        errorMessage.includes("503") ||
        errorMessage.includes("deadline exceeded");

      console.warn(
        JSON.stringify({
          tag: "AI_CLIENT_RETRY_CHECK",
          botId: request.botId,
          attempt,
          statusCode,
          isRetryable,
          error: errorMessage,
        }),
      );

      if (!isRetryable) {
        // Permanent error, don't retry
        throw error;
      }

      if (attempt === maxRetries) {
        // Last attempt failed, report to circuit breaker
        await reportFailure(db, request.botId);
      }
    }
  }

  throw lastError || new Error("UNKNOWN_AI_CLIENT_ERROR");
}
