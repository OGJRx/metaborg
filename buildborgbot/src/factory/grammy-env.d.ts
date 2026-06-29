declare module "grammy" {
  interface Api {
    /**
     * Envía o actualiza un borrador transaccional en el chat de Telegram.
     * Estándar de la Bot API 10.1+.
     */
    sendMessageDraft(params: {
      chat_id: number | string;
      draft_id: number;
      text: string;
      parse_mode?: "HTML" | "MarkdownV2";
    }): Promise<{ message_id: number; ok: boolean }>;
  }
}
