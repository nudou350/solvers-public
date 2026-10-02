// Spike do Cloak (saque privado do criador): deposita USDC (ou SOL) no pool blindado, saca para um
// endereco novo e gera o relatorio do contador. So funciona na MAINNET (o relay do Cloak e fixo no SDK).
//
//   CLOAK_DRY_RUN=1 SOLANA_RPC_URL=... KEYPAIR_PATH=... npx tsx src/cloak-spike.ts   # ensaio: nada e enviado
//   SOLANA_RPC_URL=... KEYPAIR_PATH=... npx tsx src/cloak-spike.ts                    # real
//
// Use uma carteira DESCARTAVEL com pouco dinheiro (ver docs/cloak-privacidade.md). Nunca as chaves de
// ~/solvers-keys nem de apps/server/.keys. Tudo o que importa e gravado em scripts/.cloak/ ANTES de
// seguir para o passo seguinte (nota perdida = dinheiro perdido).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";
import {
  CLOAK_PRODUCTION_RELAY_URL,
  CLOAK_PROGRAM_ID,
  NATIVE_SOL_MINT,
  address,
  createCloakRpc,
  createRecoverableDepositUtxo,
  createZeroUtxo,
  formatComplianceCsv,
  fullWithdraw,
  generateUtxoKeypair,
  getNkFromUtxoPrivateKey,
  scanTransactions,
  serializeUtxo,
  signerFromSecretKey,
  toComplianceReport,
  transact,
} from "@cloak.dev/sdk";

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type Token = "usdc" | "sol";

const here = dirname(fileURLToPath(import.meta.url));
const stateDir = process.env.CLOAK_STATE_DIR ?? join(here, "..", ".cloak");
const dryRun = process.env.CLOAK_DRY_RUN === "1";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Defina ${name}`);
  return v;
}

const token: Token = process.env.CLOAK_TOKEN === "sol" ? "sol" : "usdc";
const decimals = token === "usdc" ? 6 : 9;
// Padrao: 2 USDC (minimo do pool e 1) ou 0,02 SOL (minimo e 0,01).
const amount = BigInt(process.env.CLOAK_AMOUNT ?? (token === "usdc" ? "2000000" : "20000000"));
const maxAmount = token === "usdc" ? 20_000_000n : 100_000_000n;
if (amount > maxAmount && process.env.CLOAK_ALLOW_LARGE !== "1") {
  throw new Error(`Valor acima do limite de seguranca do spike (${maxAmount}). Use CLOAK_ALLOW_LARGE=1 se for de proposito.`);
}
const mint = token === "usdc" ? address(USDC_MINT) : NATIVE_SOL_MINT;
// Taxa de saque do pool (README do SDK, "Fees and limits"): conferir sempre no PoolConfig real.
const fee = token === "usdc" ? 450_000n + (amount * 3n) / 1000n : 5_000_000n + (amount * 3n) / 1000n;
const fmt = (v: bigint) => (Number(v) / 10 ** decimals).toFixed(decimals);
const sols = (v: bigint) => (Number(v) / 1e9).toFixed(6);

mkdirSync(stateDir, { recursive: true });
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runFile = join(stateDir, `run-${runId}.json`);
const run: Record<string, unknown> = { runId, token, amount: amount.toString(), dryRun, steps: [] as unknown[] };

function save(step: string, data: Record<string, unknown> = {}): void {
  (run.steps as unknown[]).push({ step, at: new Date().toISOString(), ...data });
  writeFileSync(runFile, JSON.stringify(run, null, 2));
  console.log(`[${step}]`, Object.keys(data).length ? JSON.stringify(data) : "ok");
}

async function contadorReport(
  connection: ReturnType<typeof createCloakRpc>,
  wallet: ReturnType<typeof address>,
  mint: ReturnType<typeof address>,
  nk: Uint8Array,
  ownerPublicKey: bigint,
): Promise<void> {
  try {
    const scan = await scanTransactions({
      connection,
      programId: CLOAK_PROGRAM_ID,
      viewingKeyNk: nk,
      walletPublicKey: wallet,
      ownerUtxoPublicKey: ownerPublicKey,
      deliveryMints: [mint],
      onStatus: (s) => console.log("  relatorio:", s),
    });
    const report = toComplianceReport(scan);
    const csvFile = join(stateDir, `relatorio-contador-${runId}.csv`);
    writeFileSync(csvFile, formatComplianceCsv(report));
    save("relatorio-contador", { arquivo: csvFile, resumo: report.summary });
  } catch (e) {
    save("relatorio-contador-falhou", { erro: e instanceof Error ? e.message : String(e) });
  }
}

async function main(): Promise<void> {
  const rpcUrl = need("SOLANA_RPC_URL");
  const keypairPath = need("KEYPAIR_PATH");
  const connection = createCloakRpc(rpcUrl);

  const genesis = await connection.getGenesisHash().send();
  if (genesis !== MAINNET_GENESIS) throw new Error(`O RPC nao e a mainnet (genesis ${genesis}). O Cloak so funciona na mainnet.`);

  const signer = await signerFromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8"))));
  save("carteira", { endereco: signer.address, token, valor: fmt(amount), taxaDeSaqueEstimada: fmt(fee) });
  // Modo so-relatorio: CLOAK_SCAN_KEYS=<keys-*.json> refaz o relatorio do contador de um saque ja feito.
  if (process.env.CLOAK_SCAN_KEYS) {
    const k = JSON.parse(readFileSync(process.env.CLOAK_SCAN_KEYS, "utf8")) as { nk: string; ownerPublicKey: string };
    // O scanner so reconhece um saque sem nota de cadeia pela conta de destino: passe o destino em CLOAK_SCAN_WALLET.
    const wallet = process.env.CLOAK_SCAN_WALLET ? address(process.env.CLOAK_SCAN_WALLET) : signer.address;
    await contadorReport(connection, wallet, mint, Uint8Array.from(Buffer.from(k.nk, "hex")), BigInt(k.ownerPublicKey));
    return;
  }
  if (amount <= fee) throw new Error("O valor precisa ser maior que a taxa de saque.");

  const sol = (await connection.getBalance(signer.address).send()).value;
  let tokenBalance = 0n;
  if (token === "usdc") {
    const accounts = await connection
      .getTokenAccountsByOwner(signer.address, { mint }, { encoding: "jsonParsed" })
      .send();
    tokenBalance = accounts.value.reduce((acc, a) => {
      const info = (a.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }).parsed?.info;
      return acc + BigInt(info?.tokenAmount?.amount ?? "0");
    }, 0n);
  }
  // Reserva de SOL: taxas de rede + aluguel da tabela de enderecos do deposito SPL (~0,0056 SOL, reembolsavel).
  const solNeeded = token === "usdc" ? 20_000_000n : 20_000_000n + amount;
  save("saldos", { sol: sols(sol), solNecessario: sols(solNeeded), ...(token === "usdc" ? { usdc: fmt(tokenBalance) } : {}) });
  if (sol < solNeeded) throw new Error(`SOL insuficiente: precisa de ~${sols(solNeeded)} SOL.`);
  if (token === "usdc" && tokenBalance < amount) throw new Error("USDC insuficiente na carteira.");

  if (dryRun) {
    save("ensaio-ok", { aviso: "CLOAK_DRY_RUN=1: nenhuma transacao foi enviada" });
    return;
  }

  // 1) Chaves do pool (nk = "chave do contador"). Gravadas ANTES do deposito.
  const owner = await generateUtxoKeypair();
  const nk = getNkFromUtxoPrivateKey(owner.privateKey);
  const keysFile = join(stateDir, `keys-${runId}.json`);
  writeFileSync(
    keysFile,
    JSON.stringify({ ownerPrivateKey: owner.privateKey.toString(), ownerPublicKey: owner.publicKey.toString(), nk: Buffer.from(nk).toString("hex") }, null, 2),
  );
  save("chaves-gravadas", { arquivo: keysFile });

  // 2) Destino novo (endereco que ninguem liga a carteira de origem). Chave gravada antes de usar.
  const recipientKp = process.env.CLOAK_RECIPIENT ? null : Keypair.generate();
  const recipient = address(process.env.CLOAK_RECIPIENT ?? recipientKp!.publicKey.toBase58());
  if (recipientKp) {
    writeFileSync(join(stateDir, `destino-${runId}.json`), JSON.stringify(Array.from(recipientKp.secretKey)));
  }
  save("destino", { endereco: recipient, geradoPorNos: Boolean(recipientKp) });

  // 3) Deposito (blinda). Nota recuperavel: da para refazer a partir do nk se o arquivo se perder.
  const { utxo, noteSalt } = await createRecoverableDepositUtxo(amount, nk, mint);
  const deposited = await transact(
    { inputUtxos: [await createZeroUtxo(mint)], outputUtxos: [utxo], externalAmount: amount, depositor: signer.address },
    {
      connection,
      programId: CLOAK_PROGRAM_ID,
      relayUrl: CLOAK_PRODUCTION_RELAY_URL,
      depositorKeypair: signer,
      chainNoteViewingKeyNk: nk,
      chainNoteSalt: noteSalt,
      relaySupplementalAlt: true,
      onProgress: (s) => console.log("  deposito:", s),
    },
  );
  const note = deposited.outputUtxos[0];
  if (!note) throw new Error("O deposito nao devolveu a nota.");
  save("deposito", {
    assinatura: deposited.signature,
    explorer: `https://solscan.io/tx/${deposited.signature}`,
    nota: Buffer.from(serializeUtxo(note)).toString("base64"),
    noteSalt: noteSalt.toString(),
  });

  // 4) Saque total para o endereco novo (sem troco: uma nota de entrada).
  const withdrawn = await fullWithdraw([note], recipient, {
    connection,
    programId: CLOAK_PROGRAM_ID,
    relayUrl: CLOAK_PRODUCTION_RELAY_URL,
    depositorKeypair: signer,
    walletPublicKey: signer.address,
    chainNoteViewingKeyNk: nk,
    cachedMerkleTree: deposited.merkleTree,
    onProgress: (s) => console.log("  saque:", s),
  });
  save("saque", { assinatura: withdrawn.signature, explorer: `https://solscan.io/tx/${withdrawn.signature}`, destino: recipient });

  // 5) Relatorio do contador: so quem tem o nk consegue montar (o publico nao).
  await contadorReport(connection, signer.address, mint, nk, owner.publicKey);

  const solAfter = (await connection.getBalance(signer.address).send()).value;
  save("fim", { solGasto: sols(sol - solAfter), log: runFile });
}

main().catch((e) => {
  save("erro", { mensagem: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
