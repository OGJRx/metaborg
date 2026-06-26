import { type CoreEnv, FACTORY_ENV_SYMBOL, type FactoryContext } from "./types";

export function assertEnv(
  ctx: FactoryContext,
): asserts ctx is FactoryContext & { env: NonNullable<FactoryContext["env"]> } {
  // 1. First priority: Always check the update object, where we inject the REAL env
  if (ctx.update) {
    const ext = ctx.update as unknown as {
      [FACTORY_ENV_SYMBOL]?: CoreEnv;
      botId?: string;
      host?: string;
      waitUntil?: (promise: Promise<unknown>) => void;
    };
    if (ext[FACTORY_ENV_SYMBOL]) {
      ctx.env = ext[FACTORY_ENV_SYMBOL];
      if (ext.botId) ctx.botId = ext.botId;
      if (ext.host) ctx.host = ext.host;
      if (ext.waitUntil) ctx.waitUntil = ext.waitUntil;
    }
  }

  // 2. Second priority: Session persisted (survives waitFor re-entries)
  if (ctx.session?._titaniumEnv && !ctx.env?.DB) {
    ctx.env = ctx.session._titaniumEnv;
  }
  if (ctx.session) {
    if (!ctx.botId && ctx.session._titaniumBotId)
      ctx.botId = ctx.session._titaniumBotId;
    if (!ctx.host && ctx.session._titaniumHost)
      ctx.host = ctx.session._titaniumHost;
  }

  // 3. Validation: The DB binding must be present AND functional
  if (!ctx.env?.DB) {
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
