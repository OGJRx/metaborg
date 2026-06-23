import { Api } from "grammy";
import { CoreEnv } from "../types";

export class TelegramApiFactory {
  static create(e: CoreEnv, t: "frontend" | "backend" = "frontend"): Api {
    return new Api(
      t === "frontend" ? e.FRONTEND_BOT_TOKEN : e.BACKEND_BOT_TOKEN,
    );
  }
}
