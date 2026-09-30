import { env } from "./env.js";
import { createApp } from "./app.js";
import { initChain } from "./chain/index.js";
import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/index.js";
import { startPoller, stopPoller } from "./indexer/poller.js";
import { mounts, startJobs, stopJobs } from "./modules.js";
import { warmEmbeddings } from "./knowledge/embeddings.js";
import { packages } from "./runtime/packages.js";

async function main() {
  await runMigrations();
  const { chain, auth } = await initChain();
  console.log(`[chain] rede ${env.SOLANA_CLUSTER} programa ${chain.programId} fee payer ${auth.feePayer.address}`);

  const pkgCount = new Set([...packages().values()].map((p) => p.manifest.id)).size;
  console.log(`[runtime] ${pkgCount} pacotes de solvers carregados`);
  warmEmbeddings();

  const app = createApp(mounts);
  const server = app.listen(env.PORT, "127.0.0.1", () => {
    console.log(`[server] ouvindo em 127.0.0.1:${env.PORT} (${env.PUBLIC_API_URL})`);
  });

  startPoller();
  startJobs();

  const shutdown = async (signal: string) => {
    console.log(`[server] ${signal}, encerrando`);
    stopPoller();
    stopJobs();
    server.close();
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("[server] falha ao iniciar", e);
  process.exit(1);
});
