// Saque privado do criador via Cloak (pool blindado na MAINNET). Roda no navegador: a prova zk é gerada aqui e quem assina
// é a carteira do criador (Privy ou carteira de desenvolvimento), por `WalletLike`. O servidor do Solvers não vê nada disto.
//
// Fluxo: (1) chaves derivadas de uma assinatura da carteira (mesma ideia da "chave de memória"), (2) depósito do USDC no
// pool, (3) saque do pool para o endereço de destino, enviado pelo relay do Cloak (a tx de saque não contém a carteira de
// origem). A "chave do contador" é a chave de visualização (`nk`): lê o histórico, não gasta nada.
//
// Só imports relativos e do SDK: o mesmo código roda no Node (scripts/src/cloak-web-flow.ts) para teste com dinheiro real.
import type { WalletLike } from "@solvers/api-client";
import { CLOAK_USDC_MINT, cloakWithdrawFee } from "@solvers/shared";
import type { TransactionModifyingSigner } from "@solana/kit";
import { CLOAK_RPC_URL, MAINNET_GENESIS_HASH } from "./config";
import { loadHistory, saveEntry, type WithdrawEntry } from "./history";

type Sdk = typeof import("@cloak.dev/sdk");
let sdkPromise: Promise<Sdk> | null = null;
/** O SDK é pesado (snarkjs, Poseidon): só entra no bundle quando a tela do saque privado é usada. */
function loadSdk(): Promise<Sdk> {
  sdkPromise ??= import("@cloak.dev/sdk");
  return sdkPromise;
}

export type WithdrawStep = "keys" | "deposit" | "withdraw" | "done";
export type Hooks = {
  onStep?: (step: WithdrawStep) => void;
  /** Textos de andamento do SDK (inglês, só para log/diagnóstico). */
  onProgress?: (text: string) => void;
};

const KEY_MESSAGE = "Solvers private withdrawal key v1";

async function connect(sdk: Sdk) {
  const connection = sdk.createCloakRpc(CLOAK_RPC_URL);
  const genesis = await connection.getGenesisHash().send();
  if (genesis !== MAINNET_GENESIS_HASH) throw new Error("O RPC configurado não é o da rede real (mainnet). O saque privado só funciona nela.");
  return connection;
}

export type MainnetBalances = { usdc: bigint; sol: bigint };

/** Saldos da carteira na REDE REAL (não é o USDC de teste do Solvers). */
export async function getMainnetBalances(owner: string): Promise<MainnetBalances> {
  const sdk = await loadSdk();
  const connection = await connect(sdk);
  const addr = sdk.address(owner);
  const sol = (await connection.getBalance(addr).send()).value;
  const accounts = await connection.getTokenAccountsByOwner(addr, { mint: sdk.address(CLOAK_USDC_MINT) }, { encoding: "jsonParsed" }).send();
  let usdc = 0n;
  for (const a of accounts.value) {
    const info = (a.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }).parsed?.info;
    usdc += BigInt(info?.tokenAmount?.amount ?? "0");
  }
  return { usdc, sol };
}

export type CloakKeys = { owner: { privateKey: bigint; publicKey: bigint }; nk: Uint8Array };

/**
 * Chaves do pool derivadas da carteira: a assinatura ed25519 é determinística, então a mesma carteira reconstrói as mesmas
 * chaves em qualquer aparelho (nada para guardar nem perder). A assinatura NUNCA sai do navegador.
 */
export async function deriveKeys(wallet: WalletLike): Promise<CloakKeys> {
  const sdk = await loadSdk();
  const signature = await wallet.signMessage(new TextEncoder().encode(KEY_MESSAGE));
  if (signature.length !== 64) throw new Error("A carteira devolveu uma assinatura inesperada. Entre de novo e tente outra vez.");
  const seed = new Uint8Array(await crypto.subtle.digest("SHA-256", signature as BufferSource));
  const spend = sdk.deriveSpendKey(seed);
  const owner = await sdk.deriveUtxoKeypairFromSpendKey(spend.sk_spend);
  return { owner, nk: sdk.getNkFromUtxoPrivateKey(owner.privateKey) };
}

/** Chave do contador em texto (hex). Quem a tem LÊ o histórico privado; não consegue gastar. */
export const viewingKeyHex = (nk: Uint8Array) => Array.from(nk, (b) => b.toString(16).padStart(2, "0")).join("");
export const viewingKeyFromHex = (hex: string) => Uint8Array.from(hex.trim().match(/../g)?.map((h) => parseInt(h, 16)) ?? []);

/** Adapta a `WalletLike` (bytes de entrada e saída) ao signer do kit que o SDK pede para o depósito. */
function walletSigner(sdk: Sdk, wallet: WalletLike): TransactionModifyingSigner {
  return {
    address: sdk.address(wallet.address),
    async modifyAndSignTransactions(transactions) {
      const out = [];
      for (const transaction of transactions) {
        const signed = await wallet.signTransaction(sdk.transactionBytes(transaction), { network: "mainnet" });
        out.push({ ...transaction, ...sdk.transactionFromBytes(signed) });
      }
      return out as unknown as ReturnType<TransactionModifyingSigner["modifyAndSignTransactions"]> extends Promise<infer R> ? R : never;
    },
  };
}

function baseOptions(sdk: Sdk, connection: Awaited<ReturnType<typeof connect>>, wallet: WalletLike, keys: CloakKeys, hooks: Hooks) {
  const addr = sdk.address(wallet.address);
  return {
    connection,
    programId: sdk.CLOAK_PROGRAM_ID,
    relayUrl: sdk.CLOAK_PRODUCTION_RELAY_URL,
    signer: walletSigner(sdk, wallet),
    signMessage: (message: Uint8Array) => wallet.signMessage(message),
    depositorPublicKey: addr,
    walletPublicKey: addr,
    chainNoteViewingKeyNk: keys.nk,
    onProgress: (text: string) => hooks.onProgress?.(text),
  };
}

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export type WithdrawResult = { depositSignature: string; withdrawSignature: string; amount: bigint; fee: bigint; net: bigint; destination: string };

/** Etapa 3 (também usada para retomar): saca a nota do pool para o destino. */
async function finishWithdraw(sdk: Sdk, wallet: WalletLike, entry: WithdrawEntry, keys: CloakKeys, hooks: Hooks, merkleTree?: unknown): Promise<WithdrawEntry> {
  if (!entry.note) throw new Error("Esse saque não tem o valor depositado no pool para retomar.");
  hooks.onStep?.("withdraw");
  const connection = await connect(sdk);
  const note = await sdk.deserializeUtxo(fromB64(entry.note));
  const withdrawn = await sdk.fullWithdraw([note], sdk.address(entry.destination), {
    ...baseOptions(sdk, connection, wallet, keys, hooks),
    ...(merkleTree ? { cachedMerkleTree: merkleTree as never } : {}),
  });
  const done: WithdrawEntry = { ...entry, status: "done", withdrawSignature: withdrawn.signature };
  saveEntry(wallet.address, done);
  hooks.onStep?.("done");
  return done;
}

/**
 * Saca `amount` (unidades base de USDC) da carteira para `destination` sem ligar as duas no explorador.
 * Cada etapa é gravada no histórico local ANTES da seguinte: se algo falhar depois do depósito, `resumeWithdraw` conclui.
 */
export async function privateWithdraw(input: { wallet: WalletLike; amount: bigint; destination: string; hooks?: Hooks }): Promise<WithdrawResult> {
  const { wallet, amount, destination } = input;
  const hooks = input.hooks ?? {};
  const sdk = await loadSdk();
  const connection = await connect(sdk);

  hooks.onStep?.("keys");
  const keys = await deriveKeys(wallet);
  const usdc = sdk.address(CLOAK_USDC_MINT);

  let entry: WithdrawEntry = { id: `${Date.now()}`, createdAt: Date.now(), amount: amount.toString(), destination, status: "started" };
  saveEntry(wallet.address, entry);

  hooks.onStep?.("deposit");
  const { utxo, noteSalt } = await sdk.createRecoverableDepositUtxo(amount, keys.nk, usdc);
  const deposited = await sdk.transact(
    { inputUtxos: [await sdk.createZeroUtxo(usdc)], outputUtxos: [utxo], externalAmount: amount, depositor: sdk.address(wallet.address) },
    { ...baseOptions(sdk, connection, wallet, keys, hooks), chainNoteSalt: noteSalt, relaySupplementalAlt: true },
  );
  const note = deposited.outputUtxos[0];
  if (!note) throw new Error("O depósito não devolveu a nota. Não repita: veja o histórico.");
  entry = { ...entry, status: "deposited", note: toB64(sdk.serializeUtxo(note)), depositSignature: deposited.signature };
  saveEntry(wallet.address, entry);

  const done = await finishWithdraw(sdk, wallet, entry, keys, hooks, deposited.merkleTree);
  const fee = cloakWithdrawFee(amount);
  return { depositSignature: done.depositSignature!, withdrawSignature: done.withdrawSignature!, amount, fee, net: amount - fee, destination };
}

/** Conclui um saque que parou depois do depósito (aba fechada, rede caiu). */
export async function resumeWithdraw(wallet: WalletLike, entryId: string, hooks: Hooks = {}): Promise<WithdrawEntry> {
  const entry = loadHistory(wallet.address).find((e) => e.id === entryId);
  if (!entry || entry.status !== "deposited") throw new Error("Não há saque pendente para retomar.");
  const sdk = await loadSdk();
  hooks.onStep?.("keys");
  const keys = await deriveKeys(wallet);
  return finishWithdraw(sdk, wallet, entry, keys, hooks);
}

export type ReportResult = { csv: string; summary: { totalDeposits: number; totalWithdrawals: number; totalFees: number; netChange: number; transactionCount: number; finalBalance: number } };

/**
 * Relatório do contador (CSV) a partir da chave de visualização. `destination` é o endereço que recebeu o saque: o scanner só
 * reconhece o saque (sem nota de cadeia) pela conta de destino. Lê ~2.300 transações do pool: leva alguns minutos.
 *
 * O scanner PULA em silêncio as transações que o RPC recusa (limite de requisições), então uma leitura pode vir sem uma
 * linha. Com `expectSignatures` (as transações que o histórico local já conhece), a leitura se repete até todas aparecerem.
 */
export async function buildReport(input: {
  nk: Uint8Array;
  destination: string;
  ownerPublicKey?: bigint;
  expectSignatures?: string[];
  maxAttempts?: number;
  onStatus?: (text: string) => void;
}): Promise<ReportResult & { missing: string[] }> {
  const sdk = await loadSdk();
  const connection = await connect(sdk);
  const attempts = input.maxAttempts ?? (input.expectSignatures?.length ? 3 : 1);
  let result: ReportResult = { csv: "", summary: { totalDeposits: 0, totalWithdrawals: 0, totalFees: 0, netChange: 0, transactionCount: 0, finalBalance: 0 } };
  let missing: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const scan = await sdk.scanTransactions({
      connection,
      programId: sdk.CLOAK_PROGRAM_ID,
      viewingKeyNk: input.nk,
      walletPublicKey: input.destination,
      ...(input.ownerPublicKey !== undefined ? { ownerUtxoPublicKey: input.ownerPublicKey } : {}),
      deliveryMints: [sdk.address(CLOAK_USDC_MINT)],
      batchSize: 25,
      onStatus: (text) => input.onStatus?.(text),
    });
    const report = sdk.toComplianceReport(scan);
    result = { csv: sdk.formatComplianceCsv(report), summary: report.summary };
    missing = (input.expectSignatures ?? []).filter((sig) => !result.csv.includes(sig));
    if (!missing.length) break;
    input.onStatus?.(`Faltam ${missing.length} movimentações; lendo de novo (${attempt}/${attempts})…`);
  }
  return { ...result, missing };
}

/** Mensagem em português para o erro mais comum; o resto passa como veio. */
export function friendlyError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (/429|Too Many Requests/i.test(text)) return "A rede real está ocupada (limite de requisições). Espere um minuto e tente de novo.";
  if (/reject|denied|cancel/i.test(text)) return "A assinatura foi cancelada.";
  if (/Failed to fetch|NetworkError/i.test(text)) return "Não deu para falar com a rede real. Confira a conexão e o RPC configurado.";
  return text;
}
