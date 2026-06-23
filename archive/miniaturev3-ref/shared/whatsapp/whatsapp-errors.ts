export class WhatsAppApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly errorCode: string | undefined,
    public readonly fbtraceId: string | undefined,
    public readonly responseBody: unknown,
  ) {
    super(`WhatsApp API error ${httpStatus}: ${errorCode || "unknown"}`);
    this.name = "WhatsAppApiError";
  }
}

export type WhatsAppApiErrorAlert = {
  phone: string;
  step: number;
  errorCode: string;
  fbtraceId?: string | undefined;
};
