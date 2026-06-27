import { getUpdateEnv } from "./engine";
import type { FactoryContext } from "./types";

export function assertEnv(
  ctx: FactoryContext,
): asserts ctx is FactoryContext & { env: NonNullable<FactoryContext["env"]> } {
  // 1. First priority: Always check the WeakMap via engine helper
  const updateEnv = getUpdateEnv(ctx.update);
  if (updateEnv) {
    ctx.env = updateEnv;
  }

  // 2. Second priority: Context property (might be already set by middleware)
  if (ctx.session) {
    if (!ctx.botId && ctx.session._titaniumBotId)
      ctx.botId = ctx.session._titaniumBotId;
    if (!ctx.host && ctx.session._titaniumHost)
      ctx.host = ctx.session._titaniumHost;
  }

  // 3. Validation: The DB binding must be present AND functional
  if (!ctx.env?.DB) {
    console.error(
      JSON.stringify({
        level: "error",
        tag: "ENV_ASSERTION_FAILED",
        botId: ctx.botId ?? "unknown",
        hasUpdate: !!ctx.update,
        hasSession: !!ctx.session,
        timestamp: new Date().toISOString(),
      }),
    );
    throw new Error(
      `[TITANIUM] Context lost 'env' property (botId: ${ctx.botId ?? "unknown"}).`,
    );
  }

  if (typeof ctx.env.DB.prepare !== "function") {
    throw new Error(
      `[TITANIUM] DB binding is corrupted (not a D1Database). Possible session serialization leak. (botId: ${ctx.botId ?? "unknown"}).`,
    );
  }
}
