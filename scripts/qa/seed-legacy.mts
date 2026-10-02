// QA (item 10): semeia no banco LOCAL do QA dois pacotes antigos de agents/ para a regressão da vitrine e da compra, SEM escrever
// na cadeia (só leituras de RPC: o agente já existe na devnet, registrado antes). Emula o que a produção tem depois da
// migration 0016: catálogo + versão aprovada = a que a cadeia mostra. Rode do diretório apps/server com o .env.qa:
//
//   cd apps/server && node --env-file=.env.qa --import tsx ../../scripts/qa/seed-legacy.mts [slug...]
//
// Recusa rodar se DATABASE_URL não for o banco descartável do QA (porta 5544).
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

if (!/@(127\.0\.0\.1|localhost):5544\/t_qa/.test(process.env.DATABASE_URL ?? "")) throw new Error(`DATABASE_URL não é o banco do QA (t_qa:5544): ${process.env.DATABASE_URL}`);
const src = (p: string) => pathToFileURL(join(resolve(process.cwd()), "src", p)).href;
const { packages } = await import(src("runtime/packages.ts"));
const { chain, initChain } = await import(src("chain/index.ts"));
const { db, pool, schema } = await import(src("db/index.ts"));
const { upsertCatalog, relist } = await import(src("publish/catalog.ts"));
const { ingestPackage } = await import(src("knowledge/ingest.ts"));
const { syncAgent } = await import(src("indexer/sync.ts"));

const slugs = process.argv.slice(2).length ? process.argv.slice(2) : ["frontend-react", "planilhas-dados"];
await initChain();
const c = chain();
const all = [...packages().values()] as any[];
for (const slug of slugs) {
  const pkg = all.find((p) => p.manifest.slug === slug);
  if (!pkg) throw new Error(`pacote ${slug} não encontrado em AGENTS_DIR`);
  const id: string = pkg.manifest.id;
  const acc = await c.fetchMaybeAgent(id);
  if (!acc.exists) {
    console.log(`- ${slug}: sem conta on-chain na devnet, pulado`);
    continue;
  }
  const chunks = await ingestPackage(pkg);
  const hash = Buffer.from(acc.data.versionHash).toString("hex");
  // Backfill da 0016: a versão aprovada é a que a cadeia mostra hoje.
  await db
    .insert(schema.agentPublishedVersions)
    .values({ agentId: id, version: acc.data.version, versionHash: hash, priceUsdc: acc.data.price })
    .onConflictDoNothing();
  await upsertCatalog(pkg, acc.data.creator, { priceUnits: acc.data.price });
  await relist(id);
  await syncAgent(acc.address);
  const { rows } = await pool.query("select slug, version, price::text, status, sync_flag, listed from agents where id = $1", [id]);
  console.log(`- ${slug}: ${chunks} trechos; catálogo ${JSON.stringify(rows[0])}`);
}
await pool.end();
process.exit(0);
