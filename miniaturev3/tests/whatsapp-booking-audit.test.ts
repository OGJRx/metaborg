import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhatsAppBookingOrchestrator } from "../borg-core-worker/src/whatsapp-booking";
import { WhatsAppApiError } from "../shared/whatsapp/whatsapp-errors";

vi.mock("../shared/whatsapp/whatsapp-api");
vi.mock("../shared/services/booking-core");
vi.mock("../shared/services/slot-validator");

describe("WhatsApp Booking Audit #20", () => {
  let orchestrator: WhatsAppBookingOrchestrator;
  let mockEnv: any;
  let mockCtx: any;
  let mockApi: any;
  let mockCore: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({}),
      },
      WHATSAPP_API_VERSION: "v25.0",
    };
    mockCtx = {
      traceId: "test-trace",
      waitUntil: vi.fn(),
    };
    orchestrator = new WhatsAppBookingOrchestrator(mockEnv, mockCtx);
    mockApi = (orchestrator as any).api;
    mockApi.sendMessage.mockResolvedValue({});
    mockApi.sendInteractiveList.mockResolvedValue({});
    mockApi.sendInteractiveButtons.mockResolvedValue({});

    mockCore = (orchestrator as any).core;
  });

  describe("Pagination", () => {
    it("should paginate when more than 10 rows", async () => {
      const options = Array.from({ length: 22 }, (_, i) => ({
        label: `${i + 7}:00`,
        value: `${i + 7}:00`,
      }));
      mockCore.getSession.mockResolvedValue({
        paso_actual: 7,
        estado_flujo: "iniciado",
        platform: "whatsapp",
      });
      mockCore.renderStep.mockResolvedValue({
        status: "PROMPT",
        message: "Selecciona hora",
        options,
      });

      await orchestrator.handleMessage("584121234567", "reintentar");

      expect(mockApi.sendInteractiveList).toHaveBeenCalledWith(
        "584121234567",
        "Selecciona hora",
        "Ver Horarios",
        expect.arrayContaining([
          expect.objectContaining({
            rows: expect.arrayContaining([
              expect.objectContaining({ title: "▶️ Ver más..." }),
            ]),
          }),
        ]),
      );
      // Verify row count of first page: 8 items + 1 nav (Next)
      const call = mockApi.sendInteractiveList.mock.calls[0];
      expect(call[3][0].rows.length).toBeLessThanOrEqual(10);
    });

    it("should handle slots_page:2 navigation with SAFE row count", async () => {
      const options = Array.from({ length: 22 }, (_, i) => ({
        label: `${i + 7}:00`,
        value: `${i + 7}:00`,
      }));
      mockCore.getSession.mockResolvedValue({
        paso_actual: 7,
        estado_flujo: "iniciado",
        platform: "whatsapp",
        fecha_cita: "2026-06-01",
      });
      mockCore.renderStep.mockResolvedValue({
        status: "PROMPT",
        message: "Selecciona hora",
        options,
      });

      await orchestrator.handleInteractiveReply(
        "584121234567",
        "slots_page:2:set_hora",
      );

      expect(mockApi.sendInteractiveList).toHaveBeenCalledWith(
        "584121234567",
        "Selecciona hora",
        "Ver Horarios",
        expect.arrayContaining([
          expect.objectContaining({
            rows: expect.arrayContaining([
              expect.objectContaining({ title: "◀️ Volver al inicio" }),
              expect.objectContaining({ title: "▶️ Ver más..." }),
            ]),
          }),
        ]),
      );
      // Verify row count of middle page (Page 2): 8 items + 2 nav (Back, Next)
      const call = mockApi.sendInteractiveList.mock.calls[0];
      expect(call[3][0].rows.length).toBeLessThanOrEqual(10);
    });

    it("should handle generalized pagination for any step", async () => {
      const options = Array.from({ length: 15 }, (_, i) => ({
        label: `Service ${i}`,
        value: `S${i}`,
      }));
      mockCore.getSession.mockResolvedValue({
        paso_actual: 5,
        estado_flujo: "iniciado",
        platform: "whatsapp",
      });
      mockCore.renderStep.mockResolvedValue({
        status: "PROMPT",
        message: "Select service",
        options,
      });

      await orchestrator.handleMessage("584121234567", "reintentar");

      expect(mockApi.sendInteractiveList).toHaveBeenCalledWith(
        "584121234567",
        "Select service",
        "Ver Servicios",
        expect.arrayContaining([
          expect.objectContaining({
            rows: expect.arrayContaining([
              expect.objectContaining({ title: "▶️ Ver más..." }),
            ]),
          }),
        ]),
      );
    });
  });

  describe("Fallback", () => {
    it("should fallback to text if WhatsApp API throws 400 error", async () => {
      const options = [{ label: "07:00", value: "07:00" }];
      mockCore.getSession.mockResolvedValue({
        paso_actual: 7,
        estado_flujo: "iniciado",
        platform: "whatsapp",
      });
      mockCore.renderStep.mockResolvedValue({
        status: "PROMPT",
        message: "Selecciona hora",
        options,
      });

      mockApi.sendInteractiveList.mockRejectedValue(
        new WhatsAppApiError(400, "ROW_COUNT_EXCEEDED", "fb-trace", {}),
      );

      await orchestrator.handleMessage("584121234567", "reintentar");

      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        "584121234567",
        expect.stringContaining("1. 07:00"),
      );
      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO wa_api_errors"),
      );
      expect(mockCtx.waitUntil).toHaveBeenCalled();
    });
  });

  describe("Commands", () => {
    it("should handle 'reintentar' command", async () => {
      mockCore.getSession.mockResolvedValue({
        paso_actual: 7,
        estado_flujo: "iniciado",
        platform: "whatsapp",
      });
      mockCore.renderStep.mockResolvedValue({
        status: "PROMPT",
        message: "Test message",
        options: [{ label: "Opt", value: "Val" }],
      });

      await orchestrator.handleMessage("584121234567", "reintentar");

      expect(mockCore.renderStep).toHaveBeenCalled();
      expect(mockApi.sendInteractiveList).toHaveBeenCalled();
    });
  });

  describe("STEP_1 Guard", () => {
    it("should have 9 rows in STEP_1 now", async () => {
      const { WHATSAPP_RENDER_CONFIG } =
        await import("../shared/types/constants");
      const step1 = WHATSAPP_RENDER_CONFIG.STEP_1 as any;
      const totalRows = step1.sections.reduce(
        (acc: number, s: any) => acc + s.rows.length,
        0,
      );
      expect(totalRows).toBe(9);
    });
  });
});
