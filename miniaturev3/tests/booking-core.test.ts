import { describe, it, expect, vi, beforeEach } from "vitest";
import { BookingCoreService } from "../shared/services/booking-core";
import { D1Database } from "@cloudflare/workers-types";

describe("BookingCoreService", () => {
  let dbMock: any;
  let service: BookingCoreService;

  beforeEach(() => {
    dbMock = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(),
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    service = new BookingCoreService(dbMock as unknown as D1Database);
  });

  it("getSession should filter by expires_at", async () => {
    dbMock.first.mockResolvedValueOnce(null); // No session found
    await service.getSession("user1", "chat1", "telegram");

    expect(dbMock.prepare).toHaveBeenCalledWith(
      expect.stringContaining(
        "AND (expires_at IS NULL OR expires_at > datetime('now'))",
      ),
    );
  });

  it("getSession should create a new session if not found", async () => {
    dbMock.first.mockResolvedValueOnce(null);
    const session = await service.getSession("user1", "chat1", "telegram");

    expect(session.telegram_user_id).toBe("user1");
    expect(dbMock.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO sessions"),
    );
  });

  it("handleAction set_fecha should use cached slots if provided", async () => {
    const session = await service.getSession("user1", "chat1", "telegram");
    session.paso_actual = 5;
    const _slots = [{ hora: "08:00", available: true }];
    const result = await service.handleAction(
      session,
      "set_fecha",
      "2099-10-12",
    );
    expect(result.step.options).toBeDefined();
    expect(result.newState.fecha_cita).toBe("2099-10-12");
  });

  it("handleAction conf_booking returns CONFIRMED and ticket_id on success", async () => {
    const session: any = {
      session_id: "S123",
      paso_actual: 8,
      telegram_user_id: "U123",
      platform: "whatsapp",
      vehiculo_tipo: "SUV",
      vehiculo_motor: "Gasolina",
      vehiculo_era: "2010-2020",
      kilometraje: 50000,
      servicio_solicitado: "Cambio de Aceite",
      fecha_cita: "2099-10-12",
      hora_cita: "10:00",
    };

    dbMock.run.mockResolvedValueOnce({ meta: { changes: 1 } }); // Session update
    dbMock.run.mockResolvedValueOnce({ meta: { changes: 1 } }); // Ticket creation in createTicketAtomic

    const result = await service.handleAction(session, "conf_booking", "yes");

    expect(result.step.status).toBe("CONFIRMED");
    expect(result.step.options).toBeDefined();
    expect(result.step.options![0]?.label).toBe("ticket_id");
    expect(result.step.options![0]?.value).toMatch(/^T-\d+/);
    expect(result.newState.estado_flujo).toBe("confirmado");
  });

  it("handleAction set_hora should block if capacity is reached", async () => {
    const session: any = {
      session_id: "S123",
      paso_actual: 7,
      fecha_cita: "2099-10-12",
    };

    // Mock tickets count = 6
    dbMock.first.mockResolvedValueOnce({ count: 6 });
    // Mock not blocked
    dbMock.first.mockResolvedValueOnce(null);

    const result = await service.handleAction(session, "set_hora", "08:00");

    expect(result.step.message).toContain("ya ha sido reservado");
    expect(result.newState.hora_cita).toBeUndefined();
  });
});
