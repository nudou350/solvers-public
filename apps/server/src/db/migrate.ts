import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";

export async function runMigrations() {
  // pgvector precisa existir antes das tabelas com coluna vector.
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url)) });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runMigrations();
  console.log("migrations aplicadas");
  await pool.end();
}
