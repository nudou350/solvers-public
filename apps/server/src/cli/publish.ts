// Publica solvers (INSTRUCTIONS.md 6): calcula o versionHash, ingere o conhecimento, espelha o
// catálogo no banco, registra no programa (register_agent), acerta o preço (update_pricing, sem
// pagamento por uso), aprova (admin) e grava a nota de desempenho (set_eval). Idempotente: rodar de novo só atualiza o que mudou.
//
//   pnpm --filter @solvers/server cli:publish            # todos os pacotes de agents/ com conta on-chain
//   pnpm --filter @solvers/server cli:publish frontend-react ui-design
//   pnpm --filter @solvers/server cli:publish --no-chain # Solvers da plataforma (PLATFORM_AGENTS, ex.: criador-de-solvers): só o banco
//
// `--no-chain`: sem registro on-chain, preço 0, `status = active`, listado. É o caminho dos Solvers da plataforma, que não
// têm conta no programa nem são vendidos. Os demais continuam on-chain, como sempre; terceiros NÃO passam por aqui
// (publicam pelo site, PACKAGE_SPEC.md 15). O catálogo é montado por publish/catalog.ts, o mesmo código da finalização do site.
//
// Chaves dos criadores: CREATOR_KEYS_DIR/<creator.id>.json (criada se não existir, só fora de mainnet).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { loadSigner, type KeyPairSigner } from "@solvers/chain";
import * as gen from "@solvers/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { usdcToUnits } from "@solvers/shared";
import { authorities, chain, initChain } from "../chain/index.js";
import { db, pool, schema } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { env } from "../env.js";
import { ingestPackage } from "../knowledge/ingest.js";
import { syncAgent } from "../indexer/sync.js";
import { nextMaxLicenses } from "../store/supply-rules.js";
import { isPlatformPair } from "../runtime/platform-agents.js";
import { packages, type SolverPackage } from "../runtime/packages.js";
import { relist, upsertCatalog } from "../publish/catalog.js";
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

/**
 * O que a revisão "aprovou": no `cli:publish` o admin é quem publica, então registrar a versão aqui ANTES de qualquer
 * transação é o equivalente da aprovação do site. Sem isso o indexador marcaria a versão recém-registrada como "não
 * aprovada" (PACKAGE_SPEC.md 15.3, passo 1). Versões antigas ficam (o criador pode reverter para elas).
 */
export async function recordApprovedVersion(pkg: SolverPackage, price: bigint, approveTx?: string) {
  const v = { agentId: pkg.manifest.id, version: pkg.manifest.version, versionHash: pkg.versionHash, priceUsdc: price };
  await db
    .insert(schema.agentPublishedVersions)
    .values({ ...v, approveTx: approveTx ?? null })
    .onConflictDoUpdate({
      target: [schema.agentPublishedVersions.agentId, schema.agentPublishedVersions.version],
      set: { versionHash: v.versionHash, priceUsdc: v.priceUsdc, ...(approveTx ? { approveTx } : {}) },
    });
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
    const { signature } = await c.sendAsServer([await c.approveAgentIx(admin, m.id)]);
    await recordApprovedVersion(pkg, usdcToUnits(m.pricing.priceUsdc), signature);
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

export type PublishOptions = {
  /** Só banco: Solvers da plataforma (sem conta on-chain, preço 0, status active). */
  noChain?: boolean;
};

/** Pacotes da pasta da plataforma (AGENTS_DIR), sem o espelho duplo id/slug. Os de criadores (PUBLISHED_DIR) nunca entram aqui. */
function platformFolderPackages(): SolverPackage[] {
  return [...new Map([...packages().values()].map((p) => [p.manifest.id, p])).values()].filter((p) => (p.source ?? "agents") === "agents");
}

/** Escolhe o que publicar e confere o modo: Solver da plataforma só com `--no-chain`; os demais só com cadeia. */
export function selectPackages(all: SolverPackage[], slugs: string[], opts: PublishOptions): SolverPackage[] {
  const wanted = slugs.length ? all.filter((p) => slugs.includes(p.manifest.slug) || slugs.includes(p.manifest.id)) : all;
  if (slugs.length) {
    const missing = slugs.filter((x) => !all.some((p) => p.manifest.slug === x || p.manifest.id === x));
    if (missing.length) throw new Error(`nenhum pacote da plataforma encontrado para: ${missing.join(", ")} (pacotes de criadores publicam pelo site)`);
    for (const p of wanted) {
      const platform = isPlatformPair(p.manifest);
      if (opts.noChain && !platform) throw new Error(`${p.manifest.slug} não é um Solver da plataforma (PLATFORM_AGENTS): --no-chain só vale para eles`);
      if (!opts.noChain && platform) throw new Error(`${p.manifest.slug} é um Solver da plataforma, sem conta on-chain: publique com --no-chain`);
    }
    return wanted;
  }
  // Sem nomes: cada modo pega o seu grupo.
  return wanted.filter((p) => isPlatformPair(p.manifest) === (opts.noChain === true));
}

/** Solver da plataforma: só o banco. Preço 0, `status = active`, listado; nada on-chain. */
export async function publishNoChain(pkg: SolverPackage) {
  const m = pkg.manifest;
  if (m.pricing.priceUsdc !== 0) console.warn(`  ⚠ o manifesto pede ${m.pricing.priceUsdc} USDC; Solver da plataforma é gratuito (publicado com preço 0)`);
  const chunks = await ingestPackage(pkg);
  console.log(`  conhecimento: ${chunks} trechos`);
  // `creators.wallet` é obrigatória e única: mantém a do perfil se já existe; senão, a carteira da plataforma (fee payer).
  const [creator] = await db.select({ wallet: schema.creators.wallet }).from(schema.creators).where(eq(schema.creators.id, m.creator.id));
  const wallet = creator?.wallet ?? authorities().feePayer.address;
  await recordApprovedVersion(pkg, 0n);
  // `platform_status` só nasce `active` (default da coluna): republicar não levanta uma suspensão do admin.
  await upsertCatalog(pkg, wallet, { priceUnits: 0n, status: "active" });
  await relist(m.id);
  console.log("  só no banco (sem conta on-chain): preço 0, ativo e listado");
}

export async function publish(slugs: string[], opts: PublishOptions = {}) {
  // A URL de metadados vai on-chain e não pode ser trocada depois: nunca publicar localhost fora da localnet.
  if (!opts.noChain && env.SOLANA_CLUSTER !== "localnet" && /localhost|127\.0\.0\.1/.test(env.PUBLIC_API_URL)) {
    throw new Error(`PUBLIC_API_URL=${env.PUBLIC_API_URL} não pode ir on-chain na ${env.SOLANA_CLUSTER}; use .env.devnet`);
  }
  const selected = selectPackages(platformFolderPackages(), slugs, opts);
  if (selected.length === 0) throw new Error(slugs.length ? `nenhum pacote encontrado para: ${slugs.join(", ")}` : "nenhum pacote para publicar neste modo");
  for (const pkg of selected) {
    const m = pkg.manifest;
    console.log(`
▶ ${m.name} (${m.slug}) v${m.version}`);
    if (opts.noChain) {
      await publishNoChain(pkg);
      console.log(`  versionHash ${pkg.versionHash.slice(0, 16)}…  ok`);
      continue;
    }
    const creator = await creatorSigner(m.creator.id);
    // Ordem: conhecimento, cadeia e só então o catálogo (preço, versão, garantia). Se algo falhar no meio,
    // a vitrine continua mostrando a versão anterior, consistente com a cadeia.
    const chunks = await ingestPackage(pkg);
    console.log(`  conhecimento: ${chunks} trechos`);
    // Versão aprovada ANTES de qualquer transação (o sync do fim a confere; PACKAGE_SPEC.md 15.3, passo 1).
    await recordApprovedVersion(pkg, usdcToUnits(m.pricing.priceUsdc));
    await publishOnChain(pkg, creator);
    await upsertCatalog(pkg, creator.address);
    await relist(m.id);
    console.log(`  versionHash ${pkg.versionHash.slice(0, 16)}…  ok`);
  }
}

if (/cli\/publish\.(ts|js)$/.test(process.argv[1]?.replace(/\\/g, "/") ?? "")) {
  const args = process.argv.slice(2);
  const noChain = args.includes("--no-chain");
  await runMigrations();
  await initChain();
  try {
    await publish(args.filter((a) => !a.startsWith("--")), { noChain });
  } finally {
    await pool.end();
  }
  process.exit(0);
}
