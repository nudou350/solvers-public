// Publica solvers (INSTRUCTIONS.md 6): calcula o versionHash, ingere o conhecimento, espelha o
// catálogo no banco, registra no programa (register_agent), acerta o preço (update_pricing, sem
// pagamento por uso), aprova (admin) e grava a nota de desempenho (set_eval). Idempotente: rodar de novo só atualiza o que mudou.
//
//   pnpm --filter @solvers/server cli:publish            # todos os pacotes em agents/
//   pnpm --filter @solvers/server cli:publish frontend-react ui-design
//
// Chaves dos criadores: CREATOR_KEYS_DIR/<creator.id>.json (criada se não existir, só fora de mainnet).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { loadSigner, type KeyPairSigner } from "@solvers/chain";
import * as gen from "@solvers/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { DELIST_MAX_RATING, DELIST_MIN_REVIEWS, usdcToUnits } from "@solvers/shared";
import { authorities, chain, initChain } from "../chain/index.js";
import { db, pool, schema } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { env } from "../env.js";
import { embed } from "../knowledge/embeddings.js";
import { ingestPackage } from "../knowledge/ingest.js";
import { syncAgent } from "../indexer/sync.js";
import { nextMaxLicenses } from "../store/supply-rules.js";
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
  // Um vetor para o texto todo e um para cada frase curta: pedido vago casa com a frase, não se perde na descrição.
  const phrases = [`${m.name}: ${m.tagline}`, ...m.searchPhrases];
  const [vec = null, ...phraseVecs] = (await embed([text, ...phrases], "passage")) ?? [];
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
    guaranteeTemplate: m.guarantee.available
      ? {
          priceUsdc: m.guarantee.priceUsdc ?? m.pricing.priceUsdc,
          milestones: m.guarantee.milestones ?? [{ title: "Entrega", criteria: m.guarantee.defaultCriteria, sharePct: 100, verify: "tests" as const }],
        }
      : undefined,
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
    // Só licença vitalícia: o pagamento por uso acabou (o programa mantém o campo, sempre 0).
    pricePerUse: 0n,
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
  await db.delete(schema.agentSearchVectors).where(eq(schema.agentSearchVectors.agentId, m.id));
  if (phraseVecs.length > 0) {
    await db.insert(schema.agentSearchVectors).values(phraseVecs.map((embedding, i) => ({ agentId: m.id, content: phrases[i]!, embedding })));
  }
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
      pricePerUse: 0n,
      royaltyBps: m.pricing.royaltyBps,
    });
    await c.sendAsServer(reg.instructions);
    console.log(`  registrado on-chain: ${reg.agent}`);
  } else if (Buffer.from(existing.data.versionHash).toString("hex") !== pkg.versionHash) {
    await c.sendAsServer([await c.updateVersionIx(creator, m.id, m.version, hexToBytes(pkg.versionHash))]);
    console.log(`  nova versão on-chain: ${m.version}`);
  }

  // Preço on-chain igual ao manifest e sem pagamento por uso (agentes antigos tinham price_per_use > 0).
  const price = usdcToUnits(m.pricing.priceUsdc);
  const current = await c.fetchAgent(m.id);
  if (current.data.price !== price || current.data.pricePerUse !== 0n) {
    const ix = await gen.getUpdatePricingInstructionAsync({ creator, agent: await c.agentPda(m.id), price, pricePerUse: 0n });
    await c.sendAsServer([ix]);
    console.log(`  preço on-chain: ${m.pricing.priceUsdc} USDC, sem pagamento por uso`);
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
  await reconcileSupplyCap(pkg, creator);
  await syncAgent(await c.agentPda(m.id));
}

/**
 * Teto de licenças (docs/licencas-limitadas.md): leva o `supply.maxLicenses` do manifest para a PDA SupplyCap on-chain,
 * assinada pelo criador (a plataforma paga o rent). Regra "só sobe" em `nextMaxLicenses`: cria se não existe, sobe se o manifest
 * é maior, e avisa sem mexer quando o manifest é menor ou some (nunca vira ilimitado por omissão).
 */
async function reconcileSupplyCap(pkg: SolverPackage, creator: KeyPairSigner) {
  const c = chain();
  const m = pkg.manifest;
  const requested = m.supply?.maxLicenses ?? null;
  const onchain = await c.fetchSupplyCap(m.id);
  const sold = Number((await c.fetchAgent(m.id)).data.totalSales);
  const plan = nextMaxLicenses(onchain, requested, sold);
  if (!plan.ok) {
    console.warn(`  ⚠ teto de licenças: ${plan.message}`);
    return;
  }
  if (plan.action === "none") return;
  try {
    const ix = plan.action === "create" ? await c.createSupplyCapIx(creator, m.id, plan.max) : await c.raiseSupplyCapIx(creator, m.id, plan.max);
    await c.sendAsServer([ix]);
  } catch (e) {
    throw new Error(
      `não foi possível ${plan.action === "create" ? "criar" : "subir"} o teto de licenças on-chain (${(e as Error).message}). ` +
        "Se o programa da devnet ainda é o antigo, faça o upgrade antes (docs/devnet-upgrade.md).",
    );
  }
  console.log(`  teto de licenças on-chain: ${plan.max}${plan.action === "raise" ? ` (era ${onchain})` : ""}`);
}

/** Volta à vitrine, a não ser que a nota continue abaixo do mínimo (o job tiraria de novo). Só depois do catálogo completo. */
async function relist(agentId: string) {
  await db
    .update(schema.agents)
    .set({ listed: sql`not (${schema.agents.ratingCount} >= ${DELIST_MIN_REVIEWS} and ${schema.agents.ratingSum}::float / nullif(${schema.agents.ratingCount}, 0) < ${DELIST_MAX_RATING})` })
    .where(eq(schema.agents.id, agentId));
}

export async function publish(slugs: string[]) {
  // A URL de metadados vai on-chain e não pode ser trocada depois: nunca publicar localhost fora da localnet.
  if (env.SOLANA_CLUSTER !== "localnet" && /localhost|127\.0\.0\.1/.test(env.PUBLIC_API_URL)) {
    throw new Error(`PUBLIC_API_URL=${env.PUBLIC_API_URL} não pode ir on-chain na ${env.SOLANA_CLUSTER}; use .env.devnet`);
  }
  const all = [...new Map([...packages().values()].map((p) => [p.manifest.id, p])).values()];
  const selected = slugs.length ? all.filter((p) => slugs.includes(p.manifest.slug) || slugs.includes(p.manifest.id)) : all;
  if (selected.length === 0) throw new Error(`nenhum pacote encontrado para: ${slugs.join(", ")}`);
  for (const pkg of selected) {
    const m = pkg.manifest;
    console.log(`\n▶ ${m.name} (${m.slug}) v${m.version}`);
    const creator = await creatorSigner(m.creator.id);
    // Ordem: conhecimento, cadeia e só então o catálogo (preço, versão, garantia). Se algo falhar no meio,
    // a vitrine continua mostrando a versão anterior, consistente com a cadeia.
    const chunks = await ingestPackage(pkg);
    console.log(`  conhecimento: ${chunks} trechos`);
    await publishOnChain(pkg, creator);
    await upsertCatalog(pkg, creator.address);
    await relist(m.id);
    console.log(`  versionHash ${pkg.versionHash.slice(0, 16)}…  ok`);
  }
}

if (/cli\/publish\.(ts|js)$/.test(process.argv[1]?.replace(/\\/g, "/") ?? "")) {
  await runMigrations();
  await initChain();
  try {
    await publish(process.argv.slice(2));
  } finally {
    await pool.end();
  }
  process.exit(0);
}

