import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { CoreEnv, AiConversationItem, CircuitService } from "../types";
import { BorgLogger } from "./borg-logger";
import { TitaniumCircuitBreaker } from "./circuit-breaker";

export class AgentFactory {
  private static extractStatusCode(e: unknown): number {
    const errorWithStatus = z.object({ status: z.number() }).safeParse(e);
    if (errorWithStatus.success) return errorWithStatus.data.status;
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("429")) return 429;
    if (msg.includes("503")) return 503;
    return 500;
  }

  private static async executeGeminiCall(
    ai: GoogleGenAI,
    env: CoreEnv,
    name: string,
    systemPrompt: string,
    userPrompt: string,
    history: AiConversationItem[],
    options: {
      enableSearch?: boolean;
      temperature?: number;
      thinkingBudget?: number;
    },
    attempt: number,
    traceId?: string,
    logger?: BorgLogger,
  ): Promise<string> {
    const tools: { googleSearch: Record<string, never> }[] = [];
    if (options.enableSearch) tools.push({ googleSearch: {} });
    if (logger) {
      logger.info(
        "gemini_request",
        `Calling Gemini API (${env.AI_MODEL_NAME}) for ${name} [Attempt ${attempt + 1}]`,
      );
    } else {
      console.info(
        `[${traceId}] [AgentFactory:${name}] PRE-CALL: ${env.AI_MODEL_NAME} (Attempt ${attempt + 1})`,
      );
    }
    const result = await ai.models.generateContent({
      model: env.AI_MODEL_NAME,
      contents: [
        ...history.map((h) => ({
          role: h.role === "user" ? ("user" as const) : ("model" as const),
          parts: h.parts,
        })),
        { role: "user", parts: [{ text: userPrompt }] },
      ],
      config: {
        systemInstruction: systemPrompt,
        ...(tools.length > 0 ? { tools } : {}),
        temperature: options.temperature ?? 0.65,
        thinkingConfig: {
          includeThoughts: (options.thinkingBudget ?? 0) > 0,
          thinkingBudget: options.thinkingBudget ?? 0,
        },
      },
    });
    return result.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  static async runAgent(
    name: string,
    systemPrompt: string,
    userPrompt: string,
    history: AiConversationItem[],
    env: CoreEnv,
    options: {
      temperature?: number;
      enableSearch?: boolean;
      thinkingBudget?: number;
    } = {},
    traceId?: string,
    logger?: BorgLogger,
  ): Promise<{
    success: boolean;
    text: string;
    error?: string;
    code?: number;
  }> {
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = nowSec - 60;
    const identityKey = `agent_rl:${name}`;

    try {
      const res = await env.DB.prepare(
        "INSERT INTO rate_limits (identity_key, request_count, window_start, window_end) " +
          "VALUES (?, 1, ?, ?) " +
          "ON CONFLICT(identity_key) DO UPDATE SET " +
          "request_count = CASE WHEN window_start < ? THEN 1 ELSE request_count + 1 END, " +
          "window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END, " +
          "window_end = ? " +
          "RETURNING request_count",
      )
        .bind(
          identityKey,
          nowSec,
          nowSec + 60,
          windowStart,
          windowStart,
          nowSec,
          nowSec + 60,
        )
        .first<{ request_count: number }>();

      if ((res?.request_count || 0) > 15) {
        if (logger)
          logger.warn("agent_rate_limit", `Rate limit exceeded for ${name}`);
        return {
          success: false,
          text: "",
          error: "Rate limit exceeded (15 req/min)",
          code: 429,
        };
      }
    } catch (_e) {
      if (logger) {
        logger.warn(
          "rate_limit_fallback",
          `D1 rate limit failed for ${name}, allowing request`,
        );
      }
    }

    if (await TitaniumCircuitBreaker.shouldBlock(env, CircuitService.GEMINI)) {
      return {
        success: false,
        text: "",
        error: "Circuit breaker is OPEN for Gemini",
        code: 503,
      };
    }

    const MAX_RETRIES = 3;
    const BASE_DELAY = 2000;
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const startTime = Date.now();
      try {
        const text = await this.executeGeminiCall(
          ai,
          env,
          name,
          systemPrompt,
          userPrompt,
          history,
          options,
          attempt,
          traceId,
          logger,
        );
        const latency = Date.now() - startTime;
        await TitaniumCircuitBreaker.recordSuccess(env, CircuitService.GEMINI);

        if (logger) {
          logger.success(
            "gemini_response",
            `AI response received for ${name} in ${latency}ms`,
          );
        } else {
          console.log(
            `[${traceId}] [AgentFactory:${name}] POST-CALL: Success in ${latency}ms`,
          );
        }
        return { success: true, text };
      } catch (e: unknown) {
        const code = this.extractStatusCode(e);
        const error = e instanceof Error ? e.message : String(e);
        const latency = Date.now() - startTime;

        if (code === 429 && attempt < MAX_RETRIES - 1) {
          const delay = BASE_DELAY * 2 ** attempt + Math.random() * 1000;
          if (logger) {
            logger.warn(
              "gemini_retry",
              `429 received for ${name}. Retry ${attempt + 1} in ${Math.round(delay)}ms (latency: ${latency}ms)`,
            );
          } else {
            console.warn(
              `[${traceId}] [AgentFactory:${name}] 429. Retry ${attempt + 1} in ${Math.round(delay)}ms`,
            );
          }
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        await TitaniumCircuitBreaker.recordFailure(
          env,
          CircuitService.GEMINI,
          code,
        );

        if (logger) {
          logger.error(
            "gemini_fetch_error",
            `Error in AgentFactory:${name} after ${latency}ms: ${error}`,
          );
        } else {
          console.error(`[AgentFactory:${name}] Error:`, e);
        }
        return {
          success: false,
          text: "",
          error,
          code,
        };
      }
    }

    return {
      success: false,
      text: "",
      error: "Max retries exceeded",
      code: 429,
    };
  }
}
