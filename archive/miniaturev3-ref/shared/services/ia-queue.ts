import { D1Database } from "@cloudflare/workers-types";
import { BorgExecutionContext, CoreEnv } from "../types";
import { TelegramApiFactory } from "../security";
import { AgentFactory } from "./agent-factory";
import { BorgLogger } from "./borg-logger";
import { smartSplitHtml } from "../ui/html-utils";
import { AGENT_PROMPTS } from "../ui/prompts";

export class IaQueueService {
  static async processPendingJobs(
    db: D1Database,
    exec: BorgExecutionContext,
    env: CoreEnv,
  ) {
    const jobs = await db
      .prepare(
        "SELECT job_id, prompt, telegram_user_id, telegram_chat_id, message_id, trace_id FROM ia_jobs WHERE status = 'PENDING'",
      )
      .all<{
        job_id: string;
        prompt: string;
        telegram_user_id: number;
        telegram_chat_id: number;
        message_id: number;
        trace_id: string;
      }>();

    const api = TelegramApiFactory.create(env, "backend");

    for (const job of jobs.results) {
      const logger = new BorgLogger("IA_QUEUE", db, job.trace_id, exec);
      try {
        const response = await AgentFactory.runAgent(
          "IA_QUEUE",
          AGENT_PROMPTS.CEREBRO_ADMINISTRATIVO,
          job.prompt,
          [],
          env,
          {},
          job.trace_id,
          logger,
        );

        if (response.success) {
          await db
            .prepare(
              "UPDATE ia_jobs SET status = 'COMPLETED', result = ?, updated_at = CURRENT_TIMESTAMP WHERE job_id = ?",
            )
            .bind(response.text, job.job_id)
            .run();

          const fragments = smartSplitHtml(response.text);
          for (const fragment of fragments) {
            await api.sendMessage(job.telegram_chat_id, fragment, {
              reply_to_message_id: job.message_id,
            });
          }
        } else {
          throw new Error(response.error);
        }
      } catch (e: unknown) {
        const error = e instanceof Error ? e.message : String(e);
        await db
          .prepare(
            "UPDATE ia_jobs SET status = 'FAILED', error = ?, updated_at = CURRENT_TIMESTAMP WHERE job_id = ?",
          )
          .bind(error, job.job_id)
          .run();
      }
    }
  }
}
