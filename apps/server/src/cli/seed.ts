// Seed da demo (INSTRUCTIONS.md 9.1): popula a vitrine com dados reais on-chain.
// Pré-requisito: programa + config (scripts: bootstrap) e solvers publicados (cli:publish).
//
//   pnpm --filter @solvers/server cli:seed
//
// Cria compradores de teste (.keys/buyers), compras, avaliações, créditos, usos verificados,
// uma garantia concluída e uma em andamento, e anúncios de revenda (off-chain, a revenda é P2).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import {
  createKeyPairSignerFromBytes,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
  type KeyPairSigner,
} from "@solana/kit";
import { address, loadSigner } from "@solvers/chain";
import { findReviewPda } from "@solvers/client";
import { usdcToUnits } from "@solvers/shared";
import { authorities, chain, initChain } from "../chain/index.js";
import { db, pool, schema } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { processSignature } from "../indexer/processor.js";
import { sha256 } from "../lib/crypto.js";
import { getPackage } from "../runtime/packages.js";
import { readDeliverable, submitDeliverable } from "../verifier/deliverables.js";

const KEYS = join(process.cwd(), ".keys", "buyers");
const BUYERS = ["ana", "bruno", "carla", "diego", "elisa", "fabio", "gabi", "novato"];

async function buyer(name: string): Promise<KeyPairSigner> {
  const file = join(KEYS, `${name}.json`);
  if (existsSync(file)) return loadSigner(file);
  mkdirSync(KEYS, { recursive: true });
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const secret = new Uint8Array(64);
  secret.set(pkcs8.slice(-32), 0);
  secret.set(raw, 32);
  writeFileSync(file, JSON.stringify(Array.from(secret)), { mode: 0o600 });
  return createKeyPairSignerFromBytes(secret);
}

/** Monta como a API, assina como a carteira do usuário, envia e indexa. */
async function asUser(signer: KeyPairSigner, instructions: Parameters<ReturnType<typeof chain>["buildForUser"]>[0]) {
  const c = chain();
  const built = await c.buildForUser(instructions);
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(built.transaction));
  const signed = await partiallySignTransaction([signer.keyPair], tx);
  const { signature } = await c.submitSigned(getBase64EncodedWireTransaction(signed));
  await processSignature(signature);
  return signature;
}

const REVIEWS: Record<string, Array<[number, string]>> = {
  Desenvolvimento: [
    [5, "Saiu um componente com testes e acessibilidade de verdade. Economizei uma tarde inteira."],
    [5, "O checklist de revisão pegou dois bugs de foco que eu não teria visto."],
    [4, "Muito bom. Às vezes pergunta demais antes de começar, mas o resultado compensa."],
    [5, "Finalmente a IA escreve testes que testam comportamento, não implementação."],
    [4, "Ótimo para quem já sabe o básico e quer padrão de sênior."],
  ],
  Design: [
    [5, "A auditoria de contraste e espaçamento no meu Figma foi certeira."],
    [4, "Me ajudou a organizar os tokens. Precisei conectar o Figma antes, o passo a passo ajudou."],
    [5, "Hierarquia visual da minha landing melhorou muito com as sugestões."],
  ],
  "Dia a dia": [
    [5, "Planejou minha viagem para Portugal lembrando que eu não gosto de acordar cedo. Incrível."],
    [5, "O orçamento por categoria me deu uma noção real do quanto levar."],
    [4, "Muito útil. Gostei que ele avisa o que conferir nos sites oficiais."],
    [5, "Organizou minhas contas do mês sem julgamento, bem didático."],
  ],
  Negócios: [
    [4, "Apontou cláusulas de multa que eu nem tinha lido direito. Deixa claro que não substitui advogado."],
    [5, "Transformou minha planilha bagunçada em um painel simples."],
    [4, "Bom para revisar contrato de aluguel antes de assinar."],
  ],
  Escrita: [
    [5, "Os anúncios ficaram com a cara da minha marca, sem aquele texto genérico."],
    [4, "Boas variações de título para testar."],
  ],
};

async function main() {
  await runMigrations();
  await initChain();
  const c = chain();
  const agents = await db.select().from(schema.agents).where(and(eq(schema.agents.listed, true), eq(schema.agents.status, "active")));
  if (agents.length === 0) throw new Error("nenhum solver publicado; rode cli:publish antes");
  console.log(`${agents.length} solvers publicados`);

  const buyers: Record<string, KeyPairSigner> = {};
  for (const n of BUYERS) {
    buyers[n] = await buyer(n);
    if ((await c.usdcBalance(buyers[n]!.address)) < usdcToUnits(100)) await c.faucet(buyers[n]!.address, usdcToUnits(n === "novato" ? 30 : 300));
  }
  console.log("compradores com USDC de teste:", BUYERS.join(", "));

  // Compras e avaliações: cada solver recebe de 2 a 6 compradores ("novato" não compra nada).
  const veterans = BUYERS.filter((b) => b !== "novato");
  for (const [i, a] of agents.entries()) {
    const count = 2 + ((i * 3) % 5);
    const pool = REVIEWS[a.category] ?? REVIEWS.Desenvolvimento!;
    for (let k = 0; k < count; k++) {
      const name = veterans[(i + k) % veterans.length]!;
      const b = buyers[name]!;
      const has = await db.select().from(schema.licenses).where(and(eq(schema.licenses.ownerWallet, b.address), eq(schema.licenses.agentId, a.id)));
      let asset = has[0]?.id;
      if (!asset) {
        const { instructions, asset: newAsset } = await c.purchaseLicenseIxs(b.address, a.id, a.price);
        await asUser(b, instructions);
        asset = newAsset.address;
      }
      const [rating, text] = pool[(i + k) % pool.length]!;
      const already = await db.select().from(schema.reviews).where(and(eq(schema.reviews.agentId, a.id), eq(schema.reviews.authorWallet, b.address)));
      if (already.length === 0 && k < 4) {
        const hash = sha256(text);
        const [pda] = await findReviewPda({ agent: address(a.onchainAddress!), author: b.address });
        await db
          .insert(schema.reviews)
          .values({ id: pda, agentId: a.id, authorWallet: b.address, rating, text, contentHash: hash.toString("hex") })
          .onConflictDoNothing();
        await asUser(b, await c.submitReviewIxs(b.address, a.id, rating, hash, { licenseAsset: address(asset) }));
      }
    }
    console.log(`  ${a.name}: ${count} compras`);
  }

  // Créditos (pagamento por uso) para quem tem preço por uso.
  const payPerUse = agents.find((a) => a.pricePerUse > 0n);
  if (payPerUse) {
    const b = buyers.gabi!;
    const config = await c.fetchConfig();
    const amount = Number((config.data.minPrice + payPerUse.pricePerUse - 1n) / payPerUse.pricePerUse);
    await asUser(b, await c.buyCreditsIxs(b.address, payPerUse.id, amount));
    console.log(`  créditos: gabi comprou ${amount} usos de ${payPerUse.name}`);
  }

  // Usos verificados (lote on-chain) + histórico de 14 dias para a tendência da semana.
  for (const [i, a] of agents.entries()) {
    const base = 40 + ((i * 97) % 600);
    const recent = Math.round(base * (0.35 + ((i * 13) % 7) / 10));
    const previous = base - recent;
    const [already] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.usageEvents).where(eq(schema.usageEvents.agentId, a.id));
    if ((already?.n ?? 0) < 20) {
      const rows = [];
      for (let d = 0; d < 14; d++) {
        const perDay = Math.max(1, Math.round((d < 7 ? recent : previous) / 7 / 3));
        for (let k = 0; k < perDay; k++) {
          rows.push({
            wallet: buyers[veterans[k % veterans.length]!]!.address,
            agentId: a.id,
            sessionId: null,
            tool: "activate_solver",
            responseHash: sha256(`${a.id}:${d}:${k}`).toString("hex"),
            batched: true,
            createdAt: new Date(Date.now() - d * 86400_000 - k * 3600_000),
          });
        }
      }
      await db.insert(schema.usageEvents).values(rows);
      const root = sha256(rows.map((r) => r.responseHash).join(""));
      const { signature } = await c.sendAsServer([await c.recordUsageBatchIx(authorities().usage, a.id, BigInt(base), root)]);
      await processSignature(signature);
    }
  }
  console.log("  usos verificados registrados on-chain");

  // Garantias com o solver de front-end: uma concluída e uma em andamento.
  const fe = agents.find((a) => a.guaranteeAvailable);
  const example = getPackage("frontend-react");
  if (fe && example) {
    const b = buyers.ana!;
    const existing = await db.select().from(schema.escrows).where(eq(schema.escrows.buyerWallet, b.address));
    if (existing.length === 0) {
      const files = readDeliverable(join(example.dir, "verifier", "example"));
      for (const [n, done] of [
        [1, true],
        [2, false],
      ] as const) {
        const nonce = BigInt(Date.now() + n);
        const ms = [
          { title: "Formulário de login acessível", criteria: "Todos os testes passam; Sem erros de acessibilidade críticos", amountUsdc: 8 },
          { title: "Tela de recuperação de senha", criteria: "Todos os testes passam; Mensagens de erro anunciadas ao leitor de tela", amountUsdc: 6 },
        ];
        const { instructions, escrow } = await c.createEscrowIxs(
          b.address,
          fe.id,
          nonce,
          ms.map((m) => ({ amount: usdcToUnits(m.amountUsdc), criteriaHash: sha256(`${m.title}\n${m.criteria}`) })),
          BigInt(Number(process.env.ESCROW_REVIEW_WINDOW_SECS ?? 259200)),
        );
        await db.insert(schema.escrows).values({
          id: escrow,
          agentId: fe.id,
          buyerWallet: b.address,
          creatorWallet: fe.creatorId,
          nonce,
          total: usdcToUnits(14),
          status: "pending",
          reviewWindowSecs: Number(process.env.ESCROW_REVIEW_WINDOW_SECS ?? 259200),
        });
        await db.insert(schema.milestones).values(
          ms.map((m, idx) => ({
            escrowId: escrow,
            idx,
            title: m.title,
            criteria: m.criteria,
            criteriaHash: sha256(`${m.title}\n${m.criteria}`).toString("hex"),
            amount: usdcToUnits(m.amountUsdc),
          })),
        );
        await asUser(b, instructions);
        await submitDeliverable({ wallet: b.address, agentId: fe.id, escrowId: escrow, index: 0, files });
        if (done) {
          await asUser(b, await c.releaseMilestoneIxs(b, address(escrow), 0));
          await asUser(b, await c.releaseMilestoneIxs(b, address(escrow), 1));
        }
        console.log(`  garantia ${done ? "concluída" : "em andamento"}: ${escrow}`);
      }
    }
  }

  // Revenda (P2): anúncios e histórico de preço simulados off-chain para a tela de mercado.
  const listed = await db.select().from(schema.licenses).limit(4);
  for (const [i, l] of listed.entries()) {
    const [a] = await db.select().from(schema.agents).where(eq(schema.agents.id, l.agentId));
    if (!a) continue;
    const price = (a.price * BigInt(80 + i * 7)) / 100n;
    await db.update(schema.licenses).set({ listedForResale: true, resalePrice: price }).where(eq(schema.licenses.id, l.id));
    const [hist] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.resalePrices).where(eq(schema.resalePrices.agentId, a.id));
    if ((hist?.n ?? 0) === 0) {
      await db.insert(schema.resalePrices).values(
        Array.from({ length: 10 }, (_, d) => ({
          agentId: a.id,
          price: (a.price * BigInt(70 + ((d * 5 + i * 3) % 25))) / 100n,
          at: new Date(Date.now() - (10 - d) * 3 * 86400_000),
        })),
      );
    }
  }
  console.log("  revenda simulada: 4 anúncios");
  console.log("\nSeed concluído.");
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("cli/seed.ts")) {
  try {
    await main();
  } finally {
    await pool.end();
  }
  process.exit(0);
}

