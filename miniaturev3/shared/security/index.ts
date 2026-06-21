export * from "./crypto";
export * from "./bot-setup";
export * from "../services/telegram-api";

import { CoreEnv, BorgExecutionContext } from "../types";
import { timingSafeEqual, hmacSha256 } from "./crypto";

export type BorgMiddleware = (
  req: Request,
  env: CoreEnv,
  _ctx: BorgExecutionContext,
) => Promise<Response | null>;

export const webhookValidator: BorgMiddleware = async (request, env) => {
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!secret || !(await timingSafeEqual(secret, env.BORG_SECRET_KEY))) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
};

export const calendarAuthMiddleware: BorgMiddleware = async (request, env) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (token) {
    // Primary auth: Telegram admin user ID as token
    if (AdminAuthService.isAdmin(token, env)) {
      return null;
    }
    // Fallback: legacy BORG_SECRET_KEY (will be removed after transition)
    if (await timingSafeEqual(token, env.BORG_SECRET_KEY)) {
      console.warn(
        `[calendarAuth] Legacy BORG_SECRET_KEY token used. Migrate to admin ID token.`,
      );
      return null;
    } else {
      console.warn(
        `[calendarAuth] Token rejected. Must be a valid Telegram admin ID.`,
      );
    }
  }

  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => c.trim().split("=")),
    );
    const session = cookies["borg_session"];
    if (session) {
      const parts = session.split(".");
      const payload = parts[0];
      const sig = parts[1];

      if (parts.length !== 2 || !payload || !sig) {
        console.warn(`[calendarAuth] Invalid session format.`);
      } else {
        const expectedSig = (
          await hmacSha256(env.BORG_SECRET_KEY, payload)
        ).substring(0, 32);
        if (await timingSafeEqual(sig, expectedSig)) {
          const ts = parseInt(payload, 16);
          const now = Math.floor(Date.now() / 1000);
          if (now - ts < 86400) {
            return null;
          } else {
            console.warn(`[calendarAuth] Session expired.`);
          }
        } else {
          console.warn(
            `[calendarAuth] Session signature mismatch. Possible BORG_SECRET_KEY rotation.`,
          );
        }
      }
    }
  }

  return new Response("Unauthorized", { status: 401 });
};

import { z } from "zod";

const UpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({ from: z.object({ id: z.number() }).optional() })
    .optional(),
  edited_message: z
    .object({ from: z.object({ id: z.number() }).optional() })
    .optional(),
  callback_query: z
    .object({ from: z.object({ id: z.number() }).optional() })
    .optional(),
  inline_query: z
    .object({ from: z.object({ id: z.number() }).optional() })
    .optional(),
  chosen_inline_result: z
    .object({ from: z.object({ id: z.number() }).optional() })
    .optional(),
  my_chat_member: z
    .object({ from: z.object({ id: z.number() }).optional() })
    .optional(),
  chat_member: z
    .object({ from: z.object({ id: z.number() }).optional() })
    .optional(),
  chat_join_request: z
    .object({ from: z.object({ id: z.number() }).optional() })
    .optional(),
  message_reaction: z
    .object({ user: z.object({ id: z.number() }).optional() })
    .optional(),
});

function extractFromId(u: z.infer<typeof UpdateSchema>): number | undefined {
  const f =
    u.message?.from ??
    u.edited_message?.from ??
    u.callback_query?.from ??
    u.inline_query?.from;
  if (f) return f.id;
  const f2 =
    u.chosen_inline_result?.from ??
    u.my_chat_member?.from ??
    u.chat_member?.from;
  if (f2) return f2.id;
  return u.chat_join_request?.from?.id ?? u.message_reaction?.user?.id;
}

export class AdminAuthService {
  static parseAdminIds(e: CoreEnv): number[] {
    return (e.TELEGRAM_ADMIN_IDS || "")
      .split(",")
      .map((i: string) => parseInt(i))
      .filter((i: number) => !isNaN(i));
  }
  static isAdmin(u: string | number | undefined, e: CoreEnv): boolean {
    if (!u) return false;
    return this.parseAdminIds(e).includes(Number(u));
  }
}

export const adminAuthGuard: BorgMiddleware = async (request, env, ctx) => {
  if (request.method !== "POST") return null;
  const clonedRequest = request.clone();
  try {
    const json = await clonedRequest.json();
    const update = UpdateSchema.parse(json);
    if (update) {
      const fromId = extractFromId(update);
      if (fromId === undefined) return new Response("OK", { status: 200 });
      if (!AdminAuthService.isAdmin(fromId, env)) {
        if (update.my_chat_member) return new Response("OK", { status: 200 });

        console.warn(
          `[adminAuthGuard] Access denied for user ${fromId}. ` +
            `Trace: ${ctx.traceId}. Admin IDs configured: ${env.TELEGRAM_ADMIN_IDS}`,
        );
        return new Response("Forbidden", { status: 403 });
      }
    }
  } catch (e: unknown) {
    console.error(
      `[adminAuthGuard] Error parsing update: ${e instanceof Error ? e.message : String(e)}`,
    );
    return new Response("Bad Request", { status: 400 });
  }
  return null;
};

export const ActionMap: Record<string, string> = {
  reg_brand: "R",
  start_booking: "SB",
};
export const BORG_EPOCH = 1712620800;

export async function buildCallback(
  action: string,
  value: string,
  secret: string,
): Promise<string> {
  const ts = Math.floor((Date.now() / 1000 - BORG_EPOCH) / 60).toString(36);
  const short = ActionMap[action] || action;
  const base = `${short}:${value}:${ts}`;
  const sig = (await hmacSha256(secret, base)).substring(0, 16);
  return `${base}#${sig}`;
}

export async function parseCallback(
  data: string,
  secret: string,
): Promise<{
  action: string;
  value: string;
  expired: boolean;
  valid: boolean;
} | null> {
  if (!data.includes(":")) return null;
  const parts = data.split("#");
  const base = parts[0];
  const sig = parts[1];
  if (!base || !sig) return null;

  const bParts = base.split(":");
  const ts36 = bParts.pop();
  if (!ts36) return null;

  const short = bParts[0];
  if (!short) return null;

  const value = bParts.slice(1).join(":");
  let action = short;
  Object.entries(ActionMap).forEach(([k, v]) => {
    if (v === short) action = k;
  });

  const expected = (await hmacSha256(secret, base)).substring(0, 16);
  if (!(await timingSafeEqual(sig, expected))) {
    console.warn(
      `[parseCallback] HMAC mismatch for action=${action}. Possible key rotation.`,
    );
    return { action, value, expired: false, valid: false };
  }

  const ageMinutes =
    Math.floor((Date.now() / 1000 - BORG_EPOCH) / 60) - parseInt(ts36, 36);
  const expired = ageMinutes > 5;

  if (expired) {
    console.warn(
      `[parseCallback] Expired callback: action=${action}, age=${ageMinutes}min`,
    );
  }

  return {
    action,
    value,
    expired,
    valid: true,
  };
}
