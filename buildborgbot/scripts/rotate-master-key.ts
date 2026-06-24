import { decrypt, deriveKey, encrypt } from "../src/factory/security";

async function rotateMasterKey(
  db: D1Database,
  oldSecret: string,
  newSecret: string,
) {
  const oldKey = await deriveKey(oldSecret);
  const newKey = await deriveKey(newSecret);

  console.log("Starting master key rotation...");

  // 1. Rotate bot tokens
  const bots = await db
    .prepare("SELECT bot_id, token, token_iv FROM factory_bots")
    .all<{ bot_id: string; token: string; token_iv: string }>();

  const statements = [];
  for (const bot of bots.results || []) {
    try {
      const plainToken = await decrypt(bot.token, bot.token_iv, oldKey);
      const { ciphertext, iv } = await encrypt(plainToken, newKey);

      statements.push(
        db
          .prepare(
            "UPDATE factory_bots SET token = ?, token_iv = ?, updated_at = CURRENT_TIMESTAMP WHERE bot_id = ?",
          )
          .bind(ciphertext, iv, bot.bot_id),
      );
      console.log(`✅ Prepared rotation for bot: ${bot.bot_id}`);
    } catch (_e) {
      console.error(
        `❌ Failed to decrypt token for bot ${bot.bot_id}. Skipping.`,
      );
    }
  }

  // 2. Rotate other encrypted fields if any (e.g., meta_app_secret)
  // TODO: Add rotation for meta_app_secret when encryption is added to it.

  if (statements.length > 0) {
    await db.batch(statements);
    console.log(`\nSuccessfully rotated ${statements.length} bot tokens.`);
  } else {
    console.log("\nNo tokens were rotated.");
  }
}

// Note: This script is intended to be run in a controlled environment or as part of a CLI.
// In a real scenario, you would pass the secrets via environment variables.
// biome-ignore lint/complexity/useLiteralKeys: required by tsconfig noPropertyAccessFromIndexSignature
const OLD_SECRET = process.env["OLD_TITANIUM_API_SECRET"];
// biome-ignore lint/complexity/useLiteralKeys: required by tsconfig noPropertyAccessFromIndexSignature
const NEW_SECRET = process.env["NEW_TITANIUM_API_SECRET"];
const DB = (globalThis as unknown as { DB: D1Database }).DB; // D1 binding when running via wrangler execute

if (!OLD_SECRET || !NEW_SECRET || !DB) {
  console.error("Missing required environment variables or DB binding.");
  process.exit(1);
}

rotateMasterKey(DB, OLD_SECRET, NEW_SECRET)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Rotation failed:", err);
    process.exit(1);
  });
