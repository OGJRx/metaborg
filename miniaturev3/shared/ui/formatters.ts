export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const formatHourTo12 = (h24: string): string => {
  const parts = h24.split(":").map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

const DIA_SEMANA = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

const MES_ANIO = [
  "",
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

import { getVenezuelaTimeParts } from "./timezone";
import { SqliteDateTime } from "../types";

/**
 * Converts a Date object to a SQLite-compatible date-time string in UTC.
 * Format: YYYY-MM-DD HH:mm:ss
 */
export const toSqliteDateTime = (date: Date): SqliteDateTime => {
  return date.toISOString().replace("T", " ").split(".")[0] as SqliteDateTime;
};

export const formatDateFriendly = (d: Date): string => {
  const p = getVenezuelaTimeParts(d);
  return `${DIA_SEMANA[p.dayOfWeek ?? 0]} ${p.day} ${MES_ANIO[p.month]}`;
};

export const formatDateISO = (d: Date): string => {
  const p = getVenezuelaTimeParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};
