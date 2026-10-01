import {
  address,
  appendTransactionMessageInstructions,
  assertAccountExists,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  fetchEncodedAccount,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  getTransactionDecoder,
  isSolanaError,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  type Address,
  type Base64EncodedWireTransaction,
  type Instruction,
  type KeyPairSigner,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToCheckedInstruction,
  fetchMaybeToken,
} from "@solana-program/token";
import { getCreateAccountInstruction, getTransferSolInstruction } from "@solana-program/system";
import * as gen from "@solvers/client";
import { agentIdToBytes, RESALE_ERROR_CODES, RESALE_MAX_CUT_BPS, resaleSplit, type ResaleErrorCode } from "@solvers/shared";
import { classifyConfigData, ConfigNotMigratedError, CONFIG_V1_SIZE, type ConfigState } from "./config-state.js";
import { parseEvents, type SolversEvent } from "./events.js";
import { describeFailure } from "./program-errors.js";

export const MPL_CORE_PROGRAM_ADDRESS = address("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
export const PROGRAM_ID = gen.SOLVERS_PROGRAM_ADDRESS as Address;
export { TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS };

export type ChainOptions = {
  rpcUrl: string;
  usdcMint: Address;
  /** Carteira da plataforma que paga taxas e rent (fee payer). */
  feePayer: KeyPairSigner;
  /** Micro-lamports por CU (0 na devnet). */
  priorityFee?: bigint;
};

/** Transação montada pelo servidor, já assinada pelo fee payer, aguardando a assinatura do usuário. */
export type BuiltTx = {
  transaction: Base64EncodedWireTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
  meta?: Record<string, unknown>;
};

/**
 * Em que ponto o envio falhou. Decide se a transação pode ou não ter entrado na rede:
 * - rejected: o RPC recusou na simulação (preflight); nada foi transmitido.
 * - failed: entrou na rede e falhou (sem efeito no estado).
 * - expired: o blockhash venceu sem a transação aparecer; ela não pode mais entrar.
 * - unconfirmed: sem resposta conclusiva (timeout, erro de rede); PODE ter entrado.
 */
export type TxPhase = "rejected" | "failed" | "expired" | "unconfirmed";

export class TxError extends Error {
  constructor(
    message: string,
    public readonly logs: readonly string[] = [],
    public readonly phase?: TxPhase,
    public readonly signature?: Signature,
  ) {
    super(message);
  }
}

/**
 * Erro de domínio da revenda, lançado ANTES de simular/enviar: `code` é um dos `RESALE_ERROR_CODES` (de `@solvers/shared`),
 * que o servidor traduz em HTTP. `details.priceUnits` acompanha `listing_changed` (o preço atual do anúncio).
 */
export class ResaleError extends TxError {
  constructor(
    public readonly code: ResaleErrorCode,
    message: string,
    public readonly details: { priceUnits?: bigint } = {},
  ) {
    super(message);
    this.name = "ResaleError";
  }
}

/** Verdadeiro só quando temos certeza de que a transação não produziu (nem produzirá) efeito. */
export function isDefinitelyNotLanded(e: unknown): boolean {
  return e instanceof TxError && (e.phase === "rejected" || e.phase === "failed" || e.phase === "expired");
}

/** Transação assinada (por inteiro) e pronta para enviar: a assinatura é conhecida antes do envio. */
export type SignedTx = {
  signature: Signature;
  wire: Base64EncodedWireTransaction;
  lastValidBlockHeight: number;
};

/** Resultado de consultar uma assinatura: confirmada, falhou, não pode mais entrar, ou ainda em aberto. */
export type SignatureOutcome = "confirmed" | "failed" | "expired" | "pending";

/** Variação de saldo de uma conta de token causada por uma transação. */
export type TokenDelta = { account: Address; owner: string | null; mint: string; delta: bigint };

type RawTokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } };

/** Diferença entre os saldos de token depois e antes da transação (só contas que mudaram). */
export function parseTokenDeltas(
  accounts: readonly Address[],
  pre: readonly RawTokenBalance[] | null | undefined,
  post: readonly RawTokenBalance[] | null | undefined,
): TokenDelta[] {
  const byIndex = new Map<number, { mint: string; owner: string | null; pre: bigint; post: bigint }>();
  const slot = (b: RawTokenBalance) => {
    let s = byIndex.get(b.accountIndex);
    if (!s) byIndex.set(b.accountIndex, (s = { mint: b.mint, owner: b.owner ?? null, pre: 0n, post: 0n }));
    if (b.owner) s.owner = b.owner;
    return s;
  };
  for (const b of pre ?? []) slot(b).pre = BigInt(b.uiTokenAmount.amount);
  for (const b of post ?? []) slot(b).post = BigInt(b.uiTokenAmount.amount);
  const out: TokenDelta[] = [];
  for (const [idx, s] of byIndex) {
    const account = accounts[idx];
    if (account && s.post !== s.pre) out.push({ account, owner: s.owner, mint: s.mint, delta: s.post - s.pre });
  }
  return out;
}

/** Folga de blocos além do `lastValidBlockHeight` antes de considerar a transação expirada de vez. */
const EXPIRY_MARGIN = 20;

/** Logs, contas e variações de saldo de uma transação confirmada. */
export type TxInfo = {
  logs: readonly string[];
  failed: boolean;
  blockTime: number | null;
  accounts: Address[];
  tokenDeltas: TokenDelta[];
};

/**
 * Resultado de `simulate`:
 * - rejected: a simulação falhou por regra do programa (ou saldo): a operação falharia de verdade; `message` é amigável.
 * - failed: falhou por outro motivo (blockhash, conta ausente, orçamento): não bloqueia, só registrar.
 * - infra: a própria simulação não rodou (RPC fora, timeout): não diz nada sobre a transação.
 */
export type SimulationResult =
  | { ok: true; unitsConsumed: bigint | null }
  | { ok: false; kind: "rejected"; code: number | null; name: string | null; message: string; logs: readonly string[] }
  | { ok: false; kind: "failed"; message: string; logs: readonly string[] }
  | { ok: false; kind: "infra"; message: string };

/** Etapas por garantia no programa (Vec com capacidade fixa: a conta é alocada para o máximo). */
export const MAX_MILESTONES = 5;

/** Tamanho (bytes) de uma conta Escrow no layout v2 = 8 + Escrow::INIT_SPACE. Derivado do cliente gerado. */
export const ESCROW_ACCOUNT_SIZE: number = (() => {
  const ms = Array.from({ length: MAX_MILESTONES }, () => ({
    amount: 0n,
    criteriaHash: new Uint8Array(32),
    status: gen.MilestoneStatus.Pending,
    deliverableHash: new Uint8Array(32),
    passedAt: 0n,
    disputeReasonHash: new Uint8Array(32),
    disputedAt: 0n,
  }));
  const zero = "11111111111111111111111111111111" as Address;
  return gen.getEscrowEncoder().encode({
    buyer: zero,
    agent: zero,
    creator: zero,
    rentPayer: zero,
    nonce: 0n,
    total: 0n,
    milestones: ms,
    reviewWindowSecs: 0n,
    autoReleaseAt: 0n,
    status: gen.EscrowStatus.Active,
    bump: 0,
    vaultBump: 0,
    feeBps: 0,
    deliveryDeadline: 0n,
  }).length;
})();

export type EscrowLayout = { kind: "missing" } | { kind: "legacy"; size: number } | { kind: "ok"; data: gen.Escrow };

const COMPUTE_UNITS = 400_000;

export class SolversChain {
  readonly rpc: Rpc<SolanaRpcApi>;
  readonly programId = PROGRAM_ID;

  constructor(readonly opts: ChainOptions) {
    this.rpc = createSolanaRpc(opts.rpcUrl);
  }

  get feePayer() {
    return this.opts.feePayer;
  }

  get usdcMint() {
    return this.opts.usdcMint;
  }

  // ---------- PDAs e contas ----------

  async programDataAddress() {
    const [pda] = await getProgramDerivedAddress({
      programAddress: address("BPFLoaderUpgradeab1e11111111111111111111111"),
      seeds: [getAddressEncoder().encode(this.programId)],
    });
    return pda;
  }

  async configPda() {
    return (await gen.findConfigPda())[0];
  }

  async agentPda(agentIdHex: string) {
    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programId,
      seeds: [new TextEncoder().encode("agent"), agentIdToBytes(agentIdHex)],
    });
    return pda;
  }

  async reputationPda(wallet: Address) {
    return (await gen.findReputationPda({ buyer: wallet }))[0];
  }

  async creditsPda(agent: Address, owner: Address) {
    return (await gen.findCreditsPda({ agent, buyer: owner }))[0];
  }

  async escrowPda(buyer: Address, agent: Address, nonce: bigint) {
    return (await gen.findEscrowPda({ buyer, agent, nonce }))[0];
  }

  async ata(owner: Address) {
    return (await findAssociatedTokenPda({ owner, mint: this.usdcMint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
  }

  /** Config v2. Numa Config v1 (devnet antes de `migrate_config`) lança `ConfigNotMigratedError`, nunca um erro de codec. */
  async fetchConfig() {
    const acc = await fetchEncodedAccount(this.rpc, await this.configPda());
    if (acc.exists && acc.data.length === CONFIG_V1_SIZE) throw new ConfigNotMigratedError();
    assertAccountExists(acc);
    return gen.decodeConfig(acc);
  }

  /**
   * Lê a Config sem lançar por layout: `missing` | `v1` | `v2` | `unknown` (ver `config-state.ts`). `confirmed` por padrão,
   * para a pausa valer logo depois do `set_pause` (o padrão do RPC é `finalized`, ~13 s atrás).
   */
  async fetchConfigState(commitment: "processed" | "confirmed" | "finalized" = "confirmed"): Promise<ConfigState> {
    const { value } = await this.rpc.getAccountInfo(await this.configPda(), { encoding: "base64", commitment }).send();
    return classifyConfigData(value ? Uint8Array.from(getBase64Encoder().encode(value.data[0])) : null);
  }

  async fetchAgent(agentIdHex: string) {
    return gen.fetchAgent(this.rpc, await this.agentPda(agentIdHex));
  }

  async fetchMaybeAgent(agentIdHex: string) {
    return gen.fetchMaybeAgent(this.rpc, await this.agentPda(agentIdHex));
  }

  async usdcBalance(owner: Address): Promise<bigint> {
    const acc = await fetchMaybeToken(this.rpc, await this.ata(owner));
    return acc.exists ? acc.data.amount : 0n;
  }

  async solBalance(owner: Address): Promise<bigint> {
    const { value } = await this.rpc.getBalance(owner).send();
    return value;
  }

  // ---------- Envio ----------

  /** O fee payer (também mint authority do USDC de teste) nunca pode ser a carteira do usuário. */
  private assertNotFeePayer(user: Address) {
    if (user === this.feePayer.address) throw new TxError("Carteira reservada da plataforma");
  }

  private budget(): Instruction[] {
    const ixs: Instruction[] = [getSetComputeUnitLimitInstruction({ units: COMPUTE_UNITS })];
    if (this.opts.priorityFee && this.opts.priorityFee > 0n) {
      ixs.push(getSetComputeUnitPriceInstruction({ microLamports: this.opts.priorityFee }));
    }
    return ixs;
  }

  /**
   * Monta uma transação para o usuário assinar: o servidor paga a taxa e assina como fee payer
   * (e com keypairs novos, como o do asset). Faltará apenas a assinatura da carteira do usuário.
   */
  async buildForUser(instructions: Instruction[], meta?: Record<string, unknown>): Promise<BuiltTx> {
    const { value: latest } = await this.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(this.feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
      (m) => appendTransactionMessageInstructions([...this.budget(), ...instructions], m),
    );
    const signed = await partiallySignTransactionMessageWithSigners(message);
    return {
      transaction: getBase64EncodedWireTransaction(signed),
      blockhash: latest.blockhash,
      lastValidBlockHeight: Number(latest.lastValidBlockHeight),
      meta,
    };
  }

  /**
   * Simula a transação montada (ainda sem a assinatura do usuário) para descobrir ANTES da assinatura se ela
   * falharia. `sigVerify: false` + `replaceRecentBlockhash: true`: não exige assinaturas e usa um blockhash
   * atual (o da transação pode já ter alguns segundos). Nunca lança: o desfecho vem tipado em `SimulationResult`.
   * `getBase64EncodedWireTransaction` já aceita a transação parcialmente assinada de `buildForUser` (a
   * assinatura que falta vai como 64 bytes zero), então `wire` é o próprio `BuiltTx.transaction`.
   */
  async simulate(wire: Base64EncodedWireTransaction, opts: { timeoutMs?: number } = {}): Promise<SimulationResult> {
    let value: { err: unknown; logs: readonly string[] | null; unitsConsumed?: bigint | number | null };
    try {
      ({ value } = await this.rpc
        .simulateTransaction(wire, {
          encoding: "base64",
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: "confirmed",
        })
        .send({ abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 8000) }));
    } catch (e) {
      // RPC fora do ar, timeout, limite de requisições: não diz nada sobre a transação.
      return { ok: false, kind: "infra", message: rawReason(e) };
    }
    const logs = value.logs ?? [];
    if (value.err == null) return { ok: true, unitsConsumed: value.unitsConsumed == null ? null : BigInt(value.unitsConsumed) };
    // Mesma classificação do envio (friendlyError): o erro vem do programa que falhou PRIMEIRO no log.
    const rejection = describeFailure(value.err, logs);
    if (rejection) return { ok: false, kind: "rejected", ...rejection, logs };
    // Falhou por outro motivo (blockhash, conta ausente, orçamento...): não dá para dizer que é culpa da operação.
    return { ok: false, kind: "failed", message: rawReason(JSON.stringify(value.err, bigintJson)), logs };
  }

  /** Assina tudo no servidor sem enviar: a assinatura fica conhecida antes do envio (para persistir). */
  async signServerTx(instructions: Instruction[]): Promise<SignedTx> {
    const { value: latest } = await this.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(this.feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
      (m) => appendTransactionMessageInstructions([...this.budget(), ...instructions], m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    return {
      signature: getSignatureFromTransaction(signed),
      wire: getBase64EncodedWireTransaction(signed),
      lastValidBlockHeight: Number(latest.lastValidBlockHeight),
    };
  }

  /** Assina tudo no servidor e envia (operações de autoridade: verificador, uso, admin, faucet). */
  async sendAsServer(instructions: Instruction[]): Promise<{ signature: Signature; events: SolversEvent[] }> {
    return this.sendSigned(await this.signServerTx(instructions));
  }

  /**
   * Envia uma transação já assinada e espera a confirmação. `resume` retransmite uma transação que pode já
   * ter sido enviada (sem preflight, ignorando "já processada") e só espera o desfecho.
   * `events: false` dispensa a leitura dos logs (o chamador só precisa da confirmação).
   */
  async sendSigned(tx: SignedTx, opts: { events?: boolean; resume?: boolean } = {}): Promise<{ signature: Signature; events: SolversEvent[] }> {
    return this.sendWire(tx.wire, tx.signature, tx.lastValidBlockHeight, opts);
  }

  /** Recebe a transação já assinada pelo usuário (base64) e transmite. */
  async submitSigned(wireBase64: string): Promise<{ signature: Signature; events: SolversEvent[] }> {
    if (wireBase64.length > 2000) throw new TxError("Transação grande demais");
    let bytes: ReturnType<ReturnType<typeof getBase64Encoder>["encode"]>;
    try {
      bytes = getBase64Encoder().encode(wireBase64);
    } catch {
      throw new TxError("Transação em formato inválido");
    }
    const tx = getTransactionDecoder().decode(bytes);
    const feePayerSig = tx.signatures[this.feePayer.address];
    if (!feePayerSig) throw new TxError("Transação não foi montada por este servidor");
    for (const [signer, sig] of Object.entries(tx.signatures)) {
      if (!sig) throw new TxError(`Falta a assinatura de ${signer}`);
    }
    const signature = getBase58Decoder().decode(feePayerSig) as Signature;
    const height = await this.rpc.getBlockHeight({ commitment: "confirmed" }).send();
    return this.sendWire(wireBase64 as Base64EncodedWireTransaction, signature, Number(height) + 150);
  }

  private async sendWire(
    wire: Base64EncodedWireTransaction,
    signature: Signature,
    lastValidBlockHeight: number,
    opts: { events?: boolean; resume?: boolean } = {},
  ): Promise<{ signature: Signature; events: SolversEvent[] }> {
    // Na devnet transações somem com frequência: reenvia (sem preflight) enquanto aguarda.
    const resend = () =>
      this.rpc
        .sendTransaction(wire, { encoding: "base64", skipPreflight: true, maxRetries: 0n })
        .send()
        .catch(() => undefined);
    if (opts.resume) {
      await resend();
    } else {
      try {
        await this.rpc.sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed" }).send();
      } catch (e) {
        const logs = extractLogs(e);
        // Só a recusa do preflight garante que nada foi transmitido; erro de rede pode ter chegado ao RPC.
        const phase: TxPhase = isSolanaError(e, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE) ? "rejected" : "unconfirmed";
        throw new TxError(friendlyError(e, logs), logs, phase, signature);
      }
    }
    try {
      await this.waitConfirmed(signature, lastValidBlockHeight, resend);
    } catch (e) {
      if (e instanceof TxError) throw e;
      // Falha ao consultar o RPC: não sabemos o desfecho.
      throw new TxError(e instanceof Error ? e.message : String(e), [], "unconfirmed", signature);
    }
    if (opts.events === false) return { signature, events: [] };
    // Já confirmada: não conseguir ler os logs a tempo não pode virar erro (o indexador reprocessa pela assinatura).
    const events = await this.eventsOf(signature).catch(() => [] as SolversEvent[]);
    return { signature, events };
  }

  async waitConfirmed(signature: Signature, lastValidBlockHeight: number, resend?: () => Promise<unknown>): Promise<void> {
    for (let i = 0; i < 120; i++) {
      if (resend && i > 0 && i % 4 === 0) void resend();
      const { value } = await this.rpc.getSignatureStatuses([signature]).send();
      const st = value[0];
      if (st?.err) throw new TxError(`Transação falhou: ${JSON.stringify(st.err, bigintJson)}`, [], "failed", signature);
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
      if (i % 10 === 9) {
        const outcome = await this.signatureOutcome(signature, lastValidBlockHeight);
        if (outcome === "confirmed") return;
        if (outcome === "failed") throw new TxError("Transação falhou na rede", [], "failed", signature);
        if (outcome === "expired") throw new TxError("Transação expirou antes de confirmar", [], "expired", signature);
      }
      await sleep(500);
    }
    throw new TxError("Tempo esgotado aguardando confirmação", [], "unconfirmed", signature);
  }

  /**
   * Desfecho de uma assinatura já enviada: confirmada, falhou, expirada (blockhash vencido e nunca vista:
   * não pode mais entrar) ou ainda em aberto. Busca também no histórico para não perder transações antigas.
   */
  async signatureOutcome(signature: Signature, lastValidBlockHeight: number): Promise<SignatureOutcome> {
    const { value } = await this.rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send();
    const st = value[0];
    if (st) {
      if (st.err) return "failed";
      if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return "confirmed";
    }
    const height = await this.rpc.getBlockHeight({ commitment: "confirmed" }).send();
    return Number(height) > lastValidBlockHeight + EXPIRY_MARGIN ? "expired" : "pending";
  }

  /** Logs, contas e variações de saldo de uma transação confirmada (null se ainda não visível no RPC). */
  async txLogs(signature: Signature): Promise<TxInfo | null> {
    // Versão 1 aceita legacy, v0 e v1: com 0 o RPC rejeita (-32015) uma tx v1 de terceiro que chame o programa.
    const tx = await this.rpc
      .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1, encoding: "json" })
      .send();
    if (!tx) return null;
    const keys = tx.transaction.message.accountKeys as readonly Address[];
    const loaded = tx.meta?.loadedAddresses;
    const accounts = [...keys, ...((loaded?.writable ?? []) as Address[]), ...((loaded?.readonly ?? []) as Address[])];
    return {
      logs: tx.meta?.logMessages ?? [],
      failed: tx.meta?.err != null,
      blockTime: tx.blockTime == null ? null : Number(tx.blockTime),
      accounts,
      tokenDeltas: parseTokenDeltas(
        accounts,
        tx.meta?.preTokenBalances as unknown as readonly RawTokenBalance[] | undefined,
        tx.meta?.postTokenBalances as unknown as readonly RawTokenBalance[] | undefined,
      ),
    };
  }

  async eventsOf(signature: Signature): Promise<SolversEvent[]> {
    for (let i = 0; i < 20; i++) {
      const tx = await this.txLogs(signature);
      if (tx) return tx.failed ? [] : parseEvents(tx.logs, this.programId);
      await sleep(500);
    }
    throw new TxError(`Transação ${signature} confirmada mas ainda não visível no RPC`);
  }

  // ---------- USDC de teste ----------

  /** Cria o mint de USDC de teste (6 casas) com o fee payer como mint authority. */
  async createTestMint(mint: KeyPairSigner): Promise<Signature> {
    const space = BigInt(getMintSize());
    const lamports = await this.rpc.getMinimumBalanceForRentExemption(space).send();
    const { signature } = await this.sendAsServer([
      getCreateAccountInstruction({
        payer: this.feePayer,
        newAccount: mint,
        lamports,
        space,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeMint2Instruction({ mint: mint.address, decimals: 6, mintAuthority: this.feePayer.address }),
    ]);
    return signature;
  }

  async ensureAtaIx(owner: Address): Promise<Instruction> {
    return getCreateAssociatedTokenIdempotentInstruction({
      payer: this.feePayer,
      owner,
      mint: this.usdcMint,
      ata: await this.ata(owner),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
  }

  /** Faucet assinado mas ainda não enviado: quem precisa de idempotência grava a assinatura antes de enviar. */
  async signFaucetTx(owner: Address, units: bigint): Promise<SignedTx> {
    return this.signServerTx([
      await this.ensureAtaIx(owner),
      getMintToCheckedInstruction({
        mint: this.usdcMint,
        token: await this.ata(owner),
        mintAuthority: this.feePayer,
        amount: units,
        decimals: 6,
      }),
    ]);
  }

  /** Faucet: emite USDC de teste para uma carteira (só funciona com o mint de teste próprio). */
  async faucet(owner: Address, units: bigint): Promise<Signature> {
    const { signature } = await this.sendSigned(await this.signFaucetTx(owner, units), { events: false });
    return signature;
  }

  transferSolIx(to: Address, lamports: bigint): Instruction {
    return getTransferSolInstruction({ source: this.feePayer, destination: to, amount: lamports });
  }

  // ---------- Montadores de instruções ----------

  async initializeConfigIxs(
    admin: TransactionSigner,
    treasuryOwner: Address,
    params: { verifier: Address; usageAuthority: Address; feeBps: number; minStake: bigint; minPrice: bigint },
  ): Promise<Instruction[]> {
    return [
      await this.ensureAtaIx(treasuryOwner),
      await gen.getInitializeConfigInstructionAsync({
        admin,
        programData: await this.programDataAddress(),
        usdcMint: this.usdcMint,
        treasury: await this.ata(treasuryOwner),
        args: params,
      }),
    ];
  }

  async updateConfigIx(
    admin: TransactionSigner,
    params: { verifier: Address; usageAuthority: Address; feeBps: number; minStake: bigint; minPrice: bigint },
  ): Promise<Instruction> {
    return gen.getUpdateConfigInstructionAsync({ admin, args: params });
  }

  async registerAgentIxs(input: {
    creator: TransactionSigner;
    agentIdHex: string;
    name: string;
    metadataUri: string;
    version: string;
    versionHash: Uint8Array;
    price: bigint;
    pricePerUse: bigint;
    royaltyBps: number;
  }): Promise<{ instructions: Instruction[]; collection: Address; agent: Address }> {
    const collection = await generateKeyPairSigner();
    const agent = await this.agentPda(input.agentIdHex);
    const ix = await gen.getRegisterAgentInstructionAsync({
      payer: this.feePayer,
      creator: input.creator,
      agent,
      collection,
      creatorUsdc: await this.ata(input.creator.address),
      usdcMint: this.usdcMint,
      agentId: agentIdToBytes(input.agentIdHex),
      name: truncateUtf8(input.name, 32),
      metadataUri: input.metadataUri,
      version: input.version,
      versionHash: input.versionHash,
      price: input.price,
      pricePerUse: input.pricePerUse,
      royaltyBps: input.royaltyBps,
    });
    return { instructions: [await this.ensureAtaIx(input.creator.address), ix], collection: collection.address, agent };
  }

  async approveAgentIx(admin: TransactionSigner, agentIdHex: string) {
    return gen.getApproveAgentInstructionAsync({ admin, agent: await this.agentPda(agentIdHex) });
  }

  async suspendAgentIx(admin: TransactionSigner, agentIdHex: string) {
    return gen.getSuspendAgentInstructionAsync({ admin, agent: await this.agentPda(agentIdHex) });
  }

  // ---------- Governança do admin (rotação em 2 etapas, tesouraria) e reposição de stake ----------

  async pendingAdminPda() {
    return (await gen.findPendingAdminPda({ config: await this.configPda() }))[0];
  }

  /** Proposta de troca de admin em andamento (null se não há). */
  async fetchMaybePendingAdmin() {
    return gen.fetchMaybePendingAdmin(this.rpc, await this.pendingAdminPda());
  }

  /** Passo 1: o admin atual indica o novo. O fee payer da plataforma paga o rent da proposta (devolvido ao fechar). */
  async proposeAdminIx(admin: TransactionSigner, newAdmin: Address) {
    return gen.getProposeAdminInstructionAsync({ payer: this.feePayer, admin, newAdmin });
  }

  /** Passo 2: quem foi indicado aceita. `rentPayer` = quem pagou a proposta (`PendingAdmin.rentPayer`); recebe o rent de volta. */
  async acceptAdminIx(newAdmin: TransactionSigner, rentPayer: Address) {
    return gen.getAcceptAdminInstructionAsync({ newAdmin, rentPayer });
  }

  /** O admin atual desiste da proposta. `rentPayer` como em `acceptAdminIx`. */
  async cancelAdminTransferIx(admin: TransactionSigner, rentPayer: Address) {
    return gen.getCancelAdminTransferInstructionAsync({ admin, rentPayer });
  }

  /** Troca a conta de USDC da tesouraria: `newTreasury` é a conta de token (não o dono). */
  async setTreasuryIx(admin: TransactionSigner, newTreasury: Address) {
    return gen.getSetTreasuryInstructionAsync({ admin, usdcMint: this.usdcMint, newTreasury });
  }

  /**
   * Migra a Config v1 (187 B) para a v2 (285 B). `payer` (o fee payer) paga o rent extra; `authority` precisa ser a
   * upgrade authority do programa (a mesma regra de `initialize_config`). Instrução de transição.
   */
  async migrateConfigIx(authority: TransactionSigner) {
    return gen.getMigrateConfigInstructionAsync({ payer: this.feePayer, authority, programData: await this.programDataAddress() });
  }

  /** Pausa de emergência: o admin define qualquer combinação de bits; o guardian só acrescenta (nunca remove). */
  async setPauseIx(signer: TransactionSigner, flags: number) {
    return gen.getSetPauseInstructionAsync({ signer, flags });
  }

  /** Define o guardian da pausa (só o admin). Endereço de sistema (`11111111111111111111111111111111`) remove o guardian. */
  async setGuardianIx(admin: TransactionSigner, newGuardian: Address) {
    return gen.getSetGuardianInstructionAsync({ admin, newGuardian });
  }

  // ---------- Stake: saída do criador e confisco com prazo (o admin propõe, espera 72 h, executa) ----------

  /** Proposta de confisco do solver (null se não há). */
  async fetchMaybeSlashProposal(agentIdHex: string) {
    return gen.fetchMaybeSlashProposal(this.rpc, (await gen.findSlashProposalPda({ agent: await this.agentPda(agentIdHex) }))[0]);
  }

  /** Pedido de saída de stake do solver (null se não pediu). */
  async fetchMaybeStakeExit(agentIdHex: string) {
    return gen.fetchMaybeStakeExit(this.rpc, (await gen.findStakeExitPda({ agent: await this.agentPda(agentIdHex) }))[0]);
  }

  /** Admin propõe confiscar `amount` (suspende o solver na hora; executável só depois de 72 h). O fee payer paga o rent da proposta. */
  async proposeSlashIx(admin: TransactionSigner, agentIdHex: string, amount: bigint, reasonHash: Uint8Array) {
    return gen.getProposeSlashInstructionAsync({ payer: this.feePayer, admin, agent: await this.agentPda(agentIdHex), amount, reasonHash });
  }

  /** Admin executa depois das 72 h. `treasury` = `Config.treasury`; o rent da proposta volta a `rentPayer` (`SlashProposal.rentPayer`). */
  async executeSlashIx(admin: TransactionSigner, agentIdHex: string, treasury: Address, rentPayer: Address) {
    return gen.getExecuteSlashInstructionAsync({ admin, agent: await this.agentPda(agentIdHex), treasury, usdcMint: this.usdcMint, rentPayer });
  }

  /** Desiste da proposta (o solver segue suspenso até `approve_agent`). `signer`: o admin quando quiser, ou o criador depois da expiração (72 h + 14 dias). */
  async cancelSlashIx(signer: TransactionSigner, agentIdHex: string, rentPayer: Address) {
    return gen.getCancelSlashInstructionAsync({ signer, agent: await this.agentPda(agentIdHex), rentPayer });
  }

  /** Admin estende em 30 dias a espera da saída de stake (máximo 2 vezes). */
  async extendStakeExitIx(admin: TransactionSigner, agentIdHex: string, reasonHash: Uint8Array) {
    return gen.getExtendStakeExitInstructionAsync({ admin, agent: await this.agentPda(agentIdHex), reasonHash });
  }

  /** O criador repõe stake do próprio solver, a partir da conta de USDC (ATA) dele. Reativar o solver ainda exige `approve_agent`. */
  async topUpStakeIx(creator: TransactionSigner, agentIdHex: string, amount: bigint) {
    return gen.getTopUpStakeInstructionAsync({
      creator,
      agent: await this.agentPda(agentIdHex),
      creatorUsdc: await this.ata(creator.address),
      usdcMint: this.usdcMint,
      amount,
    });
  }

  async setEvalIx(verifier: TransactionSigner, agentIdHex: string, scoreBps: number, evalHash: Uint8Array) {
    return gen.getSetEvalInstructionAsync({
      verifier,
      agent: await this.agentPda(agentIdHex),
      evalScoreBps: scoreBps,
      evalHash,
    });
  }

  async updateVersionIx(creator: TransactionSigner, agentIdHex: string, version: string, versionHash: Uint8Array) {
    return gen.getUpdateVersionInstruction({ creator, agent: await this.agentPda(agentIdHex), version, versionHash });
  }

  /** `expectedPrice` = preço mostrado ao comprador; se mudar antes da execução, a compra falha. */
  async purchaseLicenseIxs(
    buyer: Address,
    agentIdHex: string,
    expectedPrice?: bigint,
  ): Promise<{ instructions: Instruction[]; asset: KeyPairSigner; price: bigint }> {
    this.assertNotFeePayer(buyer);
    const agentAddr = await this.agentPda(agentIdHex);
    const agent = await gen.fetchAgent(this.rpc, agentAddr);
    const price = expectedPrice ?? agent.data.price;
    const config = await this.fetchConfig();
    const asset = await generateKeyPairSigner();
    const ix = await gen.getPurchaseLicenseInstructionAsync({
      payer: this.feePayer,
      buyer: createNoopSigner(buyer),
      agent: agentAddr,
      collection: agent.data.collection,
      asset,
      buyerUsdc: await this.ata(buyer),
      creatorUsdc: agent.data.creatorUsdc,
      treasury: config.data.treasury,
      usdcMint: this.usdcMint,
      expectedPrice: price,
    });
    return { instructions: [ix], asset, price };
  }

  // ---------- Revenda de licenças ----------

  /** PDA `market_authority`: o `TransferDelegate` de todo asset anunciado. */
  async marketAuthorityPda() {
    return (await gen.findMarketAuthorityPda())[0];
  }

  /** PDA do anúncio de revenda de um asset (um por asset). */
  async listingPda(asset: Address) {
    return (await gen.findListingPda({ asset }))[0];
  }

  /** Lê o anúncio de um asset em `confirmed` (venda ou cancelamento recém-feitos já contam); `null` se não existe. */
  async fetchMaybeListing(asset: Address): Promise<gen.Listing | null> {
    const acc = await gen.fetchMaybeListing(this.rpc, await this.listingPda(asset), { commitment: "confirmed" });
    return acc.exists ? acc.data : null;
  }

  /** Dono, coleção e `TransferDelegate` de um asset em `confirmed`; `null` se não é um asset vivo do mpl-core. */
  async fetchCoreLicense(asset: Address): Promise<CoreLicense | null> {
    const { value } = await this.rpc.getAccountInfo(asset, { encoding: "base64", commitment: "confirmed" }).send();
    if (!value || value.owner !== MPL_CORE_PROGRAM_ADDRESS) return null;
    try {
      return decodeCoreLicense(Uint8Array.from(getBase64Encoder().encode(value.data[0])));
    } catch {
      throw new ResaleError(RESALE_ERROR_CODES.licenseInvalid, "Não foi possível ler esta licença na blockchain.");
    }
  }

  /** O solver (conta `Agent`) dono de uma coleção de licenças. Varre as contas do programa: prefira passar o agent id. */
  async fetchAgentByCollection(collection: Address): Promise<{ address: Address; data: gen.Agent } | null> {
    const b58 = getBase58Decoder();
    const res = await this.rpc
      .getProgramAccounts(this.programId, {
        encoding: "base64",
        commitment: "confirmed",
        filters: [
          { memcmp: { offset: 0n, bytes: b58.decode(Uint8Array.from(gen.AGENT_DISCRIMINATOR)) as never, encoding: "base58" } },
          // 8 (discriminador) + 16 (agent_id) + 32 (creator).
          { memcmp: { offset: 56n, bytes: b58.decode(getAddressEncoder().encode(collection)) as never, encoding: "base58" } },
        ],
      })
      .send();
    for (const r of res) {
      const data = gen.getAgentDecoder().decode(Uint8Array.from(getBase64Encoder().encode(r.account.data[0])));
      if (data.collection === collection) return { address: r.pubkey, data };
    }
    return null;
  }

  private async fetchAgentAccount(agentIdHex: string): Promise<{ address: Address; data: gen.Agent } | null> {
    const address = await this.agentPda(agentIdHex);
    const acc = await gen.fetchMaybeAgent(this.rpc, address, { commitment: "confirmed" });
    return acc.exists ? { address, data: acc.data } : null;
  }

  /**
   * Anunciar uma licença à venda. O vendedor assina (o `AddPlugin`/`Approve` do mpl-core é dele) e a plataforma paga o rent
   * do anúncio. Se já existe um anúncio VELHO do asset (o dono mudou, o delegate foi revogado ou resetado), um
   * `cancel_listing` assinado pelo vendedor vai antes do `list_license`, na mesma transação. Anúncio ainda válido:
   * `already_listed`. `opts.agentIdHex` evita a busca da coleção entre as contas do programa.
   * Valida preço mínimo e teto de corte antes da simulação, espelhando o programa.
   */
  async listLicenseIxs(seller: Address, asset: Address, priceUnits: bigint, opts: { agentIdHex?: string } = {}): Promise<ListLicenseIxsResult> {
    this.assertNotFeePayer(seller);
    const core = await this.fetchCoreLicense(asset);
    if (!core || !core.collection) {
      throw new ResaleError(RESALE_ERROR_CODES.licenseInvalid, "Esta licença não foi encontrada na blockchain.");
    }
    if (core.owner !== seller) {
      throw new ResaleError(RESALE_ERROR_CODES.notOwner, "Esta licença não está na sua carteira.");
    }
    const agent = opts.agentIdHex ? await this.fetchAgentAccount(opts.agentIdHex) : await this.fetchAgentByCollection(core.collection);
    if (!agent || agent.data.collection !== core.collection) {
      throw new ResaleError(RESALE_ERROR_CODES.licenseInvalid, "Esta licença não pertence a um especialista da plataforma.");
    }
    if (agent.data.creator === seller) {
      throw new ResaleError(RESALE_ERROR_CODES.creatorCannotResell, "O criador não pode revender licenças do próprio especialista.");
    }
    const config = await this.fetchConfig();
    if (priceUnits <= 0n || priceUnits < config.data.minPrice) {
      throw new ResaleError(RESALE_ERROR_CODES.priceTooLow, "O preço está abaixo do mínimo da plataforma.");
    }
    if (priceUnits > U64_MAX) throw new TxError("O preço informado é grande demais.");
    const feeBps = config.data.feeBps;
    const royaltyBps = agent.data.royaltyBps;
    if (royaltyBps + feeBps > RESALE_MAX_CUT_BPS) {
      throw new ResaleError(
        RESALE_ERROR_CODES.cutTooHigh,
        "O royalty do criador somado à taxa da plataforma passa de 50% do preço: esta licença não pode ser anunciada agora.",
      );
    }

    const instructions: Instruction[] = [];
    const existing = await this.fetchMaybeListing(asset);
    if (existing) {
      if (listingIsLive(existing, core, agent.data.collection, await this.marketAuthorityPda())) {
        throw new ResaleError(RESALE_ERROR_CODES.alreadyListed, "Esta licença já está anunciada.");
      }
      // Anúncio velho: fecha antes de abrir o novo. O vendedor (novo dono) pode: terceiros só precisam de `!live` e o
      // vendedor antigo não faz CPI com o anúncio morto. O rent volta ao `rent_payer` gravado.
      instructions.push(
        await gen.getCancelListingInstructionAsync({
          payer: this.feePayer,
          canceller: createNoopSigner(seller),
          agent: existing.agent,
          collection: agent.data.collection,
          asset,
          rentPayer: existing.rentPayer,
        }),
      );
    }
    instructions.push(
      await gen.getListLicenseInstructionAsync({
        payer: this.feePayer,
        seller: createNoopSigner(seller),
        agent: agent.address,
        collection: agent.data.collection,
        asset,
        price: priceUnits,
      }),
    );
    return {
      instructions,
      listing: await this.listingPda(asset),
      agent: agent.address,
      feeBps,
      royaltyBps,
      replacedStaleListing: existing !== null,
    };
  }

  /**
   * Comprar uma licença anunciada. `expectedPriceUnits` é o preço mostrado ao comprador: se o anúncio mudou, `listing_changed`
   * (preço atual em `details.priceUnits`). A ATA de USDC do VENDEDOR vem antes, idempotente e com rent da plataforma,
   * porque o programa a exige inicializada; a do comprador não é criada (sem ela ele não tem saldo, como em `purchaseLicenseIxs`).
   */
  async buyListingIxs(buyer: Address, asset: Address, expectedPriceUnits: bigint): Promise<BuyListingIxsResult> {
    this.assertNotFeePayer(buyer);
    const listing = await this.fetchMaybeListing(asset);
    if (!listing) throw new ResaleError(RESALE_ERROR_CODES.listingNotFound, "Este anúncio não existe mais.");
    if (listing.seller === buyer) {
      throw new ResaleError(RESALE_ERROR_CODES.ownListing, "Você não pode comprar a sua própria licença anunciada.");
    }
    if (listing.price !== expectedPriceUnits) {
      throw new ResaleError(RESALE_ERROR_CODES.listingChanged, "O preço do anúncio mudou. Atualize a página para ver o novo valor.", {
        priceUnits: listing.price,
      });
    }
    const agent = await gen.fetchMaybeAgent(this.rpc, listing.agent, { commitment: "confirmed" });
    if (!agent.exists) throw new ResaleError(RESALE_ERROR_CODES.listingNotFound, "Este anúncio não existe mais.");
    const config = await this.fetchConfig();
    if (agent.data.status !== gen.AgentStatus.Active || agent.data.stake < config.data.minStake) {
      throw new ResaleError(RESALE_ERROR_CODES.agentUnavailable, "Este especialista não está disponível para compra agora.");
    }
    const core = await this.fetchCoreLicense(asset);
    if (!listingIsLive(listing, core, agent.data.collection, await this.marketAuthorityPda())) {
      throw new ResaleError(RESALE_ERROR_CODES.listingNotFound, "Este anúncio não vale mais: a licença mudou de carteira ou a venda foi cancelada.");
    }
    let split: { royalty: bigint; fee: bigint; seller: bigint };
    try {
      split = resaleSplit(listing.price, listing.royaltyBps, listing.feeBps);
    } catch {
      throw new ResaleError(RESALE_ERROR_CODES.cutTooHigh, "Este anúncio não pode ser comprado: royalty mais taxa passam do teto.");
    }
    const ix = await gen.getBuyListingInstructionAsync({
      payer: this.feePayer,
      buyer: createNoopSigner(buyer),
      agent: listing.agent,
      collection: agent.data.collection,
      asset,
      buyerUsdc: await this.ata(buyer),
      sellerUsdc: await this.ata(listing.seller),
      creatorUsdc: agent.data.creatorUsdc,
      treasury: config.data.treasury,
      usdcMint: this.usdcMint,
      rentPayer: listing.rentPayer,
      expectedPrice: expectedPriceUnits,
    });
    return {
      instructions: [await this.ensureAtaIx(listing.seller), ix],
      seller: listing.seller,
      agent: listing.agent,
      listing: await this.listingPda(asset),
      priceUnits: listing.price,
      royaltyUnits: split.royalty,
      feeUnits: split.fee,
      sellerUnits: split.seller,
    };
  }

  /**
   * Cancelar um anúncio. O vendedor cancela sempre; outra carteira só fecha anúncio VELHO (`not_owner` se ainda vale).
   * No cancelamento do vendedor com anúncio vivo o rent do plugin volta ao `payer` e o programa exige que ele seja o
   * `rent_payer` gravado: se este não for o fee payer atual, `cancel_via_wallet` (o vendedor revoga o delegate na carteira).
   */
  async cancelListingIxs(canceller: Address, asset: Address): Promise<CancelListingIxsResult> {
    this.assertNotFeePayer(canceller);
    const listing = await this.fetchMaybeListing(asset);
    if (!listing) throw new ResaleError(RESALE_ERROR_CODES.listingNotFound, "Este anúncio não existe mais.");
    const agent = await gen.fetchMaybeAgent(this.rpc, listing.agent, { commitment: "confirmed" });
    if (!agent.exists) throw new ResaleError(RESALE_ERROR_CODES.listingNotFound, "Este anúncio não existe mais.");
    const core = await this.fetchCoreLicense(asset);
    const live = listingIsLive(listing, core, agent.data.collection, await this.marketAuthorityPda());
    if (canceller !== listing.seller && live) {
      throw new ResaleError(RESALE_ERROR_CODES.notOwner, "Este anúncio ainda está valendo: só quem o publicou pode cancelá-lo.");
    }
    if (canceller === listing.seller && live && listing.rentPayer !== this.feePayer.address) {
      throw new ResaleError(
        RESALE_ERROR_CODES.cancelViaWallet,
        "Este anúncio foi aberto por outra conta da plataforma. Para cancelar, revogue a permissão de venda direto na sua carteira.",
      );
    }
    const ix = await gen.getCancelListingInstructionAsync({
      payer: this.feePayer,
      canceller: createNoopSigner(canceller),
      agent: listing.agent,
      collection: agent.data.collection,
      asset,
      rentPayer: listing.rentPayer,
    });
    return { instructions: [ix], listing: await this.listingPda(asset), seller: listing.seller, stale: !live };
  }

  async buyCreditsIxs(buyer: Address, agentIdHex: string, amount: number, maxTotal?: bigint): Promise<Instruction[]> {
    this.assertNotFeePayer(buyer);
    const agentAddr = await this.agentPda(agentIdHex);
    const agent = await gen.fetchAgent(this.rpc, agentAddr);
    const config = await this.fetchConfig();
    return [
      await gen.getBuyCreditsInstructionAsync({
        payer: this.feePayer,
        buyer: createNoopSigner(buyer),
        agent: agentAddr,
        buyerUsdc: await this.ata(buyer),
        creatorUsdc: agent.data.creatorUsdc,
        treasury: config.data.treasury,
        usdcMint: this.usdcMint,
        amount,
        maxTotal: maxTotal ?? agent.data.pricePerUse * BigInt(amount),
      }),
    ];
  }

  async consumeCreditIx(usageAuthority: TransactionSigner, agentIdHex: string, owner: Address) {
    const agent = await this.agentPda(agentIdHex);
    return gen.getConsumeCreditInstructionAsync({
      usageAuthority,
      agent,
      credits: await this.creditsPda(agent, owner),
    });
  }

  async recordUsageBatchIx(usageAuthority: TransactionSigner, agentIdHex: string, count: bigint, merkleRoot: Uint8Array) {
    return gen.getRecordUsageBatchInstructionAsync({
      usageAuthority,
      agent: await this.agentPda(agentIdHex),
      count,
      merkleRoot,
    });
  }

  async submitReviewIxs(
    author: Address,
    agentIdHex: string,
    rating: number,
    contentHash: Uint8Array,
    proof: { licenseAsset?: Address; hasCredits?: boolean },
  ): Promise<Instruction[]> {
    this.assertNotFeePayer(author);
    const agent = await this.agentPda(agentIdHex);
    if (proof.licenseAsset) {
      return [
        await gen.getSubmitReviewInstructionAsync({
          payer: this.feePayer,
          author: createNoopSigner(author),
          agent,
          licenseAsset: proof.licenseAsset,
          rating,
          contentHash,
        }),
      ];
    }
    if (!proof.hasCredits) throw new TxError("Avaliação exige licença ou créditos");
    return [
      await gen.getSubmitReviewWithCreditsInstructionAsync({
        payer: this.feePayer,
        author: createNoopSigner(author),
        agent,
        credits: await this.creditsPda(agent, author),
        rating,
        contentHash,
      }),
    ];
  }

  async createEscrowIxs(
    buyer: Address,
    agentIdHex: string,
    nonce: bigint,
    milestones: { amount: bigint; criteriaHash: Uint8Array }[],
    reviewWindowSecs: bigint,
    /** Prazo de entrega em dias (programa v2): 0 usa o padrão do programa (14); máximo 60. */
    deliveryDays = 0,
  ): Promise<{ instructions: Instruction[]; escrow: Address }> {
    this.assertNotFeePayer(buyer);
    const agent = await this.agentPda(agentIdHex);
    const escrow = await this.escrowPda(buyer, agent, nonce);
    const ix = await gen.getCreateEscrowInstructionAsync({
      payer: this.feePayer,
      buyer: createNoopSigner(buyer),
      agent,
      escrow,
      buyerUsdc: await this.ata(buyer),
      usdcMint: this.usdcMint,
      nonce,
      milestones,
      reviewWindowSecs,
      deliveryDays,
    });
    return { instructions: [ix], escrow };
  }

  async markPassedIx(verifier: TransactionSigner, escrow: Address, index: number, deliverableHash: Uint8Array) {
    return gen.getMarkPassedInstructionAsync({ verifier, escrow, index, deliverableHash });
  }

  private async escrowContext(escrowAddr: Address) {
    const escrow = await gen.fetchEscrow(this.rpc, escrowAddr);
    const agent = await gen.fetchAgent(this.rpc, escrow.data.agent);
    const config = await this.fetchConfig();
    return { escrow, agent, config };
  }

  /** Recria (idempotente) a ATA de USDC de alguém caso tenha sido fechada. */
  private async ensureAtaFor(owner: Address): Promise<Instruction> {
    return this.ensureAtaIx(owner);
  }

  /** caller = comprador (aprovação) ou qualquer signer (liberação automática). */
  async releaseMilestoneIxs(caller: TransactionSigner, escrowAddr: Address, index: number): Promise<Instruction[]> {
    const { escrow, agent, config } = await this.escrowContext(escrowAddr);
    return [
      await this.ensureAtaFor(agent.data.creator),
      await gen.getReleaseMilestoneInstructionAsync({
        caller,
        agent: escrow.data.agent,
        escrow: escrowAddr,
        creatorUsdc: agent.data.creatorUsdc,
        treasury: config.data.treasury,
        usdcMint: this.usdcMint,
        index,
      }),
    ];
  }

  async resolveDisputeIxs(admin: TransactionSigner, escrowAddr: Address, index: number, refund: boolean): Promise<Instruction[]> {
    const { escrow, agent, config } = await this.escrowContext(escrowAddr);
    return [
      await this.ensureAtaFor(agent.data.creator),
      await this.ensureAtaFor(escrow.data.buyer),
      await gen.getResolveDisputeInstructionAsync({
        admin,
        agent: escrow.data.agent,
        escrow: escrowAddr,
        creatorUsdc: agent.data.creatorUsdc,
        treasury: config.data.treasury,
        buyerUsdc: await this.ata(escrow.data.buyer),
        buyerReputation: await this.reputationPda(escrow.data.buyer),
        usdcMint: this.usdcMint,
        index,
        refund,
      }),
    ];
  }

  async openDisputeIx(buyer: Address, escrow: Address, index: number, reasonHash: Uint8Array) {
    return gen.getOpenDisputeInstructionAsync({
      buyer: createNoopSigner(buyer),
      escrow,
      reputation: await this.reputationPda(buyer),
      index,
      reasonHash,
    });
  }

  /** O comprador recebe de volta (sem taxa) uma etapa ainda pendente depois do prazo de entrega. */
  async cancelUndeliveredIxs(buyer: Address, escrowAddr: Address, index: number): Promise<Instruction[]> {
    this.assertNotFeePayer(buyer);
    return [
      // A ATA do comprador pode ter sido fechada: recria (idempotente, a plataforma paga o rent).
      await this.ensureAtaFor(buyer),
      await gen.getCancelUndeliveredInstructionAsync({
        buyer: createNoopSigner(buyer),
        escrow: escrowAddr,
        buyerUsdc: await this.ata(buyer),
        usdcMint: this.usdcMint,
        index,
      }),
    ];
  }

  /**
   * Disputa parada além do prazo de julgamento: qualquer carteira (aqui, o servidor) devolve o valor
   * ao comprador. `caller` paga a taxa da transação; não precisa ser o comprador nem o admin.
   */
  async resolveStaleDisputeIxs(caller: TransactionSigner, escrowAddr: Address, index: number): Promise<Instruction[]> {
    const escrow = await gen.fetchEscrow(this.rpc, escrowAddr);
    return [
      await this.ensureAtaFor(escrow.data.buyer),
      await gen.getResolveStaleDisputeInstructionAsync({
        caller,
        escrow: escrowAddr,
        buyerUsdc: await this.ata(escrow.data.buyer),
        usdcMint: this.usdcMint,
        index,
      }),
    ];
  }

  /**
   * Lê um escrow e diz em que layout está. O cliente v2 DECODIFICA sem erro uma conta v1 (740 bytes, com
   * padding: fee_bps 0, prazo 0 e disputed_at lido do lugar errado), então o layout só se reconhece pelo
   * TAMANHO: contas v2 têm ESCROW_ACCOUNT_SIZE bytes. "legacy" nunca deve ser espelhado nem usado em transação.
   */
  async fetchEscrowLayout(escrowAddr: Address): Promise<EscrowLayout> {
    const { value } = await this.rpc.getAccountInfo(escrowAddr, { encoding: "base64" }).send();
    if (!value) return { kind: "missing" };
    const bytes = Uint8Array.from(getBase64Encoder().encode(value.data[0]));
    if (value.owner !== this.programId || bytes.length !== ESCROW_ACCOUNT_SIZE) return { kind: "legacy", size: bytes.length };
    return { kind: "ok", data: gen.getEscrowDecoder().decode(bytes) };
  }

  async closeEscrowIxs(caller: TransactionSigner, escrowAddr: Address): Promise<Instruction[]> {
    const escrow = await gen.fetchEscrow(this.rpc, escrowAddr);
    return [
      await this.ensureAtaFor(escrow.data.buyer),
      await gen.getCloseEscrowInstructionAsync({
        caller,
        rentPayer: escrow.data.rentPayer,
        escrow: escrowAddr,
        buyerUsdc: await this.ata(escrow.data.buyer),
        usdcMint: this.usdcMint,
      }),
    ];
  }

  // ---------- Licenças (Metaplex Core) ----------

  /**
   * Lê owner e coleção de um asset Metaplex Core (layout BaseAssetV1), em `confirmed`: com o padrão do RPC (`finalized`) o
   * indexador e o refresh ainda viam o dono antigo por ~13 s depois de uma venda (mesmo commitment de `fetchCoreLicense`).
   */
  async fetchCoreAsset(asset: Address): Promise<CoreAsset | null> {
    const { value } = await this.rpc.getAccountInfo(asset, { encoding: "base64", commitment: "confirmed" }).send();
    if (!value || value.owner !== MPL_CORE_PROGRAM_ADDRESS) return null;
    return decodeCoreAsset(Uint8Array.from(getBase64Encoder().encode(value.data[0])));
  }

  /** Busca on-chain as licenças de uma carteira numa coleção (fallback do indexador). */
  async findLicenses(owner: Address, collection: Address): Promise<Address[]> {
    const enc = getAddressEncoder();
    const b58 = getBase58Decoder();
    const res = await this.rpc
      .getProgramAccounts(MPL_CORE_PROGRAM_ADDRESS, {
        encoding: "base64",
        dataSlice: { offset: 0, length: 0 },
        filters: [
          { memcmp: { offset: 0n, bytes: b58.decode(Uint8Array.of(1)) as never, encoding: "base58" } },
          { memcmp: { offset: 1n, bytes: b58.decode(enc.encode(owner)) as never, encoding: "base58" } },
          { memcmp: { offset: 33n, bytes: b58.decode(Uint8Array.of(2)) as never, encoding: "base58" } },
          { memcmp: { offset: 34n, bytes: b58.decode(enc.encode(collection)) as never, encoding: "base58" } },
        ],
      })
      .send();
    return res.map((r) => r.pubkey);
  }
}

const U64_MAX = 18446744073709551615n;

export type ListLicenseIxsResult = {
  /** [cancel_listing do anúncio velho (se houver), list_license]. */
  instructions: Instruction[];
  /** PDA do anúncio (`[listing, asset]`). */
  listing: Address;
  /** Conta `Agent` do solver da licença. */
  agent: Address;
  /** Taxa da plataforma e royalty do criador que ficam congelados no anúncio, em pontos-base. */
  feeBps: number;
  royaltyBps: number;
  /** Um anúncio velho do mesmo asset é fechado na mesma transação (primeira instrução). */
  replacedStaleListing: boolean;
};

export type BuyListingIxsResult = {
  /** [ATA do vendedor (idempotente), buy_listing]. */
  instructions: Instruction[];
  seller: Address;
  agent: Address;
  listing: Address;
  /** Preço e partes em unidades de USDC (6 casas): `royaltyUnits + feeUnits + sellerUnits === priceUnits`. */
  priceUnits: bigint;
  royaltyUnits: bigint;
  feeUnits: bigint;
  sellerUnits: bigint;
};

export type CancelListingIxsResult = {
  instructions: Instruction[];
  listing: Address;
  seller: Address;
  /** O anúncio já não podia ser executado (dono mudou, delegate revogado ou asset queimado). */
  stale: boolean;
};

/** Authority de um plugin do mpl-core (`PluginAuthority`). */
export type CoreAuthority = { kind: "None" | "Owner" | "UpdateAuthority" } | { kind: "Address"; address: Address };

/** Dono, coleção e `TransferDelegate` de um asset de licença (o que a revenda precisa; ver `license.rs` do programa). */
export type CoreLicense = { owner: Address; collection: Address | null; transferDelegate: CoreAuthority | null };

/** `PluginType::TransferDelegate` no mpl-core. */
const PLUGIN_TYPE_TRANSFER_DELEGATE = 3;

/**
 * Decodifica um AssetV1 e o registro de plugins para achar o `TransferDelegate`. Espelha `read_license` do programa.
 * `null` se não é AssetV1; dado truncado ou registro ilegível lança (`RangeError`/`Error`).
 */
export function decodeCoreLicense(data: Uint8Array): CoreLicense | null {
  if (data[0] !== 1) return null; // Key::AssetV1
  const dec = getBase58Decoder();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const need = (end: number) => {
    if (end > data.length) throw new RangeError("asset truncado");
  };
  need(34);
  const owner = dec.decode(data.subarray(1, 33)) as Address;
  const tag = data[33]!;
  let offset = 34;
  let collection: Address | null = null;
  if (tag === 1 || tag === 2) {
    need(66);
    if (tag === 2) collection = dec.decode(data.subarray(34, 66)) as Address;
    offset = 66;
  } else if (tag !== 0) {
    throw new Error("update authority inválida");
  }
  const skipString = () => {
    need(offset + 4);
    const len = view.getUint32(offset, true);
    need(offset + 4 + len);
    offset += 4 + len;
  };
  skipString(); // name
  skipString(); // uri
  need(offset + 1);
  offset += data[offset] === 1 ? 9 : 1; // seq: Option<u64>
  need(offset);

  let transferDelegate: CoreAuthority | null = null;
  // Sem bytes depois do asset = sem plugins.
  if (data.length > offset) {
    need(offset + 9); // PluginHeaderV1: key (1) + plugin_registry_offset (8)
    const registryOffset = Number(view.getBigUint64(offset + 1, true));
    need(registryOffset + 5);
    if (data[registryOffset] !== 4) throw new Error("registro de plugins inválido"); // Key::PluginRegistryV1
    const count = view.getUint32(registryOffset + 1, true);
    let p = registryOffset + 5;
    for (let i = 0; i < count; i++) {
      need(p + 2);
      const pluginType = data[p]!;
      const authTag = data[p + 1]!;
      p += 2;
      let authority: CoreAuthority;
      if (authTag === 3) {
        need(p + 32);
        authority = { kind: "Address", address: dec.decode(data.subarray(p, p + 32)) as Address };
        p += 32;
      } else if (authTag <= 2) {
        authority = { kind: (["None", "Owner", "UpdateAuthority"] as const)[authTag]! };
      } else {
        throw new Error("authority de plugin inválida");
      }
      need(p + 8);
      p += 8; // offset do plugin dentro do asset
      if (pluginType === PLUGIN_TYPE_TRANSFER_DELEGATE && transferDelegate === null) transferDelegate = authority;
    }
    need(p + 4); // external_registry (o programa também exige que o registro esteja inteiro)
  }
  return { owner, collection, transferDelegate };
}

/**
 * O anúncio ainda pode ser executado por `buy_listing`: asset vivo, do vendedor, na coleção do solver e com o
 * `TransferDelegate` apontando para a PDA `market_authority`. Espelha o `live` de `cancel_listing` no programa.
 */
export function listingIsLive(listing: { seller: Address }, core: CoreLicense | null, collection: Address, market: Address): boolean {
  return (
    core !== null &&
    core.owner === listing.seller &&
    core.collection === collection &&
    core.transferDelegate?.kind === "Address" &&
    core.transferDelegate.address === market
  );
}

export type CoreAsset = { owner: Address; collection: Address | null; name: string; uri: string };

export function decodeCoreAsset(data: Uint8Array): CoreAsset | null {
  if (data[0] !== 1) return null; // Key::AssetV1
  const dec = getBase58Decoder();
  const owner = dec.decode(data.subarray(1, 33)) as Address;
  const tag = data[33];
  let offset = 34;
  let collection: Address | null = null;
  if (tag === 1 || tag === 2) {
    const key = dec.decode(data.subarray(34, 66)) as Address;
    if (tag === 2) collection = key;
    offset = 66;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const readStr = () => {
    const len = view.getUint32(offset, true);
    const s = new TextDecoder().decode(data.subarray(offset + 4, offset + 4 + len));
    offset += 4 + len;
    return s;
  };
  const name = readStr();
  const uri = readStr();
  return { owner, collection, name, uri };
}

/** Corta em bytes UTF-8 (o programa limita strings por bytes), sem quebrar caracteres. */
export function truncateUtf8(s: string, maxBytes: number): string {
  const enc = new TextEncoder();
  let out = "";
  for (const ch of s) {
    if (enc.encode(out + ch).length > maxBytes) break;
    out += ch;
  }
  return out;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function bigintJson(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

function extractLogs(e: unknown): string[] {
  const ctx = (e as { context?: { logs?: string[] }; cause?: { context?: { logs?: string[] } } }) ?? {};
  return ctx.context?.logs ?? ctx.cause?.context?.logs ?? [];
}

/** Motivo bruto do erro (mensagem + causa, p.ex. "Blockhash not found" da simulação), sem URLs do RPC nem chaves. */
function rawReason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const cause = (e as { cause?: { message?: unknown } } | null)?.cause?.message;
  const full = typeof cause === "string" && cause && !msg.includes(cause) ? `${msg}: ${cause}` : msg;
  return full
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/(api[-_]?key|token|secret)=\S+/gi, "$1=[oculto]")
    .slice(0, 300);
}

export function friendlyError(e: unknown, logs: readonly string[]): string {
  const known = describeFailure(e, logs);
  if (known) return known.message;
  // Simulação recusada sem logs do programa (blockhash vencido, conta inexistente...): mostra o motivo bruto.
  return rawReason(e);
}
