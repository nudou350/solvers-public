import { createNoopSigner, type Instruction } from "@solana/kit";
import { address, type BuiltTx, type Signature } from "@solvers/chain";
import * as gen from "@solvers/client";
import { authorities, chain } from "../chain/index.js";
import { env } from "../env.js";
import { AGENT_STATUS } from "../indexer/mirror.js";
import { processSignature } from "../indexer/processor.js";
import { syncAgent } from "../indexer/sync.js";
import { bytesToHexStr, hexToBytes } from "../lib/crypto.js";
import { buildForUserChecked } from "../store/tx-build.js";
import type { ApprovedRecord, ChainAgentState } from "./approval-rules.js";

// A única fronteira do módulo de publicação com a blockchain. Tudo que precisa de RPC ou de assinatura passa por
// `PublishChain`: o código de publicação (rotas, finalização, aprovação, suspensão) fala só com esta interface, e os
// testes a trocam por uma simulada (a devnet real fica para o QA do líder). A implementação real usa `chain()`.

export type PublishChain = {
  /** A conta do agente na cadeia (versão, hash, preço, status, criador), ou `{ exists: false }`. */
  fetchAgentState(agentId: string): Promise<ChainAgentState>;
  /** Depósito mínimo do criador (min_stake) e o saldo de USDC dele: o register_agent cobra o stake. */
  minStake(): Promise<bigint>;
  usdcBalance(wallet: string): Promise<bigint>;
  /** Transações para o criador co-assinar (servidor como fee payer; já simuladas). */
  buildRegister(wallet: string, agentId: string, approved: ApprovedRecord): Promise<BuiltTx>;
  buildUpdateVersion(wallet: string, agentId: string, approved: ApprovedRecord): Promise<BuiltTx>;
  buildUpdatePricing(wallet: string, agentId: string, approved: ApprovedRecord): Promise<BuiltTx>;
  /**
   * A assinatura (já confirmada) fez, na conta deste agente, o que `kind` diz (registro, versão, preço) e foi assinada por
   * `creatorWallet`? Impede ligar uma assinatura qualquer (de outro agente, de outro tipo, de outro signatário) à submissão.
   */
  signatureTouchesAgent(signature: string, agentId: string, opts?: { kind?: TouchKind; creatorWallet?: string }): Promise<boolean>;
  /** Operações do admin on-chain (carteira fria; só nos CLIs `cli:approve` e `cli:suspend`). */
  adminAddress(): Promise<string | null>;
  onchainAdmin(): Promise<string>;
  approveAgent(agentId: string): Promise<string>;
  suspendAgent(agentId: string): Promise<string>;
  /** Espelha a conta do agente no banco (syncAgent) e indexa uma assinatura (processSignature). */
  syncAgent(agentId: string): Promise<void>;
  indexSignature(signature: string): Promise<void>;
};

/** O que a transação do criador fez na conta do agente (mesmos nomes de `ChainTouch.kind` em reconcile.ts). */
export type TouchKind = "registered" | "version" | "pricing";
const EVENT_OF_KIND: Record<TouchKind, string> = { registered: "AgentRegistered", version: "AgentVersionUpdated", pricing: "PricingUpdated" };

export function metadataUri(agentId: string): string {
  return `${env.PUBLIC_API_URL.replace(/\/$/, "")}/api/agents/${agentId}/metadata.json`;
}

export function realPublishChain(): PublishChain {
  return {
    async fetchAgentState(agentId) {
      const acc = await chain().fetchMaybeAgent(agentId);
      if (!acc.exists) return { exists: false };
      const a = acc.data;
      return {
        exists: true,
        address: acc.address,
        creator: a.creator,
        version: a.version,
        versionHash: bytesToHexStr(a.versionHash),
        price: a.price,
        status: AGENT_STATUS[a.status] ?? "pending",
      };
    },
    async minStake() {
      return (await chain().fetchConfig()).data.minStake;
    },
    usdcBalance: (wallet) => chain().usdcBalance(address(wallet)),
    async buildRegister(wallet, agentId, approved) {
      const reg = await chain().registerAgentIxs({
        creator: createNoopSigner(address(wallet)),
        agentIdHex: agentId,
        name: approved.name,
        metadataUri: metadataUri(agentId),
        version: approved.version,
        versionHash: hexToBytes(approved.versionHash),
        price: BigInt(approved.priceUsdc),
        pricePerUse: 0n, // só licença vitalícia
        royaltyBps: approved.royaltyBps,
      });
      return buildForUserChecked(reg.instructions, { kind: "register-agent", agentId, version: approved.version, agent: reg.agent, collection: reg.collection });
    },
    async buildUpdateVersion(wallet, agentId, approved) {
      const ix = await chain().updateVersionIx(createNoopSigner(address(wallet)), agentId, approved.version, hexToBytes(approved.versionHash));
      return buildForUserChecked([ix], { kind: "update-version", agentId, version: approved.version });
    },
    async buildUpdatePricing(wallet, agentId, approved) {
      const c = chain();
      const ix: Instruction = await gen.getUpdatePricingInstructionAsync({
        creator: createNoopSigner(address(wallet)),
        agent: await c.agentPda(agentId),
        price: BigInt(approved.priceUsdc),
        pricePerUse: 0n,
      });
      return buildForUserChecked([ix], { kind: "update-pricing", agentId, priceUnits: approved.priceUsdc });
    },
    async signatureTouchesAgent(signature, agentId, opts = {}) {
      const c = chain();
      const pda = await c.agentPda(agentId);
      const events = await c.eventsOf(signature as Signature);
      const hit = events.filter((e) => "agent" in e.data && (e.data as { agent: string }).agent === pda && (!opts.kind || e.name === EVENT_OF_KIND[opts.kind]));
      if (hit.length === 0) return false;
      if (!opts.creatorWallet) return true;
      // Registro: o evento traz o criador. Versão e preço só valem assinados pelo criador da conta (o programa exige): confere na conta.
      const registered = hit.find((e) => e.name === "AgentRegistered");
      if (registered) return (registered.data as { creator: string }).creator === opts.creatorWallet;
      const acc = await c.fetchMaybeAgent(agentId);
      return acc.exists && acc.data.creator === opts.creatorWallet;
    },
    async adminAddress() {
      return authorities().admin?.address ?? null;
    },
    async onchainAdmin() {
      return (await chain().fetchConfig()).data.admin;
    },
    async approveAgent(agentId) {
      const c = chain();
      const admin = authorities().admin;
      if (!admin) throw new Error("ADMIN_KEYPAIR necessário (a carteira do admin on-chain)");
      const { signature } = await c.sendAsServer([await c.approveAgentIx(admin, agentId)]);
      return signature;
    },
    async suspendAgent(agentId) {
      const c = chain();
      const admin = authorities().admin;
      if (!admin) throw new Error("ADMIN_KEYPAIR necessário (a carteira do admin on-chain)");
      const { signature } = await c.sendAsServer([await c.suspendAgentIx(admin, agentId)]);
      return signature;
    },
    async syncAgent(agentId) {
      await syncAgent(await chain().agentPda(agentId));
    },
    async indexSignature(signature) {
      await processSignature(signature);
    },
  };
}

let override: PublishChain | null = null;

/** Troca a fronteira (testes). `null` volta à implementação real. */
export function setPublishChain(port: PublishChain | null): void {
  override = port;
}

export function publishChain(): PublishChain {
  return override ?? realPublishChain();
}
