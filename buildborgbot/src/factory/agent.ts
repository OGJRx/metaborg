import { generateAIResponse } from "./ai-client";

/**
 * AI Agent Factory (Titanium Standard)
 */

export interface AgentRequest {
  botId: string;
  systemInstruction: string;
  contents: { role: string; parts: { text: string }[] }[];
  apiKey: string;
  modelName: string;
}

export interface AgentResponse {
  text: string;
}

/**
 * Runs the AI agent with 2 retries and exponential backoff.
 * Total wall time budget is respected.
 */
export async function runAgent(
  db: D1Database,
  request: AgentRequest,
): Promise<AgentResponse> {
  // Delegate to the unified AI client which already handles retries,
  // circuit breaker, and timeout.
  const response = await generateAIResponse(db, {
    botId: request.botId,
    apiKey: request.apiKey,
    model: request.modelName,
    systemInstruction: request.systemInstruction,
    contents: request.contents,
  });

  return { text: response.text };
}
