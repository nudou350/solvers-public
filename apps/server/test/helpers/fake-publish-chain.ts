import type { BuiltTx } from "@solvers/chain";
import type * as gen from "@solvers/client";
import type { ApprovedRecord, ChainAgentState, OnchainStatus } from "../../src/publish/approval-rules.js";
import type { PublishChain } from "../../src/publish/chain-port.js";

// Blockchain simulada para os testes de publicação (a devnet real é do QA do líder): guarda a conta de cada agente em
// memória, deixa o teste "pousar" as transações do criador e do admin e espelha no banco pelo MESMO código do indexador
// (`mirrorAgentAccount`), então a conferência versão aprovada x cadeia roda de verdade.

type Account = { creator: string; version: string; versionHash: string; price: bigint; royaltyBps: number; status: OnchainStatus };

const STATUS_CODE: Record<OnchainStatus, number> = { pending: 0, active: 1, suspended: 2, retired: 3 };

export class FakeChain implements PublishChain {
  accounts = new Map<string, Account>();
  /** Assinatura -> agente que ela mexeu. */
  signatures = new Map<string, string>();
  /** Saldo de USDC por carteira e depósito mínimo. */
  balances = new Map<string, bigint>();
  stake = 5_000_000n;
  admin: string | null = "AdminOnchainWallet";
  onchainAdminAddress = "AdminOnchainWallet";
  failSuspend = false;
  /** Último registro aprovado que cada `build*` recebeu (prova de que preço/hash vêm do servidor). */
  built: { kind: string; wallet: string; agentId: string; approved: ApprovedRecord }[] = [];
  calls: string[] = [];
  private n = 0;

  constructor(private readonly mirror: (addr: string, acc: gen.Agent) => Promise<unknown>) {}

  pda = (agentId: string) => `pda-${agentId}`;

  private sig(agentId: string, what: string): string {
    const s = `sig-${what}-${agentId.slice(-6)}-${++this.n}`.padEnd(64, "x");
    this.signatures.set(s, agentId);
    return s;
  }

  async fetchAgentState(agentId: string): Promise<ChainAgentState> {
    const a = this.accounts.get(agentId);
    return a ? { exists: true, address: this.pda(agentId), creator: a.creator, version: a.version, versionHash: a.versionHash, price: a.price, status: a.status } : { exists: false };
  }
  async minStake() {
    return this.stake;
  }
  async usdcBalance(wallet: string) {
    return this.balances.get(wallet) ?? 100_000_000n;
  }
  private fakeTx(kind: string): BuiltTx {
    return { transaction: `FAKE-${kind}` as BuiltTx["transaction"], blockhash: "bh", lastValidBlockHeight: 123 };
  }
  async buildRegister(wallet: string, agentId: string, approved: ApprovedRecord) {
    this.built.push({ kind: "register-agent", wallet, agentId, approved });
    return { ...this.fakeTx("register"), meta: { kind: "register-agent" } };
  }
  async buildUpdateVersion(wallet: string, agentId: string, approved: ApprovedRecord) {
    this.built.push({ kind: "update-version", wallet, agentId, approved });
    return this.fakeTx("update-version");
  }
  async buildUpdatePricing(wallet: string, agentId: string, approved: ApprovedRecord) {
    this.built.push({ kind: "update-pricing", wallet, agentId, approved });
    return this.fakeTx("update-pricing");
  }
  async signatureTouchesAgent(signature: string, agentId: string) {
    return this.signatures.get(signature) === agentId;
  }
  async adminAddress() {
    return this.admin;
  }
  async onchainAdmin() {
    return this.onchainAdminAddress;
  }
  async approveAgent(agentId: string) {
    this.calls.push(`approve:${agentId}`);
    this.mustExist(agentId).status = "active";
    return this.sig(agentId, "approve");
  }
  async suspendAgent(agentId: string) {
    this.calls.push(`suspend:${agentId}`);
    if (this.failSuspend) throw new Error("RPC fora do ar");
    this.mustExist(agentId).status = "suspended";
    return this.sig(agentId, "suspend");
  }
  async syncAgent(agentId: string) {
    const a = this.accounts.get(agentId);
    if (a) await this.mirror(this.pda(agentId), this.asAgentAccount(agentId, a));
  }
  async indexSignature(signature: string) {
    const id = this.signatures.get(signature);
    if (id) await this.syncAgent(id);
  }

  private mustExist(agentId: string): Account {
    const a = this.accounts.get(agentId);
    if (!a) throw new Error(`agente ${agentId} não existe na cadeia simulada`);
    return a;
  }

  // ---------- O que o criador e o admin fariam fora do servidor ----------

  /** O criador co-assinou e a transação entrou: devolve a assinatura (ainda sem indexar). */
  land(kind: "register-agent" | "update-version" | "update-pricing", wallet: string, agentId: string, approved: ApprovedRecord): string {
    if (kind === "register-agent") {
      this.accounts.set(agentId, { creator: wallet, version: approved.version, versionHash: approved.versionHash, price: BigInt(approved.priceUsdc), royaltyBps: approved.royaltyBps, status: "pending" });
    } else if (kind === "update-version") {
      const a = this.mustExist(agentId);
      a.version = approved.version;
      a.versionHash = approved.versionHash;
    } else {
      this.mustExist(agentId).price = BigInt(approved.priceUsdc);
    }
    return this.sig(agentId, kind);
  }

  /** O criador chamou update_version/update_pricing DIRETO na cadeia, com valores que a revisão não viu. */
  tamper(agentId: string, over: Partial<Pick<Account, "version" | "versionHash" | "price">>): string {
    Object.assign(this.mustExist(agentId), over);
    return this.sig(agentId, "tamper");
  }

  /** Conta ativa na cadeia sem passar pelo servidor (Solver antigo / admin aprovou por fora). */
  seed(agentId: string, acc: Account) {
    this.accounts.set(agentId, acc);
  }

  asAgentAccount(agentId: string, a: Account): gen.Agent {
    return {
      agentId: Uint8Array.from(Buffer.from(agentId, "hex")),
      creator: a.creator,
      version: a.version,
      versionHash: Uint8Array.from(Buffer.from(a.versionHash, "hex")),
      price: a.price,
      pricePerUse: 0n,
      royaltyBps: a.royaltyBps,
      evalScoreBps: 0,
      evalHash: new Uint8Array(32),
      status: STATUS_CODE[a.status],
      totalSales: 0n,
      verifiedUses: 0n,
      ratingSum: 0n,
      ratingCount: 0,
      disputesLost: 0,
      stake: 0n,
      collection: "ColecaoSimulada",
    } as unknown as gen.Agent;
  }
}
