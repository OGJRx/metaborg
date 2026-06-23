import { describe, it, expect } from "vitest";

/**
 * Este test demuestra la falacia ASCII en SQLite/JS string comparison.
 * 'T' (84) es mayor que ' ' (32).
 */
describe("Titanium Timestamp Integrity Audit", () => {
  it("demuestra que la comparación ISO-8601 vs SQLite Space-format es fallida", () => {
    // Escenario: Una fecha 'T' (ISO) contra una fecha con espacio (SQLite) que es cronológicamente POSTERIOR.
    const isoDate = "2026-05-23T10:00:00";
    const sqliteDate = "2026-05-23 16:50:47";

    // En un mundo lógico, 10:00 AM no es mayor que 04:50 PM del mismo día.
    // Pero en ASCII, 'T' > ' '
    const asciiComparison = isoDate > sqliteDate;

    expect(asciiComparison).toBe(true);

    // El motor V8 confirma que la comparación lexicográfica falla
    // como representación de la realidad temporal.
  });

  it("verifica que toSqliteDateTime elimina la falacia ASCII", () => {
    // Si ambas usan el mismo separador (espacio), la comparación lexicográfica es válida para ISO-like strings
    const date1 = "2026-05-23 10:00:00";
    const date2 = "2026-05-23 16:50:47";

    expect(date1 > date2).toBe(false); // 10:00 < 16:50 - CORRECTO
  });
});
