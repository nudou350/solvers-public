// Publica solvers (INSTRUCTIONS.md 6): calcula o versionHash, ingere o conhecimento, espelha o
// catálogo no banco, registra no programa (register_agent), aprova (admin) e grava a nota de
// desempenho (set_eval). Idempotente: rodar de novo só atualiza o que mudou.
//
//   pnpm --filter @solvers/server cli:publish            # todos os pacotes em agents/
//   pnpm --filter @solvers/server cli:publish frontend-react ui-design
//
// Chaves dos criadores: CREATOR_KEYS_DIR/<creator.id>.json (criada se não existir, só fora de mainnet).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { loadSigner, type KeyPairSigner } from "@solvers/chain";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { usdcToUnits } from "@solvers/shared";
import { authorities, chain, initChain } from "../chain/index.js";
import { db, pool, schema } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { env } from "../env.js";
import { embed } from "../knowledge/embeddings.js";
import { ingestPackage } from "../knowledge/ingest.js";
import { syncAgent } from "../indexer/sync.js";
import { packages, type SolverPackage } from "../runtime/packages.js";
import { hexToBytes } from "../lib/crypto.js";

const KEYS_DIR = process.env.CREATOR_KEYS_DIR ?? join(process.cwd(), ".keys", "creators");

async function creatorSigner(creatorId: string): Promise<KeyPairSigner> {
  const file = join(KEYS_DIR, `${creatorId}.json`);
  if (existsSync(file)) return loadSigner(file);
  if (env.SOLANA_CLUSTER === "mainnet-beta") throw new Error(`chave do criador ${creatorId} não encontrada em ${file}`);
  mkdirSync(KEYS_DIR, { recursive: true });
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const secret = new Uint8Array(64);
  secret.set(pkcs8.slice(-32), 0);
  secret.set(raw, 32);
  writeFileSync(file, JSON.stringify(Array.from(secret)), { mode: 0o600 });
  return createKeyPairSignerFromBytes(secret);
}

function searchText(pkg: SolverPackage) {
  const m = pkg.manifest;
  return [m.name, m.tagline, m.description, m.category, ...m.packageContents, ...m.requirements.map((r) => r.label)].join("\n");
}

async function upsertCatalog(pkg: SolverPackage, creatorWallet: string) {
  const m = pkg.manifest;
  await db
    .insert(schema.creators)
    .values({ id: m.creator.id, wallet: creatorWallet, name: m.creator.name, bio: m.creator.bio, avatarUrl: m.creator.avatarUrl ?? null })
    .onConflictDoUpdate({ target: schema.creators.id, set: { name: m.creator.name, bio: m.creator.bio, avatarUrl: m.creator.avatarUrl ?? null } });

  const text = searchText(pkg);
  const vec = (await embed([text], "passage"))?.[0] ?? null;
  const details = {
    beforeAfter: m.beforeAfter,
    versions: (m.versions.length ? m.versions : [{ version: m.version, releasedAt: new Date().toISOString(), notes: "Primeira versão" }]).map((v) => ({
      version: v.version,
      versionHash: v.version === m.version ? pkg.versionHash : "",
      releasedAt: v.releasedAt,
      notes: v.notes,
      evalScore: v.version === m.version && pkg.evalReport ? pkg.evalReport.scoreBps / 100 : null,
    })),
    tools: m.tools,
    guaranteeCriteria: m.guarantee.defaultCriteria,
    catalogOnly: m.catalogOnly ?? false,
  };
  const values = {
    slug: m.slug,
    name: m.name,
    tagline: m.tagline,
    description: m.description,
    category: m.category,
    creatorId: m.creator.id,
    version: m.version,
    versionHash: pkg.versionHash,
    price: usdcToUnits(m.pricing.priceUsdc),
    pricePerUse: m.pricing.pricePerUseUsdc ? usdcToUnits(m.pricing.pricePerUseUsdc) : 0n,
    royaltyBps: m.pricing.royaltyBps,
    requirements: m.requirements,
    packageContents: m.packageContents,
    guaranteeAvailable: m.guarantee.available,
    details,
    searchText: text,
    embedding: vec,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.agents)
    .values({ id: m.id, ...values })
    .onConflictDoUpdate({ target: schema.agents.id, set: values });
}

async function publishOnChain(pkg: SolverPackage, creator: KeyPairSigner) {
  const c = chain();
  const { admin, verifier } = authorities();
  const m = pkg.manifest;
  const existing = await c.fetchMaybeAgent(m.id);
  if (!existing.exists) {
    const config = await c.fetchConfig();
    // O criador precisa de USDC para o stake (na devnet/local vem do faucet de teste).
    if ((await c.usdcBalance(creator.address)) < config.data.minStake) {
      await c.faucet(creator.address, config.data.minStake + usdcToUnits(10));
    }
    const reg = await c.registerAgentIxs({
      creator,
      agentIdHex: m.id,
      name: m.name,
      metadataUri: `${env.PUBLIC_API_URL.replace(/\/$/, "")}/api/agents/${m.id}/metadata.json`,
      version: m.version,
      versionHash: hexToBytes(pkg.versionHash),
      price: usdcToUnits(m.pricing.priceUsdc),
      pricePerUse: m.pricing.pricePerUseUsdc ? usdcToUnits(m.pricing.pricePerUseUsdc) : 0n,
      royaltyBps: m.pricing.royaltyBps,
    });
    await c.sendAsServer(reg.instructions);
    console.log(`  registrado on-chain: ${reg.agent}`);
  } else if (Buffer.from(existing.data.versionHash).toString("hex") !== pkg.versionHash) {
    await c.sendAsServer([await c.updateVersionIx(creator, m.id, m.version, hexToBytes(pkg.versionHash))]);
    console.log(`  nova versão on-chain: ${m.version}`);
  }

  const agent = await c.fetchAgent(m.id);
  if (agent.data.status !== 1) {
    if (!admin) throw new Error("ADMIN_KEYPAIR necessário para aprovar solvers");
    await c.sendAsServer([await c.approveAgentIx(admin, m.id)]);
    console.log("  aprovado pelo admin");
  }
  if (pkg.evalReport) {
    const fresh = await c.fetchAgent(m.id);
    const hash = hexToBytes(pkg.evalReport.hash);
    if (fresh.data.evalScoreBps !== pkg.evalReport.scoreBps || Buffer.from(fresh.data.evalHash).toString("hex") !== pkg.evalReport.hash) {
      await c.sendAsServer([await c.setEvalIx(verifier, m.id, pkg.evalReport.scoreBps, hash)]);
      console.log(`  nota de desempenho: ${pkg.evalReport.scoreBps / 100}%`);
    }
  }
  await syncAgent(await c.agentPda(m.id));
  await db.update(schema.agents).set({ listed: true }).where(eq(schema.agents.id, m.id));
}

export async function publish(slugs: string[]) {
  const all = [...new Map([...packages().values()].map((p) => [p.manifest.id, p])).values()];
  const selected = slugs.length ? all.filter((p) => slugs.includes(p.manifest.slug) || slugs.includes(p.manifest.id)) : all;
  if (selected.length === 0) throw new Error(`nenhum pacote encontrado para: ${slugs.join(", ")}`);
  for (const pkg of selected) {
    const m = pkg.manifest;
    console.log(`\n▶ ${m.name} (${m.slug}) v${m.version}`);
    const creator = await creatorSigner(m.creator.id);
    await upsertCatalog(pkg, creator.address);
    const chunks = await ingestPackage(pkg);
    console.log(`  conhecimento: ${chunks} trechos`);
    await publishOnChain(pkg, creator);
    console.log(`  versionHash ${pkg.versionHash.slice(0, 16)}…  ok`);
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("cli/publish.ts")) {
  await runMigrations();
  await initChain();
  try {
    await publish(process.argv.slice(2));
  } finally {
    await pool.end();
  }
  process.exit(0);
}

