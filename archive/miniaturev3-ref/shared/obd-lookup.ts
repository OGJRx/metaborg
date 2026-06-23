import { D1Database } from "@cloudflare/workers-types";

export interface ObdResult {
  id: number;
  code: string;
  description: string;
  category: string;
  subcategory: string | null;
  severity: string;
}

export class ObdLookupService {
  static async searchByCode(
    db: D1Database,
    code: string,
  ): Promise<ObdResult | null> {
    return await db
      .prepare(
        "SELECT id, code, description, category, subcategory, severity FROM obd_codes WHERE code = ? LIMIT 1",
      )
      .bind(code.toUpperCase().trim())
      .first<ObdResult>();
  }

  static sanitizeFtsQuery(query: string): string {
    return query
      .replace(/["*()\-:]/g, " ")
      .replace(/\b(AND|OR|NOT|NEAR)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((w) => w.length > 0)
      .map((w) => `"${w}"`)
      .join(" ");
  }

  static async searchByDescription(
    db: D1Database,
    query: string,
  ): Promise<ObdResult[]> {
    if (!query || query.length < 3) return [];

    const sanitized = this.sanitizeFtsQuery(query);
    if (!sanitized) return [];

    const results = await db
      .prepare(
        "SELECT o.id, o.code, o.description, o.category, o.subcategory, o.severity FROM obd_codes o JOIN obd_codes_fts f ON o.id = f.rowid WHERE obd_codes_fts MATCH ? ORDER BY rank LIMIT 5",
      )
      .bind(sanitized)
      .all<ObdResult>();

    return results.results || [];
  }

  static async searchMultipleCodes(
    db: D1Database,
    codes: string[],
  ): Promise<ObdResult[]> {
    if (codes.length === 0) return [];
    const uniqueCodes = [...new Set(codes.map((c) => c.toUpperCase().trim()))];
    const placeholders = uniqueCodes.map(() => "?").join(",");
    const results = await db
      .prepare(
        `SELECT id, code, description, category, subcategory, severity FROM obd_codes WHERE code IN (${placeholders})`,
      )
      .bind(...uniqueCodes)
      .all<ObdResult>();
    return results.results || [];
  }

  static extractCodes(text: string): string[] {
    const pattern = /\b([PBUC][0-9][0-9A-F]{3})\b/gi;
    const matches = text.match(pattern);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.toUpperCase()))];
  }

  static async getEnrichmentResults(
    db: D1Database,
    text: string,
  ): Promise<ObdResult[]> {
    const extractedCodes = this.extractCodes(text);
    if (extractedCodes.length > 0) {
      const results = await this.searchMultipleCodes(db, extractedCodes);
      if (results.length > 0) return results;
    }
    if (text.length > 5) return await this.searchByDescription(db, text);
    return [];
  }

  static enrichPrompt(basePrompt: string, results: ObdResult[]): string {
    if (results.length === 0) return basePrompt;
    const obdDataString = results
      .map((r) => `${r.code} — ${r.description} [${r.severity}]`)
      .join("\n");
    const enrichment = `\n## DATOS OBD DEL TALLER:\n${obdDataString}\n`;
    return enrichment + basePrompt;
  }

  static formatLocalFallback(results: ObdResult[]): string {
    const obdEntries = results
      .map((r) => `🔍 <b>${r.code}</b> — ${r.description} [${r.severity}]`)
      .join("\n");
    return `📋 <b>DIAGNÓSTICO OBD-II (Modo Local)</b>\n\n${obdEntries}\n\n⚠️ IA no disponible.`;
  }
}
