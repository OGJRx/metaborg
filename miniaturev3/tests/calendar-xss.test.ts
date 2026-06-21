import { describe, it, expect } from "vitest";
import { CALENDAR_HTML } from "../borg-core-worker/src/calendar-template";

describe("Calendar Template XSS Protection", () => {
  it("contains the esc() sanitization function", () => {
    expect(CALENDAR_HTML).toContain("function esc(s) {");
    expect(CALENDAR_HTML).toContain("document.createElement('div')");
    expect(CALENDAR_HTML).toContain("textContent = String(s");
  });

  it("escapes date in dateBadge", () => {
    expect(CALENDAR_HTML).toContain("esc(date)");
  });

  it("escapes appt fields", () => {
    expect(CALENDAR_HTML).toContain("esc(a.hora_cita)");
    expect(CALENDAR_HTML).toContain("esc(a.vehiculo_tipo)");
    expect(CALENDAR_HTML).toContain("esc(a.servicio_solicitado)");
    expect(CALENDAR_HTML).toContain("esc(a.estado)");
    expect(CALENDAR_HTML).toContain("esc(a.ticket_id)");
  });

  it("escapes error message", () => {
    expect(CALENDAR_HTML).toContain("esc(err.message)");
  });

  it("does not use unescaped appt data in innerHTML", () => {
    expect(CALENDAR_HTML).not.toMatch(/\+ a\.hora_cita \+/);
    expect(CALENDAR_HTML).not.toMatch(/\+ a\.vehiculo_tipo \+/);
    expect(CALENDAR_HTML).not.toMatch(/\+ a\.servicio_solicitado \+/);
    expect(CALENDAR_HTML).not.toMatch(/status-' \+ a\.estado \+/);
    expect(CALENDAR_HTML).not.toMatch(/\+ a\.ticket_id \+/);
  });

  it("uses server-side data embedding placeholder", () => {
    expect(CALENDAR_HTML).toContain("__APPOINTMENTS_DATA__");
    expect(CALENDAR_HTML).toContain("let currentData = __APPOINTMENTS_DATA__");
  });

  it("avoids template literal escape traps", () => {
    // The original code had join('\n') inside a TS template literal,
    // which became a literal newline — killing the entire script block.
    // Verify no raw \n inside single quotes (except in CSS which is fine).
    const scriptMatch = CALENDAR_HTML.match(
      /<script nonce="__NONCE__">([\s\S]*)<\/script>/,
    );
    if (scriptMatch) {
      const script = scriptMatch[1];
      // No template literal backticks in client-side JS
      expect(script).not.toContain("`");
      // No raw \n inside string joins
      expect(script).not.toMatch(/join\('\\n'\)/);
      expect(script).toContain("String.fromCharCode(10)");
    }
  });
});
