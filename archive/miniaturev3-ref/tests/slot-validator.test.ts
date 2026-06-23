import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlotValidator } from "../shared/services/slot-validator";

describe("SlotValidator", () => {
  let dbMock: any;

  beforeEach(() => {
    dbMock = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      all: vi.fn(),
    };
  });

  it("getAvailableSlots returns availability based on tickets and blocked slots", async () => {
    // Use a future date that is a workday (Monday 2099-10-12)
    const fecha = "2099-10-12";
    // Mock tickets
    dbMock.all.mockResolvedValueOnce({
      results: [
        { hora_cita: "08:00", count: 6 },
        { hora_cita: "11:00", count: 3 },
      ],
    });
    // Mock blocked slots
    dbMock.all.mockResolvedValueOnce({
      results: [{ hora: "10:00" }],
    });

    const validator = new SlotValidator(dbMock);
    const slots = await validator.getAvailableSlots(fecha);

    expect(slots.length).toBeGreaterThan(0);

    // 08:00 is full (6/6)
    const slot8 = slots.find((s) => s.hora === "08:00");
    expect(slot8?.available).toBe(false);

    // 09:00 is free
    const slot9 = slots.find((s) => s.hora === "09:00");
    if (slot9) {
      expect(slot9.available).toBe(true);
    }

    // 10:00 is blocked
    const slot10 = slots.find((s) => s.hora === "10:00");
    expect(slot10?.available).toBe(false);

    // 11:00 has 3/6 tickets
    const slot11 = slots.find((s) => s.hora === "11:00");
    expect(slot11?.available).toBe(true);
  });
});
