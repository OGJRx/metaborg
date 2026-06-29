import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "migrations";

interface Migration {
  version: string;
  name: string;
  checksum: string;
}

interface Journal {
  version: string;
  migrations: Migration[];
}

function calculateChecksum(filepath: string): string {
  const content = readFileSync(filepath);
  return createHash("sha1").update(content).digest("hex");
}

function validate() {
  const journalPath = join(MIGRATIONS_DIR, "_journal.json");
  const journalContent = readFileSync(journalPath, "utf-8");
  const journal: Journal = JSON.parse(journalContent);

  const sqlFiles = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith(".sql"),
  );

  console.log(`Checking ${sqlFiles.length} migration files...`);

  for (const sqlFile of sqlFiles) {
    const entry = journal.migrations.find((m) => m.name === sqlFile);
    if (!entry) {
      console.error(`❌ Migration ${sqlFile} is missing from _journal.json`);
      process.exit(1);
    }

    const currentChecksum = calculateChecksum(join(MIGRATIONS_DIR, sqlFile));
    if (currentChecksum !== entry.checksum) {
      console.error(`❌ Checksum mismatch for ${sqlFile}`);
      console.error(`   Expected: ${entry.checksum}`);
      console.error(`   Actual:   ${currentChecksum}`);
      process.exit(1);
    }
  }

  console.log("✅ All migrations are correctly registered in _journal.json");
}

validate();
