// E2E do programa v2 (localnet, servidor + indexador reais, Postgres descartável):
//   - prazo de entrega (delivery_days) e cancel_undelivered (sem taxa; antes do prazo a rota recusa com a data);
//   - contestação e resolve_stale_dispute pelo job do servidor depois do prazo de julgamento (7 dias);
//   - taxa congelada no escrow (imune a update_config), inclusive no que o indexador grava;
//   - update_pricing emite PricingUpdated e o indexador atualiza o preço (compra logo depois não cai em PriceChanged);
//   - close_escrow: terceiro recusado, servidor fecha, indexador marca closed;
//   - GET /api/me/escrows/:id (deliveryDeadline, feeBps, disputedAt, disputeDeadline, canCancelUndelivered).
//
// O relógio: os prazos são de 1 a 7 dias, então o teste precisa avançar o relógio da rede. O validador local só
// aceita `--warp-slot` ao (re)iniciar, e o relógio (unix_timestamp) só anda até 0,3 x (slots desde o início da
// época) x 1 s por avanço. Por isso o validador precisa nascer com uma época enorme e o teste reinicia o validador
// UMA vez com o ledger existente. Depois de avançado, o ledger não pode ser reiniciado de novo (o snapshot do
// warp é rejeitado): para rodar outra vez, recomece do zero (validador com --reset, bootstrap, publish, banco novo).
// O relógio do servidor (Date) é deslocado pelo mesmo tanto via scripts/src/clock-shim.ts (o now() do Postgres
// não muda: o teste recua a coluna disputed_at em 8 dias para o job de disputa parada enxergar o prazo vencido).
//
// Ambiente (resumo; o roteiro completo está no relatório de validação):
//   WSL:      EXTRA_ARGS="--slots-per-epoch 100000000" bash scripts/chain/local-validator.sh
//   bootstrap: cd scripts && pnpm bootstrap; publicar frontend-react e ui-design (cli:publish) no banco descartável
//   servidor: cd apps/server && E2E_CLOCK_OFFSET_FILE=<arquivo> npx tsx --env-file=<env do teste> \
//               --import ../../scripts/src/clock-shim.ts src/index.ts      (porta 3017)
//   teste:    cd scripts && E2E_CLOCK_OFFSET_FILE=<mesmo arquivo> E2E_SERVER_ENV_FILE=<env do servidor> npx tsx src/e2e-v2.ts
// Variáveis: API_URL, E2E_DB_CONTAINER (padrão solvers-e2e-pg, usuário/banco solvers), WARP_SLOT (padrão 3000000),
//   SKIP_WARP=1 (só a parte anterior ao relógio), KEYS_DIR/CREATOR_KEYS_DIR (ver env.ts).
import { execFileSync, execSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSigner, getBase64Encoder, type KeyPairSigner } from "@solana/kit";
import { address, loadSigner, parseEvents, TxError, type Signature } from "@solvers/chain";
import { unitsToUsdc, usdcToUnits } from "@solvers/shared";
import * as gen from "../../packages/solvers-client/dist/index.js";
import { login, signAsWallet } from "./e2e-api.js";
import { chain, key, log } from "./env.js";

const ROOT = join(import.meta.dirname, "..", "..");
const API = process.env.API_URL ?? "http://localhost:3017";
const OFFSET_FILE = process.env.E2E_CLOCK_OFFSET_FILE;
const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? "solvers-e2e-pg";
const WARP_SLOT = Number(process.env.WARP_SLOT ?? 3_000_000);
const DAY = 86_400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; status: "ok" | "inconclusivo"; note?: string }[] = [];
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
}
function pass(name: string, extra?: unknown) {
  results.push({ name, status: "ok" });
  log(name, extra);
}
function inconclusive(name: string, note: string) {
  results.push({ name, status: "inconclusivo", note });
  console.log(`? ${name}: ${note}`);
}

// ---------- HTTP ----------

type R<T = any> = { status: number; body: T };
async function call<T = any>(path: string, o: { method?: string; token?: string; body?: unknown } = {}): Promise<R<T>> {
  // /api/tx, /api/search e /api/faucet têm limite de 20 req/min por IP: espera a janela virar e repete.
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`${API}${path}`, {
      method: o.method ?? (o.body !== undefined ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    if (res.status === 429) {
      await sleep(15_000);
      continue;
    }
    return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
  }
  throw new Error(`429 persistente em ${path}`);
}
async function ok<T = any>(path: string, o: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const r = await call<T>(path, o);
  if (r.status >= 300) throw new Error(`${o.method ?? (o.body !== undefined ? "POST" : "GET")} ${path} -> ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
}

type Wallet = { name: string; signer: KeyPairSigner; token: string };
async function newWallet(name: string, usdc: number): Promise<Wallet> {
  const signer = await generateKeyPairSigner();
  await c.faucet(signer.address, usdcToUnits(usdc));
  return { name, signer, token: await login(signer) };
}
const relogin = async (w: Wallet) => void (w.token = await login(w.signer));

/** O servidor monta, a "carteira" assina, o servidor envia. */
/**
 * /api/tx, /api/search e /api/faucet aceitam 20 req/min por IP. Reserva as chamadas de uma operação (montar + enviar) de
 * uma vez: esperar o limite entre uma e outra deixaria o blockhash da transação montada vencer.
 */
const txCalls: number[] = [];
async function budget(n: number) {
  for (;;) {
    const now = Date.now();
    while (txCalls.length && now - txCalls[0]! > 61_000) txCalls.shift();
    if (txCalls.length + n <= 18) break;
    await sleep(1_000);
  }
  for (let i = 0; i < n; i++) txCalls.push(Date.now());
}

async function txApi(w: Wallet, path: string, body: unknown) {
  await budget(2);
  const built = await ok<{ transaction: string; meta?: Record<string, any> }>(path, { method: "POST", token: w.token, body });
  const signed = await signAsWallet(w.signer, built.transaction);
  const r = await call<{ signature: string; events: string[] }>("/api/tx/submit", { method: "POST", token: w.token, body: { transaction: signed } });
  if (r.status >= 300) {
    // Diagnóstico: o servidor só devolve "Transaction simulation failed"; simula de novo para mostrar os logs do programa.
    const sim = await c.rpc.simulateTransaction(signed as never, { encoding: "base64", commitment: "confirmed", replaceRecentBlockhash: true, sigVerify: false }).send().catch((e) => ({ value: { err: String(e), logs: [] as string[] } }));
    const info = JSON.stringify({ body: r.body, sim: sim.value.err, logs: sim.value.logs ?? [] }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1);
    throw new Error(`POST /api/tx/submit (${path}) -> ${r.status}: ${info}`);
  }
  return { ...r.body, meta: built.meta ?? {} };
}

// ---------- Cadeia ----------

let c!: Awaited<ReturnType<typeof chain>>;

/** Envia direto à rede uma transação montada com o fee payer do servidor e assinada pelas carteiras dadas. */
async function onchain(ixs: Parameters<typeof c.buildForUser>[0], signers: KeyPairSigner[] = []) {
  const built = await c.buildForUser(ixs);
  let tx: string = built.transaction;
  for (const s of signers) tx = await signAsWallet(s, tx);
  return c.submitSigned(tx);
}

async function expectChainError(p: Promise<unknown>, errName: string, errCode: number, what: string) {
  try {
    await p;
  } catch (e) {
    const text = e instanceof TxError ? `${e.message}\n${e.logs.join("\n")}` : String(e);
    if (text.includes(errName) || text.includes(`0x${errCode.toString(16)}`) || text.includes(`Error Number: ${errCode}`)) return text;
    throw new Error(`FALHOU: ${what}: recusado por outro erro (esperava ${errName}): ${text.slice(0, 700)}`);
  }
  throw new Error(`FALHOU: ${what}: deveria ter sido recusado on-chain (${errName})`);
}

async function chainClock(): Promise<number> {
  const acc = await c.rpc.getAccountInfo(address("SysvarC1ock11111111111111111111111111111111"), { encoding: "base64" }).send();
  const bytes = getBase64Encoder().encode(acc.value!.data[0]);
  return Number(new DataView(bytes.buffer, bytes.byteOffset).getBigInt64(32, true));
}

async function waitFor<T>(what: string, fn: () => Promise<T | false | null | undefined>, ms = 30_000, every = 1_000): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(every);
  }
  throw new Error(`FALHOU: tempo esgotado esperando ${what}${last ? ` (${(last as Error).message})` : ""}`);
}

/** Variações de saldo de token da transação, por conta. */
async function deltas(sig: string) {
  const info = await waitFor("os logs da transação", () => c.txLogs(sig as Signature));
  return (account: string) => info.tokenDeltas.find((d) => d.account === account)?.delta ?? 0n;
}

// ---------- Banco descartável ----------

function psql(sql: string): string {
  return execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "solvers", "-d", "solvers", "-At", "-c", sql], { encoding: "utf8" }).trim();
}

// ---------- Validador no WSL ----------

const toWsl = (p: string) => p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d: string) => `/mnt/${d.toLowerCase()}`);

async function rpcUp(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:8899", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }), signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function warpValidator(slot: number) {
  const dir = join(tmpdir(), "solvers-e2e-v2");
  mkdirSync(dir, { recursive: true });
  const stop = join(dir, "stop.sh");
  const start = join(dir, "warp.sh");
  writeFileSync(
    stop,
    `#!/usr/bin/env bash
pkill -TERM -f '[s]olana-test-validator' || true
for i in $(seq 1 40); do pgrep -f '[s]olana-test-validator' >/dev/null || exit 0; sleep 1; done
pkill -KILL -f '[s]olana-test-validator' || true
`,
    { mode: 0o755 },
  );
  // Mesmos argumentos de scripts/chain/local-validator.sh, sem --reset e com --warp-slot.
  writeFileSync(
    start,
    `#!/usr/bin/env bash
source "${toWsl(ROOT)}/scripts/chain/env.sh"
SO=\${SO:-$HOME/solvers-build/target/deploy/solvers.so}
cd "$HOME"
exec solana-test-validator --quiet --limit-ledger-size 50000000 --ledger "\${LEDGER:-$HOME/solvers-ledger}" --warp-slot "$1" \\
  --upgradeable-program DW6UzJDR9X388f6keJSLXz7WgRVJFntbvonSskRrWNaW "$SO" EA2Nz3yBuF28hHC4xYBnSR4B3bJVWuDUt3VSsCV9KoGr \\
  --bpf-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d "${toWsl(ROOT)}/programs/solvers/tests/fixtures/mpl_core.so" \\
  --mint J4riUZWJELvMbYwcXuQ3iDHcF6LaFFEmSXDLH618AGy4
`,
    { mode: 0o755 },
  );
  // As últimas ~32 slots ainda não estão "rooted": um restart as perderia (o estado das contas volta, o índice de
  // assinaturas não). Espera tudo o que foi feito até agora ser finalizado antes de parar.
  const tip = Number(await c.rpc.getSlot({ commitment: "confirmed" }).send());
  await waitFor("os slots recentes serem finalizados", async () => Number(await c.rpc.getSlot({ commitment: "finalized" }).send()) >= tip, 90_000, 1_000);
  await sleep(2_000);
  console.log("… parando o validador");
  // O serviço do WSL às vezes recusa uma chamada nova por alguns segundos ("Wsl/Service/0x8007274c"): tenta de novo.
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync("wsl", ["bash", "-lc", `bash ${toWsl(stop)}`], { stdio: "inherit" });
      break;
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(5_000);
    }
  }
  await waitFor("o RPC cair", async () => !(await rpcUp()), 60_000, 500);
  console.log(`… reiniciando o validador com --warp-slot ${slot}`);
  const logFd = openSync(join(dir, "validator.log"), "w");
  spawn("wsl", ["bash", "-lc", `bash ${toWsl(start)} ${slot}`], { detached: true, stdio: ["ignore", logFd, logFd], windowsHide: true }).unref();
  await waitFor("o RPC voltar", () => rpcUp(), 120_000, 1_000);
  await waitFor(`o slot chegar a ${slot}`, async () => Number(await c.rpc.getSlot().send()) >= slot, 60_000, 500);
}

// ---------- Roteiro ----------

/** Assinatura da transação close_escrow de um escrow (a conta fechada some do índice do endereço: busca pelo evento). */
async function findCloseSignature(escrow: string): Promise<string | null> {
  const sigs = await c.rpc.getSignaturesForAddress(c.programId, { limit: 40 }).send();
  for (const s of sigs) {
    if (s.err) continue;
    const info = await c.txLogs(s.signature);
    if (info && parseEvents(info.logs, c.programId).some((e) => e.name === "EscrowClosed" && e.data.escrow === escrow)) return s.signature;
  }
  return null;
}

type Detail = {
  escrow: {
    status: string;
    deliveryDeadline: string | null;
    feeBps: number | null;
    amountUsdc: number;
    milestones: { status: string; criteria: string }[];
  };
  milestones: {
    index: number;
    amountUsdc: number;
    disputedAt: string | null;
    disputeDeadline: string | null;
    canCancelUndelivered: boolean;
    criteria: string[];
  }[];
};
const detail = (w: Wallet, id: string) => ok<Detail>(`/api/me/escrows/${id}`, { token: w.token });
const fmtBr = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

async function main() {
  c = await chain();
  const admin = await key("admin");
  const verifier = await key("verifier");

  // Pré-requisitos do ambiente
  check(OFFSET_FILE, "defina E2E_CLOCK_OFFSET_FILE (o mesmo arquivo do servidor subido com scripts/src/clock-shim.ts)");
  writeFileSync(OFFSET_FILE, "0");
  const drift0 = (await chainClock()) - Math.floor(Date.now() / 1000);
  check(Math.abs(drift0) < 600, `o relógio da rede já está ${drift0}s fora do relógio da máquina (ledger avançado antes?). Recomece: validador --reset, bootstrap, publish, banco novo.`);
  const sched = await c.rpc.getEpochSchedule().send();
  if (process.env.SKIP_WARP !== "1") {
    check(Number(sched.slotsPerEpoch) > WARP_SLOT, `o validador precisa de época longa (slotsPerEpoch=${sched.slotsPerEpoch}); suba com EXTRA_ARGS="--slots-per-epoch 100000000"`);
  }
  const agents = await ok<{ id: string; slug: string; creatorId: string; priceUsdc: number }[]>("/api/agents");
  const fe = agents.find((a) => a.slug === "frontend-react");
  check(fe, "frontend-react não publicado (cli:publish)");
  const agentAddr = await c.agentPda(fe.id);
  const cfg0 = (await c.fetchConfig()).data;
  const cfgParams = { verifier: cfg0.verifier, usageAuthority: cfg0.usageAuthority, feeBps: cfg0.feeBps, minStake: cfg0.minStake, minPrice: cfg0.minPrice };
  const treasury = cfg0.treasury;
  const creatorAta = (await c.fetchAgent(fe.id)).data.creatorUsdc;
  log("ambiente", { feeBps: cfg0.feeBps, treasury, relogioRede: new Date((await chainClock()) * 1000).toISOString() });

  // ===== 1. update_pricing =====
  const creatorSigner = await loadSigner(join(process.env.CREATOR_KEYS_DIR ?? join(ROOT, "apps", "server", ".keys", "creators"), `${fe.creatorId}.json`));
  const oldPrice = usdcToUnits(fe.priceUsdc);
  const newPrice = oldPrice + usdcToUnits(2);
  const setPrice = async (price: bigint) => {
    const ix = await gen.getUpdatePricingInstructionAsync({ creator: creatorSigner, agent: agentAddr, price, pricePerUse: 0n });
    return c.sendAsServer([ix]);
  };
  const upd = await setPrice(newPrice);
  check(upd.events.some((e) => e.name === "PricingUpdated" && e.data.price === newPrice), `update_pricing deveria emitir PricingUpdated: ${upd.events.map((e) => e.name)}`);
  const t0 = Date.now();
  await waitFor("o indexador atualizar o preço no banco", async () => (await ok<{ agent: { priceUsdc: number } }>(`/api/agents/${fe.id}`)).agent.priceUsdc === unitsToUsdc(newPrice), 20_000, 500);
  pass("update_pricing emite PricingUpdated e o indexador atualiza o preço", `${unitsToUsdc(oldPrice)} -> ${unitsToUsdc(newPrice)} USDC em ${Date.now() - t0} ms`);

  const buyerP = await newWallet("preco", 60);
  // Controle negativo: o preço antigo on-chain é recusado (prova que a mudança valeu na rede).
  const stale = await c.purchaseLicenseIxs(buyerP.signer.address, fe.id, oldPrice);
  await expectChainError(onchain(stale.instructions, [buyerP.signer]), "PriceChanged", 6026, "compra com o preço antigo");
  const p1 = await txApi(buyerP, "/api/tx/purchase", { agentId: fe.id });
  const d1 = await deltas(p1.signature);
  check(d1(treasury) === (newPrice * BigInt(cfg0.feeBps)) / 10_000n, `taxa da compra com preço novo: ${d1(treasury)}`);
  pass("compra com o preço novo passa, cobrando o valor novo", `taxa ${unitsToUsdc(d1(treasury))} USDC`);
  // Volta o preço e compra logo em seguida, sem esperar o indexador.
  await setPrice(oldPrice);
  const buyerQ = await newWallet("preco2", 60);
  const r = await call<any>("/api/tx/purchase", { method: "POST", token: buyerQ.token, body: { agentId: fe.id } });
  if (r.status === 409 && r.body.code === "price_changed") {
    check(r.body.priceUsdc === unitsToUsdc(oldPrice), `409 deveria trazer o preço novo: ${JSON.stringify(r.body)}`);
    const again = await txApi(buyerQ, "/api/tx/purchase", { agentId: fe.id });
    pass("compra logo depois do update_pricing: servidor relê o preço (409 price_changed) e a repetição passa", again.events.join(","));
  } else {
    check(r.status === 200, `compra logo após update_pricing: ${r.status} ${JSON.stringify(r.body)}`);
    const signed = await signAsWallet(buyerQ.signer, r.body.transaction);
    await ok("/api/tx/submit", { method: "POST", token: buyerQ.token, body: { transaction: signed } });
    pass("compra logo depois do update_pricing passa sem PriceChanged (indexador já tinha o preço)");
  }
  await waitFor("o preço voltar no banco", async () => (await ok<{ agent: { priceUsdc: number } }>(`/api/agents/${fe.id}`)).agent.priceUsdc === unitsToUsdc(oldPrice), 20_000, 500);

  // ===== 2. Garantias: criação, prazo, taxa congelada =====
  const badDays = await call<any>("/api/tx/escrow", { method: "POST", token: buyerP.token, body: { agentId: fe.id, title: "Prazo inválido", description: "Descrição com mais de dez caracteres.", deliveryDays: 61 } });
  check(badDays.status === 400 && badDays.body.code === "invalid_delivery_days", `deliveryDays 61 deveria dar 400: ${JSON.stringify(badDays)}`);
  pass("prazo de entrega acima de 60 dias é recusado pela API", badDays.body.error);

  const mk = (title: string) => ({ agentId: fe.id, title, description: "Formulário de login com e-mail e senha, validação no envio." });
  const w1 = await newWallet("E1", 25);
  const w2 = await newWallet("E2", 25);
  const w3 = await newWallet("E3", 25);
  const chainNow = await chainClock();

  const e1 = (await txApi(w1, "/api/tx/escrow", { ...mk("E1 prazo e cancelamento"), deliveryDays: 1 })).meta.escrowId as string;
  const e1Acc = (await gen.fetchEscrow(c.rpc, address(e1))).data;
  check(e1Acc.feeBps === cfg0.feeBps, `feeBps do escrow E1 on-chain: ${e1Acc.feeBps}`);
  check(Math.abs(Number(e1Acc.deliveryDeadline) - (chainNow + DAY)) < 120, `delivery_deadline E1 on-chain: ${e1Acc.deliveryDeadline} vs ${chainNow + DAY}`);
  pass("create_escrow com delivery_days=1 grava prazo de 1 dia e a taxa atual on-chain", `prazo ${new Date(Number(e1Acc.deliveryDeadline) * 1000).toISOString()}, fee ${e1Acc.feeBps} bps`);

  // update_config: a taxa sobe para 20% DEPOIS de E1 e ANTES de E2.
  const up = await c.sendAsServer([await c.updateConfigIx(admin, { ...cfgParams, feeBps: 2000 })]);
  check(up.events.some((e) => e.name === "ConfigUpdated"), "update_config deveria emitir ConfigUpdated");
  await expectChainError(c.sendAsServer([await c.updateConfigIx(admin, { ...cfgParams, feeBps: 2001 })]), "FeeTooHigh", 6031, "update_config acima do teto de 20%");
  const e2 = (await txApi(w2, "/api/tx/escrow", { ...mk("E2 disputa parada"), deliveryDays: 1 })).meta.escrowId as string;
  const e2Acc = (await gen.fetchEscrow(c.rpc, address(e2))).data;
  check(e2Acc.feeBps === 2000, `E2 criada com a taxa nova (2000): ${e2Acc.feeBps}`);
  const e3 = (await txApi(w3, "/api/tx/escrow", mk("E3 fechamento"))).meta.escrowId as string;
  check((await gen.fetchEscrow(c.rpc, address(e3))).data.feeBps === 2000, "E3 com taxa 2000");
  // Regras da disputa parada (programa com StaleDisputeNeedsJudgment): só um warp por execução, então cada marco
  // (7 dias de SLA x prazo de entrega) ganha a sua garantia. Com o relógio ~13,9 dias à frente:
  //   EA: prazo de 30 dias (SLA vencido, prazo não) -> job não reembolsa e a rede recusa (DeliveryDeadlineNotReached);
  //   EB: prazo de 10 dias (os dois vencidos)        -> o job reembolsa;
  //   ED: etapas ENTREGUES e contestadas             -> só o admin julga (StaleDisputeNeedsJudgment).
  const wa = await newWallet("EA", 25);
  const wb = await newWallet("EB", 25);
  const wd = await newWallet("ED", 25);
  const ea = (await txApi(wa, "/api/tx/escrow", { ...mk("EA prazo longo"), deliveryDays: 30 })).meta.escrowId as string;
  const eb = (await txApi(wb, "/api/tx/escrow", { ...mk("EB prazo de 10 dias"), deliveryDays: 10 })).meta.escrowId as string;
  const ed = (await txApi(wd, "/api/tx/escrow", { ...mk("ED entregue e contestada"), deliveryDays: 1 })).meta.escrowId as string;

  // GET /api/me/escrows/:id logo depois de criar
  const dt1 = await waitFor("E1 no espelho com prazo", async () => {
    const d = await detail(w1, e1);
    return d.escrow.deliveryDeadline ? d : false;
  });
  check(dt1.escrow.feeBps === cfg0.feeBps, `API E1 feeBps: ${dt1.escrow.feeBps}`);
  check(Math.abs(Date.parse(dt1.escrow.deliveryDeadline!) / 1000 - Number(e1Acc.deliveryDeadline)) < 2, "API E1 deliveryDeadline difere do on-chain");
  check(dt1.milestones.every((m) => m.disputedAt === null && m.disputeDeadline === null && m.canCancelUndelivered === false), `API E1 campos de etapa: ${JSON.stringify(dt1.milestones)}`);
  const dt3 = await waitFor("E3 no espelho", async () => {
    const d = await detail(w3, e3);
    return d.escrow.deliveryDeadline ? d : false;
  });
  check(Math.abs(Date.parse(dt3.escrow.deliveryDeadline!) / 1000 - (chainNow + 14 * DAY)) < 300, `E3 sem deliveryDays deveria ter 14 dias: ${dt3.escrow.deliveryDeadline}`);
  check((await detail(w2, e2)).escrow.feeBps === 2000, "API E2 feeBps 2000");
  pass("GET /api/me/escrows/:id: deliveryDeadline, feeBps, disputedAt/disputeDeadline nulos e canCancelUndelivered=false antes do prazo", `E1 +1d/10%, E2 +1d/20%, E3 +14d (padrão)/20%`);

  // ===== 3. Antes do prazo: a rota recusa com a data; a rede também =====
  for (const path of [`/api/tx/escrow/${e1}/cancel-undelivered`, `/api/tx/escrows/${e1}/milestones/1/cancel-undelivered`]) {
    const rr = await call<any>(path, { method: "POST", token: w1.token, body: { index: 1 } });
    check(rr.status === 400 && rr.body.code === "cancel_not_allowed", `${path}: ${rr.status} ${JSON.stringify(rr.body)}`);
    check(rr.body.error.includes(fmtBr(new Date(Number(e1Acc.deliveryDeadline) * 1000))), `mensagem deveria trazer a data do prazo: ${rr.body.error}`);
  }
  pass("cancelamento antes do prazo: as duas rotas recusam (400 cancel_not_allowed) informando a data", (await call<any>(`/api/tx/escrow/${e1}/cancel-undelivered`, { method: "POST", token: w1.token, body: { index: 1 } })).body.error);
  await expectChainError(onchain(await c.cancelUndeliveredIxs(w1.signer.address, address(e1), 1), [w1.signer]), "DeliveryDeadlineNotReached", 6029, "cancel_undelivered antes do prazo (direto na rede)");
  pass("cancel_undelivered antes do prazo, enviado direto, é recusado on-chain (DeliveryDeadlineNotReached)");
  await expectChainError(onchain(await c.cancelUndeliveredIxs(w2.signer.address, address(e1), 1), [w2.signer]), "NotBuyer", 6021, "cancel_undelivered por outra carteira");
  await expectChainError(c.sendAsServer(await c.closeEscrowIxs(c.feePayer, address(e1))), "InvalidMilestoneStatus", 6018, "close_escrow com a garantia ainda ativa");
  pass("cancel_undelivered por outra carteira e close_escrow de garantia ativa são recusados");

  // ===== 4. Taxa congelada: etapa 0 de E1 (taxa 10%) e de E2 (taxa 20%), com Config em 20% e depois em 10% =====
  const hash32 = () => new Uint8Array(randomBytes(32));
  const amt0 = (d: Detail) => usdcToUnits(d.milestones[0]!.amountUsdc);
  const passAndRelease = async (w: Wallet, id: string, idx: number) => {
    await c.sendAsServer([await c.markPassedIx(verifier, address(id), idx, hash32())]);
    await waitFor(`etapa ${idx} de ${id.slice(0, 6)} passed no espelho`, async () => (await detail(w, id)).escrow.milestones[idx]!.status === "passed");
    return txApi(w, `/api/tx/escrow/${id}/release`, { index: idx });
  };
  // Config está em 20%: E1 (criada a 10%) tem de pagar 10%.
  const rel1 = await passAndRelease(w1, e1, 0);
  const a0 = amt0(dt1);
  let dd = await deltas(rel1.signature);
  check(dd(treasury) === (a0 * 1000n) / 10_000n && dd(creatorAta) === a0 - (a0 * 1000n) / 10_000n, `E1 (Config 20%, escrow 10%): tesouraria ${dd(treasury)}, criador ${dd(creatorAta)}, etapa ${a0}`);
  pass("taxa congelada: E1 criada a 10% paga 10% mesmo com a Config em 20%", `tesouraria ${unitsToUsdc(dd(treasury))}, criador ${unitsToUsdc(dd(creatorAta))} USDC`);
  // Config volta para 10%: E2 (criada a 20%) tem de pagar 20%.
  await c.sendAsServer([await c.updateConfigIx(admin, cfgParams)]);
  const rel2 = await passAndRelease(w2, e2, 0);
  dd = await deltas(rel2.signature);
  check(dd(treasury) === (a0 * 2000n) / 10_000n && dd(creatorAta) === a0 - (a0 * 2000n) / 10_000n, `E2 (Config 10%, escrow 20%): tesouraria ${dd(treasury)}, criador ${dd(creatorAta)}`);
  pass("taxa congelada: E2 criada a 20% paga 20% depois de a Config voltar a 10%", `tesouraria ${unitsToUsdc(dd(treasury))}, criador ${unitsToUsdc(dd(creatorAta))} USDC`);
  try {
    const row = await waitFor("chain_txs da liberação de E2", async () => psql(`select fee_bps || ',' || fee from chain_txs where signature='${rel2.signature}'`) || false, 15_000);
    check(row === `2000,${(a0 * 2000n) / 10_000n}`, `chain_txs de E2: ${row}`);
    pass("indexador grava a taxa congelada (20%) e o valor executado em chain_txs", row);
  } catch (e) {
    if ((e as Error).message.startsWith("FALHOU")) throw e;
    inconclusive("chain_txs da taxa congelada", `sem acesso ao banco (${(e as Error).message.slice(0, 80)})`);
  }

  // ===== 5. Contestação em E2 (etapa 1, ainda pendente): campos da API e recusa antes do SLA =====
  const dtE2 = await detail(w2, e2);
  const crit = dtE2.milestones[1]!.criteria[0]!;
  const dispute = await txApi(w2, `/api/tx/escrow/${e2}/dispute`, { index: 1, criterion: crit, reason: "O especialista não entregou a etapa." });
  check(dispute.events.includes("MilestoneUpdated"), "open_dispute deveria emitir MilestoneUpdated");
  const dE2 = await waitFor("disputedAt no espelho", async () => {
    const d = await detail(w2, e2);
    return d.milestones[1]!.disputedAt ? d : false;
  });
  const dAt = Date.parse(dE2.milestones[1]!.disputedAt!);
  check(Date.parse(dE2.milestones[1]!.disputeDeadline!) - dAt === 7 * DAY * 1000, "disputeDeadline deveria ser disputedAt + 7 dias");
  check(Math.abs(dAt / 1000 - (await chainClock())) < 120, "disputedAt deveria ser o horário da rede");
  check(dE2.escrow.milestones[1]!.status === "disputed" && dE2.milestones[1]!.canCancelUndelivered === false, `etapa contestada: ${JSON.stringify(dE2.escrow.milestones[1])}`);
  pass("GET /api/me/escrows/:id traz disputedAt e disputeDeadline (= +7 dias) da etapa contestada", `${dE2.milestones[1]!.disputedAt} -> ${dE2.milestones[1]!.disputeDeadline}`);
  await expectChainError(c.sendAsServer(await c.resolveStaleDisputeIxs(c.feePayer, address(e2), 1)), "DisputeSlaNotReached", 6030, "resolve_stale_dispute antes do SLA");
  pass("resolve_stale_dispute antes dos 7 dias é recusado on-chain (DisputeSlaNotReached)");
  const agentBefore = (await c.fetchAgent(fe.id)).data;

  // ----- 5b. EA/EB (nunca entregues) e ED (entregues): disputeDeadline da API e a recusa imediata do programa -----
  const disputeApi = async (w: Wallet, id: string, idx: number) => {
    const d = await detail(w, id);
    return txApi(w, `/api/tx/escrow/${id}/dispute`, { index: idx, criterion: d.milestones[idx]!.criteria[0]!, reason: "Não recebi o que foi combinado." });
  };
  const disputed = async (w: Wallet, id: string, idx: number) =>
    waitFor(`disputedAt da etapa ${idx} de ${id.slice(0, 6)}`, async () => {
      const d = await detail(w, id);
      return d.milestones[idx]!.disputedAt ? d : false;
    });
  for (const [w, id, days] of [[wa, ea, 30], [wb, eb, 10]] as const) {
    await disputeApi(w, id, 1);
    const d = await disputed(w, id, 1);
    const m = d.milestones[1]!;
    const sla = Date.parse(m.disputedAt!) + 7 * DAY * 1000;
    check(Date.parse(d.escrow.deliveryDeadline!) > sla, "o prazo de entrega deveria ser maior que o SLA");
    check(m.disputeDeadline === d.escrow.deliveryDeadline, `disputeDeadline da etapa nunca entregue (prazo de ${days} dias) deveria ser o prazo de entrega: ${m.disputeDeadline} vs ${d.escrow.deliveryDeadline}`);
    pass(`API: disputeDeadline da etapa nunca entregue e contestada = maior entre disputedAt+7d e o prazo de entrega (prazo de ${days} dias)`, m.disputeDeadline);
  }
  check((await detail(w2, e2)).milestones[1]!.disputeDeadline === new Date(dAt + 7 * DAY * 1000).toISOString(), "E2 (prazo de 1 dia): disputeDeadline deveria ser disputedAt + 7 dias");
  pass("API: com prazo de entrega de 1 dia, disputeDeadline continua disputedAt + 7 dias");

  const markPassed = async (w: Wallet, id: string, idx: number) => {
    await c.sendAsServer([await c.markPassedIx(verifier, address(id), idx, new Uint8Array(randomBytes(32)))]);
    await waitFor(`etapa ${idx} de ${id.slice(0, 6)} passed no espelho`, async () => (await detail(w, id)).escrow.milestones[idx]!.status === "passed");
  };
  for (const idx of [0, 1]) {
    await markPassed(wd, ed, idx);
    await disputeApi(wd, ed, idx);
  }
  await disputed(wd, ed, 1);
  await disputed(wd, ed, 0);
  const dED0 = await detail(wd, ed);
  check(dED0.milestones.every((m) => m.disputedAt && m.disputeDeadline === null), `ED: etapa entregue e contestada deveria ter disputeDeadline nulo: ${JSON.stringify(dED0.milestones)}`);
  pass("API: disputeDeadline é null para a etapa entregue e contestada (só o admin julga)", "disputedAt preenchido");
  for (const idx of [0, 1]) await expectChainError(c.sendAsServer(await c.resolveStaleDisputeIxs(c.feePayer, address(ed), idx)), "StaleDisputeNeedsJudgment", 6033, `resolve_stale_dispute em etapa entregue (#${idx})`);
  pass("resolve_stale_dispute em etapa entregue e contestada é recusado na hora (StaleDisputeNeedsJudgment)");

  // ===== 6. E3: encerra por aprovação do comprador; terceiro não fecha; o servidor fecha =====
  const rel3a = await txApi(w3, `/api/tx/escrow/${e3}/release`, { index: 0 });
  const rel3b = await txApi(w3, `/api/tx/escrow/${e3}/release`, { index: 1 });
  const e3Exists = async () => (await gen.fetchMaybeEscrow(c.rpc, address(e3))).exists;
  if (await e3Exists()) {
    try {
      await expectChainError(onchain(await c.closeEscrowIxs(w3.signer, address(e3)), [w3.signer]), "NotRentPayer", 6032, "close_escrow por terceiro");
      pass("close_escrow por terceiro (o próprio comprador) é recusado on-chain (NotRentPayer)");
    } catch (e) {
      if (!(await e3Exists())) inconclusive("close_escrow por terceiro", "o job do servidor fechou E3 antes da tentativa");
      else throw e;
    }
  } else inconclusive("close_escrow por terceiro", "o job do servidor fechou E3 antes da tentativa");
  await waitFor("E3 fechada pelo servidor", async () => !(await e3Exists()), 120_000, 2_000);
  const e3Row = () => psql(`select e.status || ',' || e.closed || ',' || string_agg(m.status, '/' order by m.idx) from escrows e join milestones m on m.escrow_id=e.id where e.id='${e3}' group by e.status, e.closed`);
  try {
    await waitFor("indexador marcar E3 como closed", async () => e3Row() === "approved,true,approved/approved", 30_000);
    pass("close_escrow pelo servidor (job) fecha a conta on-chain e o espelho fica approved/closed", `E3 ${e3}`);
    if (process.env.E2E_SERVER_ENV_FILE) {
      const reindex = (sig: string) => execSync(`npx tsx --env-file="${process.env.E2E_SERVER_ENV_FILE}" src/cli/reindex.ts --sig ${sig}`, { cwd: join(ROOT, "apps", "server"), stdio: "pipe" });
      // (a) Escrow já fechado quando o indexador vê a liberação: o evento sozinho precisa refazer o estado da etapa.
      psql(`update milestones set status='pending' where escrow_id='${e3}'`);
      psql(`update escrows set status='active', closed=false where id='${e3}'`);
      reindex(rel3a.signature);
      reindex(rel3b.signature);
      check(e3Row() === "approved,true,approved/approved", `reprocesso das liberações com o escrow fechado: ${e3Row()}`);
      pass("indexador, vendo a liberação de um escrow já fechado, reconstrói as etapas pelo evento (approved/approved, closed)");
      // (b) O evento EscrowClosed em si marca closed.
      const closeSig = await findCloseSignature(e3);
      check(closeSig, "não achei a transação close_escrow de E3");
      psql(`update escrows set closed=false where id='${e3}'`);
      reindex(closeSig);
      check(e3Row() === "approved,true,approved/approved", `reprocesso do close_escrow: ${e3Row()}`);
      pass("indexador processa o evento EscrowClosed e marca closed", closeSig.slice(0, 16));
    } else inconclusive("reprocesso de eventos de escrow fechado", "defina E2E_SERVER_ENV_FILE para reprocessar assinaturas com cli:reindex");
  } catch (e) {
    if ((e as Error).message.startsWith("FALHOU")) throw e;
    inconclusive("espelho de E3", `sem acesso ao banco/CLI (${(e as Error).message.slice(0, 120)})`);
  }

  if (process.env.SKIP_WARP === "1") return finish("pré-relógio");

  // ===== 7. Avança o relógio da rede =====
  const buyerBalE2 = await c.usdcBalance(w2.signer.address);
  const buyerBalE1 = await c.usdcBalance(w1.signer.address);
  await warpValidator(WARP_SLOT);
  const need = 11 * DAY;
  const ahead = await waitFor(`o relógio da rede ficar ${need}s à frente`, async () => {
    const d = (await chainClock()) - Math.floor(Date.now() / 1000);
    return d > need ? d : false;
  }, 180_000, 2_000);
  check(ahead < 29 * DAY, `o relógio avançou ${(ahead / DAY).toFixed(1)} dias: passou do prazo de 30 dias de EA (use um WARP_SLOT menor)`);
  writeFileSync(OFFSET_FILE, String(ahead));
  log("relógio avançado", `${(ahead / DAY).toFixed(2)} dias à frente (servidor acompanha via ${OFFSET_FILE})`);
  await sleep(1_500);
  await Promise.all([w1, w2, w3, wa, wb, wd].map(relogin)); // o token de 24 h venceu no relógio do servidor

  // ===== 8. E1: cancelamento depois do prazo =====
  const dE1 = await detail(w1, e1);
  check(dE1.milestones[1]!.canCancelUndelivered === true && dE1.milestones[0]!.canCancelUndelivered === false, `canCancelUndelivered depois do prazo: ${JSON.stringify(dE1.milestones.map((m) => m.canCancelUndelivered))}`);
  pass("GET /api/me/escrows/:id: canCancelUndelivered=true só na etapa pendente depois do prazo");
  const m0 = await call<any>(`/api/tx/escrow/${e1}/cancel-undelivered`, { method: "POST", token: w1.token, body: { index: 0 } });
  check(m0.status === 400 && m0.body.code === "cancel_not_allowed", `cancelar etapa já aprovada deveria ser recusado: ${JSON.stringify(m0)}`);
  await expectChainError(onchain(await c.cancelUndeliveredIxs(w1.signer.address, address(e1), 0), [w1.signer]), "InvalidMilestoneStatus", 6018, "cancel_undelivered em etapa aprovada");
  const cancel = await txApi(w1, `/api/tx/escrows/${e1}/milestones/1/cancel-undelivered`, {});
  check(cancel.events.includes("MilestoneUpdated"), `evento do cancelamento: ${cancel.events}`);
  const cd = await deltas(cancel.signature);
  const a1 = usdcToUnits(dE1.milestones[1]!.amountUsdc);
  check(cd(await c.ata(w1.signer.address)) === a1 && cd(treasury) === 0n && cd(creatorAta) === 0n, `cancelamento deveria devolver ${a1} sem taxa: comprador ${cd(await c.ata(w1.signer.address))}, tesouraria ${cd(treasury)}, criador ${cd(creatorAta)}`);
  check((await c.usdcBalance(w1.signer.address)) === buyerBalE1 + a1, "saldo do comprador de E1 deveria subir o valor da etapa");
  pass("cancel_undelivered depois do prazo devolve o valor da etapa sem taxa", `+${unitsToUsdc(a1)} USDC ao comprador; tesouraria e criador sem variação`);
  const ref = await waitFor("etapa refunded no espelho de E1", async () => {
    const d = await detail(w1, e1);
    return d.escrow.milestones[1]!.status === "refunded" ? d : false;
  });
  pass("indexador marca a etapa cancelada como refunded", `status da garantia: ${ref.escrow.status}`);
  const again = await call<any>(`/api/tx/escrow/${e1}/cancel-undelivered`, { method: "POST", token: w1.token, body: { index: 1 } });
  check(again.status === 400, "segundo cancelamento deveria ser recusado pela API");
  await expectChainError(onchain(await c.cancelUndeliveredIxs(w1.signer.address, address(e1), 1), [w1.signer]), "InvalidMilestoneStatus", 6018, "segundo cancel_undelivered");
  pass("segundo cancelamento da mesma etapa é recusado (API e rede)");

  // ===== 9. Disputa parada: o job do servidor e o programa =====
  // Direto na rede, com o relógio ~13,9 dias à frente: EA (prazo de 30 dias) e ED (entregue) são recusadas.
  await expectChainError(c.sendAsServer(await c.resolveStaleDisputeIxs(c.feePayer, address(ea), 1)), "DeliveryDeadlineNotReached", 6029, "resolve_stale_dispute depois dos 7 dias mas antes do prazo de entrega");
  pass("resolve_stale_dispute com o SLA de 7 dias vencido mas ANTES do prazo de entrega é recusado (DeliveryDeadlineNotReached)");
  for (const idx of [0, 1]) await expectChainError(c.sendAsServer(await c.resolveStaleDisputeIxs(c.feePayer, address(ed), idx)), "StaleDisputeNeedsJudgment", 6033, `etapa entregue #${idx} depois de 7+ dias`);
  pass("resolve_stale_dispute em etapa entregue e contestada continua recusado depois de 7+ dias (StaleDisputeNeedsJudgment)");

  // O Postgres não anda no tempo da rede. Para o filtro SQL do job (now()) deixar passar, recua disputed_at em 8 dias e o prazo de
  // entrega (do espelho) em 45 dias; em ED também zera passed_at no espelho. Assim o job chega a consultar a conta on-chain
  // de EA e ED, e quem tem de barrá-las é a regra do programa/servidor (staleDisputeDue), não o filtro de horário do banco.
  try {
    psql(`update milestones set disputed_at = disputed_at - interval '8 days' where disputed_at is not null and escrow_id in ('${e2}','${ea}','${eb}','${ed}')`);
    psql(`update escrows set delivery_deadline = delivery_deadline - interval '45 days' where id in ('${e2}','${ea}','${eb}','${ed}')`);
    psql(`update milestones set passed_at = null where escrow_id='${ed}'`);
  } catch (e) {
    throw new Error(`FALHOU: sem acesso ao banco para recuar datas: ${(e as Error).message}`);
  }
  const t1 = Date.now();
  const e2Done = await waitFor("o job do servidor resolver a disputa parada de E2", async () => {
    const d = await detail(w2, e2);
    return d.escrow.milestones[1]!.status === "refunded" ? d : false;
  }, 240_000, 3_000);
  pass("job do servidor resolve a disputa parada (resolve_stale_dispute) e o indexador marca refunded", `${Math.round((Date.now() - t1) / 1000)} s; garantia ${e2Done.escrow.status}`);
  const a1e2 = usdcToUnits(dE2.milestones[1]!.amountUsdc);
  check((await c.usdcBalance(w2.signer.address)) === buyerBalE2 + a1e2, `comprador de E2 deveria receber ${a1e2} de volta (sem taxa)`);
  const agentAfter = (await c.fetchAgent(fe.id)).data;
  check(agentAfter.disputesLost === agentBefore.disputesLost, "disputa parada não deve contar como disputa perdida do solver");
  const rep = await ok<{ disputesLost: number }>("/api/me/reputation", { token: w2.token });
  check(rep.disputesLost === 0, `comprador não perdeu a disputa: ${JSON.stringify(rep)}`);
  pass("disputa parada devolve a etapa sem taxa e sem mexer na reputação (solver nem comprador)", `+${unitsToUsdc(a1e2)} USDC ao comprador`);
  const adminToken = await login(admin);
  const adm = await call<any>(`/api/admin/escrow/${e2}/resolve`, { method: "POST", token: adminToken, body: { index: 1, refund: false } });
  check(adm.status >= 400, `resolução do admin depois da stale deveria ser recusada: ${adm.status}`);
  pass("admin não consegue julgar de novo uma etapa já devolvida pelo prazo", `${adm.status} ${adm.body.error ?? ""}`);

  // EB (SLA e prazo de 10 dias vencidos) também é reembolsada pelo job.
  const ebDone = await waitFor("o job reembolsar EB (nunca entregue, SLA e prazo vencidos)", async () => {
    const d = await detail(wb, eb);
    return d.escrow.milestones[1]!.status === "refunded" ? d : false;
  }, 180_000, 3_000);
  pass("job reembolsa a etapa nunca entregue depois do SLA E do prazo de entrega (EB, prazo de 10 dias)", `garantia ${ebDone.escrow.status}`);

  // Um ciclo inteiro do job depois (60 s), EA e ED têm de continuar contestadas na conta on-chain e no espelho.
  console.log("… aguardando mais um ciclo do job para provar que EA e ED não são reembolsadas");
  await sleep(75_000);
  const onchainStatus = async (id: string, idx: number) => (await gen.fetchEscrow(c.rpc, address(id))).data.milestones[idx]!.status;
  check((await onchainStatus(ea, 1)) === gen.MilestoneStatus.Disputed, "EA: o job NÃO deveria ter reembolsado antes do prazo de entrega");
  for (const idx of [0, 1]) check((await onchainStatus(ed, idx)) === gen.MilestoneStatus.Disputed, `ED #${idx}: o job NÃO deveria ter reembolsado etapa entregue`);
  check((await detail(wa, ea)).escrow.milestones[1]!.status === "disputed" && (await detail(wd, ed)).escrow.milestones.every((m) => m.status === "disputed"), "espelho de EA/ED deveria seguir disputed");
  pass("job NÃO reembolsa EA (SLA vencido, prazo de entrega não) nem ED (etapas entregues), mesmo com o banco dizendo que venceu", "contas on-chain seguem Disputed");

  // O admin ainda julga a etapa entregue: reembolso na #0 e pagamento na #1 (taxa congelada de ED = 20%, Config = 10%).
  const amtD = (await detail(wd, ed)).milestones.map((m) => usdcToUnits(m.amountUsdc));
  const r0 = await ok<{ signature: string }>(`/api/admin/escrow/${ed}/resolve`, { method: "POST", token: adminToken, body: { index: 0, refund: true } });
  const dr0 = await deltas(r0.signature);
  check(dr0(await c.ata(wd.signer.address)) === amtD[0]! && dr0(treasury) === 0n && dr0(creatorAta) === 0n, `admin reembolsa ED #0: comprador ${dr0(await c.ata(wd.signer.address))}, tesouraria ${dr0(treasury)}`);
  const r1 = await ok<{ signature: string }>(`/api/admin/escrow/${ed}/resolve`, { method: "POST", token: adminToken, body: { index: 1, refund: false } });
  const dr1 = await deltas(r1.signature);
  check(dr1(treasury) === (amtD[1]! * 2000n) / 10_000n && dr1(creatorAta) === amtD[1]! - (amtD[1]! * 2000n) / 10_000n, `admin paga ED #1 com a taxa congelada (20%): tesouraria ${dr1(treasury)}, criador ${dr1(creatorAta)}`);
  pass("admin ainda resolve a etapa entregue e contestada: reembolso (#0) e pagamento com a taxa congelada de 20% (#1)", `taxa ${unitsToUsdc(dr1(treasury))} USDC`);
  await waitFor("ED resolvida no espelho", async () => {
    const d = await detail(wd, ed);
    return d.escrow.milestones[0]!.status === "refunded" && d.escrow.milestones[1]!.status === "approved" ? d : false;
  });

  // ===== 10. Fechamento pelo servidor =====
  for (const [name, id] of [["E1", e1], ["E2", e2], ["ED", ed]] as const) {
    await waitFor(`o servidor fechar ${name}`, async () => !(await gen.fetchMaybeEscrow(c.rpc, address(id))).exists, 180_000, 3_000);
    await waitFor(`${name} closed no espelho`, async () => psql(`select closed from escrows where id='${id}'`) === "t", 30_000);
    const d = await detail(name === "E1" ? w1 : name === "E2" ? w2 : wd, id);
    check(d.escrow.milestones.every((m) => m.status === "approved" || m.status === "refunded"), `${name} depois de fechada: ${JSON.stringify(d.escrow.milestones)}`);
  }
  pass("job do servidor fecha E1, E2 e ED (contas somem) e o espelho mantém as etapas com o estado final", "approved/refunded preservados");
  finish("completo");
}

function finish(mode: string) {
  console.log(`\nResumo (${mode}):`);
  for (const r of results) console.log(` ${r.status === "ok" ? "ok" : "??"}  ${r.name}${r.note ? ` (${r.note})` : ""}`);
  console.log(`\nE2E v2 OK (${results.filter((r) => r.status === "ok").length} verificações, ${results.filter((r) => r.status !== "ok").length} inconclusivas)`);
}

await main().catch((e) => {
  console.error(e);
  process.exit(1);
});
