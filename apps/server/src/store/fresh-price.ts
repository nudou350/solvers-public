import { unitsToUsdc } from "@solvers/shared";
import { chain } from "../chain/index.js";
import { SYNC_OK, chainMatchesApproved, type ApprovedVersion, type ChainVersion } from "../indexer/approved-version.js";
import { loadApprovedVersions, syncAgent } from "../indexer/sync.js";
import { bytesToHexStr } from "../lib/crypto.js";
import { HttpError } from "../lib/http.js";
import { assertNotPlatformAgent } from "../runtime/platform-agents.js";
import type { schema } from "../db/index.js";

type PricedAgent = Pick<typeof schema.agents.$inferSelect, "id" | "price"> & { syncFlag?: string };

/** O que `assertFreshPrice` precisa de fora (RPC e banco); injetável nos testes. */
export type FreshPriceDeps = {
  /** Versão e preço da conta on-chain, ou null se o agente não existe na cadeia. */
  readChain: (agentId: string) => Promise<(ChainVersion & { address: string }) | null>;
  approvedVersions: (agentId: string) => Promise<ApprovedVersion[]>;
  /** Espelha o agente (syncAgent). */
  sync: (address: string) => Promise<unknown>;
};

const realDeps: FreshPriceDeps = {
  async readChain(agentId) {
    const acc = await chain().fetchMaybeAgent(agentId);
    if (!acc.exists) return null;
    return { address: acc.address, version: acc.data.version, versionHash: bytesToHexStr(acc.data.versionHash), price: acc.data.price };
  },
  approvedVersions: loadApprovedVersions,
  sync: (address) => syncAgent(address as Parameters<typeof syncAgent>[0]),
};

/** 409 `price_in_review`: a cadeia tem versão/preço que a revisão ainda não aprovou (PACKAGE_SPEC.md 15.4). */
export function priceInReview(): HttpError {
  return new HttpError(409, "This specialist is under review and not for sale right now. Please try again later.", "price_in_review");
}

/**
 * Relê o preço on-chain antes de montar uma compra. O criador pode mudar o preço (update_pricing) e o
 * programa não emite evento para isso, então o banco pode estar defasado. Se diferir, espelha o agente
 * e responde 409 com o novo preço, para o comprador confirmar o valor real em vez de a compra falhar
 * na rede com PriceChanged.
 *
 * Versão e preço da cadeia que a revisão não aprovou (o criador chamou update_version/update_pricing direto) bloqueiam a
 * venda com 409 `price_in_review`, em vez de `price_changed` (o preço "novo" não é o que a plataforma aprovou, e o banco
 * continua mostrando o aprovado). Volta a vender quando a cadeia reverte ou uma nova aprovação cobre aquele hash.
 */
export async function assertFreshPrice(row: PricedAgent, deps: FreshPriceDeps = realDeps): Promise<void> {
  // Solver da plataforma não tem conta on-chain nem preço: 409 platform_agent_not_for_sale antes de qualquer RPC.
  assertNotPlatformAgent(row);
  const onchain = await deps.readChain(row.id);
  if (!onchain) return;
  const approved = chainMatchesApproved(onchain, await deps.approvedVersions(row.id));
  const flagged = row.syncFlag !== undefined && row.syncFlag !== SYNC_OK;
  if (!approved) {
    // Espelha para a marca ficar no banco (vitrine/painel); a decisão vem da conferência ao vivo, não do espelho.
    if (!flagged) await deps.sync(onchain.address);
    throw priceInReview();
  }
  // Aprovado de novo (reverteu ou foi aprovado depois): limpa a marca; o espelho volta a seguir a cadeia.
  if (flagged) await deps.sync(onchain.address);
  if (onchain.price === row.price) return;
  await deps.sync(onchain.address);
  throw new HttpError(409, "This specialist's price has changed. Check the new amount to continue.", "price_changed", {
    priceUsdc: unitsToUsdc(onchain.price),
    previousPriceUsdc: unitsToUsdc(row.price),
  });
}
