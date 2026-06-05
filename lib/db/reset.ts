import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

// DEV ONLY: drop every corpus table and re-apply the schema. Destructive — never run against
// a database with real calibration data.
config({ path: ".env.local" });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (.env.local).");
  }
  const schema = readFileSync(join(process.cwd(), "lib/db/schema.sql"), "utf8");
  const statements = schema
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    await sql.unsafe(
      "DROP TABLE IF EXISTS push_subscriptions, calibration, fired_transitions, prediction_snapshots, watches CASCADE",
    );
    for (const stmt of statements) {
      await sql.unsafe(stmt);
    }
    console.log(`✅ DB reset + schema re-applied (${statements.length} statements).`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("❌ reset failed:", e);
  process.exit(1);
});
