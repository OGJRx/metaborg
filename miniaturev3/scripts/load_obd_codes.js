import fs from "fs";
import { execSync } from "child_process";

/**
 * 🛠️ OBD DATA LOADER - ITERACIÓN 7
 * Consolidates OBD codes from CSV and SQLite sources and generates D1 SQL batches.
 */

const CSV_PATH = "sqlODB/repo/mejores_descripciones.csv";
const DB_PATH = "sqlODB/repo/obd_codes.db";
const BATCH_SIZE = 100;
const OUTPUT_DIR = "sqlODB/batches";

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log("🚀 Starting OBD data consolidation...");

/**
 * Heuristic severity mapping based on code pattern
 */
function getSeverity(code) {
  const prefix = code[0].toUpperCase();
  const num = parseInt(code.substring(1, 5));

  if (prefix === "U") return "CRITICA";
  if (prefix === "C") return "ALTA";
  if (prefix === "B") return "MEDIA";

  if (prefix === "P") {
    if (isNaN(num)) return "MEDIA";
    if (num < 200) return "BAJA";
    if (num < 400) return "MEDIA";
    if (num < 600) return "MEDIA-ALTA";
    return "ALTA";
  }

  return "MEDIA";
}

function escapeSql(str) {
  if (!str) return "";
  return str.replace(/'/g, "''");
}

// 1. Load CSV data (Primary source for consolidated descriptions)
console.log(`📖 Reading CSV: ${CSV_PATH}`);
const csvLines = fs.readFileSync(CSV_PATH, "utf-8").split("\n");
const csvData = {};

csvLines.slice(1).forEach((line) => {
  if (!line.trim()) return;
  // Handle basic quoted CSV
  const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
  if (parts.length >= 2) {
    const code = parts[0].replace(/"/g, "").trim();
    const description = parts[1].replace(/"/g, "").trim();
    const sources = parts[2] ? parts[2].replace(/"/g, "").trim() : "";
    csvData[code] = {
      description,
      sources,
      extra_metadata: null,
      raw_hex: null,
      raw_decimal: null,
    };
  }
});

console.log(`✅ Loaded ${Object.keys(csvData).length} codes from CSV`);

// 2. Load DB data using sqlite3 CLI (Secondary source for metadata/extra codes)
console.log(`📡 Extracting metadata from DB: ${DB_PATH}`);
try {
  const dbDump = execSync(
    `sqlite3 ${DB_PATH} "SELECT code, description, source, extra_metadata, raw_hex, raw_decimal FROM dtc_codes"`,
    { encoding: "utf-8" },
  );

  const dbLines = dbDump.split("\n");
  dbLines.forEach((line) => {
    if (!line.trim()) return;
    const [code, description, source, extra_metadata, raw_hex, raw_decimal] =
      line.split("|");

    if (!csvData[code]) {
      csvData[code] = {
        description,
        sources: source,
        extra_metadata: extra_metadata !== "null" ? extra_metadata : null,
        raw_hex: raw_hex !== "null" ? raw_hex : null,
        raw_decimal:
          raw_decimal !== "null" ? parseInt(raw_decimal) || null : null,
      };
    } else {
      // Enrich existing entry
      if (
        extra_metadata &&
        extra_metadata !== "null" &&
        !csvData[code].extra_metadata
      ) {
        csvData[code].extra_metadata = extra_metadata;
      }
      if (raw_hex && raw_hex !== "null" && !csvData[code].raw_hex) {
        csvData[code].raw_hex = raw_hex;
      }
      if (raw_decimal && raw_decimal !== "null" && !csvData[code].raw_decimal) {
        csvData[code].raw_decimal = parseInt(raw_decimal) || null;
      }
      if (source && !csvData[code].sources.includes(source)) {
        csvData[code].sources += `,${source}`;
      }
    }
  });
} catch (e) {
  console.warn(
    "⚠️ Database extraction failed or returned no results. Continuing with CSV data only.",
  );
}

console.log(
  `✅ Final consolidated count: ${Object.keys(csvData).length} unique codes`,
);

// 3. Generate SQL batches
const codes = Object.keys(csvData);
let batchCount = 0;

for (let i = 0; i < codes.length; i += BATCH_SIZE) {
  const batch = codes.slice(i, i + BATCH_SIZE);
  const sql = batch
    .map((code) => {
      const d = csvData[code];
      const type = code[0].toUpperCase();
      const severity = getSeverity(code);
      const sources = d.sources || "unknown";
      const primarySource = sources.split(",")[0];

      return (
        `INSERT OR IGNORE INTO obd_codes (code, description, source, code_type, severity, extra_metadata, raw_hex, raw_decimal, sources_available) ` +
        `VALUES ('${code}', '${escapeSql(d.description)}', '${primarySource}', '${type}', '${severity}', ` +
        `${d.extra_metadata ? `'${escapeSql(d.extra_metadata)}'` : "NULL"}, ` +
        `${d.raw_hex ? `'${d.raw_hex}'` : "NULL"}, ` +
        `${d.raw_decimal !== null ? d.raw_decimal : "NULL"}, '${sources}');`
      );
    })
    .join("\n");

  fs.writeFileSync(`${OUTPUT_DIR}/batch_${batchCount}.sql`, sql);
  batchCount++;
}

console.log(`🎁 Generated ${batchCount} SQL batch files in ${OUTPUT_DIR}/`);
console.log("\n💡 Next steps:");
console.log(
  `1. Run migration 0079: wrangler d1 execute borg --remote --file=./borg-core-worker/migrations/0079_purge_and_obd_integration.sql`,
);
console.log(
  `2. Load data: for f in ${OUTPUT_DIR}/*.sql; do wrangler d1 execute borg --remote --file="$f"; done`,
);
