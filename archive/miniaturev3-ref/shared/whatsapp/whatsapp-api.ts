import { CoreEnv, CircuitService } from "../types";
import { BorgLogger } from "../services/borg-logger";
import { TitaniumCircuitBreaker } from "../services/circuit-breaker";
import { WhatsAppApiError } from "./whatsapp-errors";

/**
 * Best-effort global message counter for rate limiting.
 * WARNING: In Cloudflare Workers, these variables are per-isolate.
 * They do NOT provide a truly global rate limit across all concurrent requests.
 * Per-user limits enforced via D1 are the primary protection mechanism.
 */
let globalMessageCounter = 0;
let lastResetTime = Date.now();

export class WhatsAppApi {
  constructor(
    private env: CoreEnv,
    private logger?: BorgLogger,
  ) {}

  private async checkRateLimit(to: string): Promise<boolean> {
    const now = Date.now();
    // Global limit: 10 msg/sec
    if (now - lastResetTime > 1000) {
      globalMessageCounter = 0;
      lastResetTime = now;
    }
    if (globalMessageCounter >= 10) return false;
    globalMessageCounter++;

    // Per user limit: 15 msg/min
    const windowStart = Math.floor(now / 60000);
    const db = this.env.DB;
    try {
      const res = await db
        .prepare(
          "INSERT INTO rate_limits (identity_key, window_start, window_end, request_count) VALUES (?, ?, ?, 1) " +
            "ON CONFLICT(identity_key) DO UPDATE SET request_count = CASE WHEN window_end < ? THEN 1 ELSE request_count + 1 END, " +
            "window_end = CASE WHEN window_end < excluded.window_end THEN ? ELSE window_end END " +
            "RETURNING request_count, window_end",
        )
        .bind(to, windowStart, windowStart, windowStart, windowStart)
        .first<{ request_count: number }>();

      if (res && res.request_count > 15) return false;
    } catch (e) {
      this.logger?.error("whatsapp_api", `Rate limit DB error: ${e}`);
    }

    return true;
  }

  private async postToWhatsApp(
    body: unknown,
    actionName = "whatsapp_api",
  ): Promise<unknown> {
    const url = `https://graph.facebook.com/${this.env.WHATSAPP_API_VERSION}/${this.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      this.logger?.error(
        actionName,
        `Network error calling WhatsApp API: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }

    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      this.logger?.error(
        actionName,
        `WhatsApp API error (HTTP ${response.status}): ${JSON.stringify(data)}`,
      );

      const errorData = data as {
        error?: { message: string; code: string; fbtrace_id: string };
      };
      const fbtraceId = errorData?.error?.fbtrace_id;
      const errorCode = errorData?.error?.code;

      if (response.status >= 400 && response.status < 500) {
        throw new WhatsAppApiError(
          response.status,
          errorCode ? String(errorCode) : undefined,
          fbtraceId,
          data,
        );
      }

      await TitaniumCircuitBreaker.recordFailure(
        this.env,
        CircuitService.WHATSAPP,
        response.status,
      );
    } else {
      await TitaniumCircuitBreaker.recordSuccess(
        this.env,
        CircuitService.WHATSAPP,
      );
    }
    return data;
  }

  async sendMessage(to: string, text: string): Promise<unknown> {
    if (
      await TitaniumCircuitBreaker.shouldBlock(
        this.env,
        CircuitService.WHATSAPP,
      )
    ) {
      const errMsg = "WhatsApp circuit breaker is open";
      this.logger?.error("whatsapp_api", errMsg);
      throw new Error(errMsg);
    }

    if (!(await this.checkRateLimit(to))) {
      this.logger?.warn(
        "whatsapp_api",
        `Rate limit exceeded for ${to}. Counter: ${globalMessageCounter}`,
      );
      return { error: "Rate limit exceeded" };
    }

    return await this.postToWhatsApp(
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "text",
        text: { body: text },
      },
      "send_message",
    );
  }

  async sendInteractiveButtons(
    to: string,
    bodyText: string,
    buttons: { id: string; title: string }[],
  ): Promise<unknown> {
    if (
      await TitaniumCircuitBreaker.shouldBlock(
        this.env,
        CircuitService.WHATSAPP,
      )
    ) {
      throw new Error("WhatsApp circuit breaker is open");
    }

    if (!(await this.checkRateLimit(to)))
      return { error: "Rate limit exceeded" };

    return await this.postToWhatsApp(
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: {
            buttons: buttons.map((b) => ({
              type: "reply",
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      },
      "send_buttons",
    );
  }

  async sendInteractiveList(
    to: string,
    bodyText: string,
    buttonLabel: string,
    sections: {
      title: string;
      rows: { id: string; title: string; description?: string }[];
    }[],
  ): Promise<unknown> {
    if (
      await TitaniumCircuitBreaker.shouldBlock(
        this.env,
        CircuitService.WHATSAPP,
      )
    ) {
      throw new Error("WhatsApp circuit breaker is open");
    }

    if (!(await this.checkRateLimit(to)))
      return { error: "Rate limit exceeded" };

    return await this.postToWhatsApp(
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: bodyText },
          action: {
            button: buttonLabel,
            sections: sections.map((s) => ({
              title: s.title,
              rows: s.rows.map((r) => ({
                id: r.id,
                title: r.title,
                description: r.description,
              })),
            })),
          },
        },
      },
      "send_list",
    );
  }

  async markAsRead(messageId: string): Promise<void> {
    try {
      await this.postToWhatsApp(
        {
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
        },
        "mark_as_read",
      );
    } catch (e) {
      // markAsRead is usually backgrounded, just log it.
      this.logger?.error(
        "mark_as_read_fail",
        `Failed to mark ${messageId} as read: ${e}`,
      );
    }
  }
}
