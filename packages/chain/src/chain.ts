import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  getTransactionDecoder,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
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
import { agentIdToBytes } from "@solvers/shared";
import { parseEvents, type SolversEvent } from "./events.js";

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

export class TxError extends Error {
  constructor(
    message: string,
    public readonly logs: readonly string[] = [],
  ) {
    super(message);
  }
}

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

  async fetchConfig() {
    return gen.fetchConfig(this.rpc, await this.configPda());
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

  /** Assina tudo no servidor e envia (operações de autoridade: verificador, uso, admin, faucet). */
  async sendAsServer(instructions: Instruction[]): Promise<{ signature: Signature; events: SolversEvent[] }> {
    const { value: latest } = await this.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(this.feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
      (m) => appendTransactionMessageInstructions([...this.budget(), ...instructions], m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    const wire = getBase64EncodedWireTransaction(signed);
    const signature = getSignatureFromTransaction(signed);
    return this.sendWire(wire, signature, Number(latest.lastValidBlockHeight));
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
  ): Promise<{ signature: Signature; events: SolversEvent[] }> {
    try {
      await this.rpc.sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed" }).send();
    } catch (e) {
      const logs = extractLogs(e);
      throw new TxError(friendlyError(e, logs), logs);
    }
    // Na devnet transações somem com frequência: reenvia (sem preflight) enquanto aguarda.
    const resend = () =>
      this.rpc
        .sendTransaction(wire, { encoding: "base64", skipPreflight: true, maxRetries: 0n })
        .send()
        .catch(() => undefined);
    await this.waitConfirmed(signature, lastValidBlockHeight, resend);
    return { signature, events: await this.eventsOf(signature) };
  }

  async waitConfirmed(signature: Signature, lastValidBlockHeight: number, resend?: () => Promise<unknown>): Promise<void> {
    for (let i = 0; i < 120; i++) {
      if (resend && i > 0 && i % 4 === 0) void resend();
      const { value } = await this.rpc.getSignatureStatuses([signature]).send();
      const st = value[0];
      if (st?.err) throw new TxError(`Transação falhou: ${JSON.stringify(st.err, bigintJson)}`);
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
      if (i % 10 === 9) {
        const h = await this.rpc.getBlockHeight({ commitment: "confirmed" }).send();
        if (Number(h) > lastValidBlockHeight) throw new TxError("Transação expirou antes de confirmar");
      }
      await sleep(500);
    }
    throw new TxError("Tempo esgotado aguardando confirmação");
  }

  /** Logs e contas de uma transação confirmada (null se ainda não visível no RPC). */
  async txLogs(
    signature: Signature,
  ): Promise<{ logs: readonly string[]; failed: boolean; blockTime: number | null; accounts: Address[] } | null> {
    const tx = await this.rpc
      .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0, encoding: "json" })
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

  /** Faucet: emite USDC de teste para uma carteira (só funciona com o mint de teste próprio). */
  async faucet(owner: Address, units: bigint): Promise<Signature> {
    const { signature } = await this.sendAsServer([
      await this.ensureAtaIx(owner),
      getMintToCheckedInstruction({
        mint: this.usdcMint,
        token: await this.ata(owner),
        mintAuthority: this.feePayer,
        amount: units,
        decimals: 6,
      }),
    ]);
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

  /** Lê owner e coleção de um asset Metaplex Core (layout BaseAssetV1). */
  async fetchCoreAsset(asset: Address): Promise<CoreAsset | null> {
    const { value } = await this.rpc.getAccountInfo(asset, { encoding: "base64" }).send();
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

const FRIENDLY: Record<string, string> = {
  AgentNotActive: "Este especialista ainda não está disponível para compra.",
  PriceTooLow: "O preço está abaixo do mínimo da plataforma.",
  NoLicense: "Você precisa ter a licença deste especialista para avaliar.",
  NoCredits: "Seus créditos acabaram.",
  BuyerNotEligible: "Sua conta não pode abrir novas garantias no momento.",
  DisputeWindowClosed: "O prazo para contestar esta etapa já passou.",
  AutoReleaseNotReached: "Ainda não chegou o prazo de liberação automática.",
  InvalidMilestoneStatus: "Esta etapa não está no estado certo para esta ação.",
};

function friendlyError(e: unknown, logs: string[]): string {
  const joined = logs.join("\n");
  for (const [code, msg] of Object.entries(FRIENDLY)) if (joined.includes(code)) return msg;
  if (/insufficient funds/i.test(joined)) return "Saldo de USDC insuficiente.";
  return e instanceof Error ? e.message : String(e);
}
