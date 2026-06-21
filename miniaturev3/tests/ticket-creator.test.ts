import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TicketCreator,
  calculateEndTime,
} from "../shared/services/ticket-creator";
import { EphemeralState } from "../shared/types";

describe("TicketCreator", () => {
  let dbMock: any;

  beforeEach(() => {
    dbMock = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      run: vi.fn(),
    };
  });

  it("calculateEndTime correctly calculates end time", () => {
    expect(calculateEndTime("10:00", 60)).toBe("11:00");
    expect(calculateEndTime("23:30", 60)).toBe("00:30");
    expect(calculateEndTime("08:15", 45)).toBe("09:00");
  });

  it("createTicketAtomic returns success and ticket_id on successful insert", async () => {
    const session: EphemeralState = {
      session_id: "S123",
      telegram_user_id: "U123",
      telegram_chat_id: "C123",
      platform: "whatsapp",
      vehiculo_tipo: "SUV",
      vehiculo_motor: "Gasolina",
      vehiculo_era: "2010-2020",
      servicio_solicitado: "Cambio de Aceite",
      fecha_cita: "2024-10-10",
      hora_cita: "10:00",
      kilometraje: 50000,
      bot_type: "frontend",
      estado_flujo: "iniciado",
      paso_actual: 8,
      version: 1,
    };

    dbMock.run.mockResolvedValueOnce({ meta: { changes: 1 } });

    const creator = new TicketCreator(dbMock);
    const result = await creator.createTicketAtomic(session);

    expect(result.success).toBe(true);
    expect(result.ticket_id).toMatch(/^T-\d+$/);
    expect(dbMock.prepare).toHaveBeenCalled();
    expect(dbMock.bind).toHaveBeenCalled();
  });

  it("createTicketAtomic returns success false if no changes", async () => {
    const session: any = {
      session_id: "S123",
      telegram_user_id: "U123",
      platform: "whatsapp",
      servicio_solicitado: "Cambio de Aceite",
      fecha_cita: "2024-10-10",
      hora_cita: "10:00",
    };

    dbMock.run.mockResolvedValueOnce({ meta: { changes: 0 } });

    const creator = new TicketCreator(dbMock);
    const result = await creator.createTicketAtomic(session);

    expect(result.success).toBe(false);
  });

  it("createTicket throws error if slot occupied", async () => {
    const session: any = {
      session_id: "S123",
      telegram_user_id: "U123",
      platform: "whatsapp",
      servicio_solicitado: "Cambio de Aceite",
      fecha_cita: "2024-10-10",
      hora_cita: "10:00",
    };

    dbMock.run.mockResolvedValueOnce({ meta: { changes: 0 } });

    const creator = new TicketCreator(dbMock);
    await expect(creator.createTicket(session)).rejects.toThrow(
      "Slot already occupied",
    );
  });

  it("createTicket returns success and ticket_id", async () => {
    const session: any = {
      session_id: "S123",
      telegram_user_id: "U123",
      platform: "whatsapp",
      servicio_solicitado: "Cambio de Aceite",
      fecha_cita: "2024-10-10",
      hora_cita: "10:00",
    };

    dbMock.run.mockResolvedValueOnce({ meta: { changes: 1 } });

    const creator = new TicketCreator(dbMock);
    const result = await creator.createTicket(session);
    expect(result.success).toBe(true);
    expect(result.ticket_id).toBeDefined();
  });
});
