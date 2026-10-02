// E2E do agente que COMPRA por x402 e usa o Solver (docs/x402-agentes.md, seções 1 e 6.11), na devnet, de carteira nova:
//   cotação -> 402 -> pagamento recusado se adulterado -> compra (200, licença NA carteira do agente, USDC debitado exato)
//   -> login SIWS do agente -> list_my_solvers / activate_solver (access = licença) / next_step / run_tool -> segunda compra = 409 sem cobrança
//   -> (com API_FAIL_MINT_URL) emissão que falha depois do pagamento: 502 mint_failed, refunded e saldo de volta.
//
// Servidor no ar com X402_ENABLED=true e CUSTODY_KEYPAIR (cli:x402-setup). Uso (a partir de scripts/):
//   API_URL=http://127.0.0.1:3027 [API_FAIL_MINT_URL=http://127.0.0.1:3028] [E2E_SLUG=frontend-react] \
//   node --env-file=<repo>/apps/server/.env.devnet --import tsx src/e2e-agent.ts
// Variáveis de rede (SOLANA_RPC_URL, USDC_MINT) vêm do .env.devnet; o fee payer (mint authority do USDC de teste) é o KEY_FEE_PAYER
// (ou o FEE_PAYER_KEYPAIR do mesmo arquivo). A carteira do agente é gerada a cada execução e só precisa de USDC (nunca de SOL).
import { generateKeyPairSigner, type KeyPairSigner } from "@solana/kit";
import { address } from "@solvers/chain";
import { unitsToUsdc, usdcToUnits } from "@solvers/shared";
import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { call, connectAgent, rpc } from "./lib/agent-client.js";
import { chain, log } from "./env.js";

process.env.KEY_FEE_PAYER ??= process.env.FEE_PAYER_KEYPAIR;

const API = (process.env.API_URL ?? "http://localhost:3017").replace(/\/$/, "");
const FAIL_API = process.env.API_FAIL_MINT_URL?.replace(/\/$/, "");
const SLUG = process.env.E2E_SLUG ?? "frontend-react";
const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const USDC_MINT = process.env.USDC_MINT ?? "";
const NETWORK = process.env.X402_NETWORK ?? "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
}

/** Cliente x402 do agente. O padrão do SDK recusa mint fora da lista dele e limita US$ 1 por pagamento: libera o nosso USDC até 100. */
function x402For(signer: KeyPairSigner) {
  return x402Client.fromConfig({
    schemes: [{ network: NETWORK, client: new ExactSvmScheme(signer, { rpcUrl: RPC_URL }) }],
    spendControls: { maxAmountPerPayment: false, allowedAssets: [{ network: NETWORK, asset: USDC_MINT, maxAmountPerPayment: "100000000" }] },
  } as never);
}

const c = await chain();

/** Compra o Solver pelo cliente x402 (fetch embrulhado: 402 -> paga -> repete). Devolve a resposta final e o id da ordem. */
async function buy(api: string, signer: KeyPairSigner, agentId: string) {
  let orderId: string | undefined;
  const spy: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    if (res.status === 402) orderId ??= (await res.clone().json().catch(() => null))?.accepts?.[0]?.extra?.memo;
    return res;
  };
  const res = await wrapFetchWithPayment(spy, x402For(signer))(`${api}/api/x402/solvers/${agentId}/license`, { method: "POST" });
  return { res, orderId };
}

async function main() {
  // ---------- 1. Cotação ----------
  const quote = (await (await fetch(`${API}/api/x402/solvers/${SLUG}`)).json()) as {
    agentId: string; priceUsdc: string; available: boolean; payTo: string; asset: string; network: string; endpoint: string;
  };
  check(quote.available, `solver ${SLUG} indisponível: ${JSON.stringify(quote)}`);
  check(quote.asset === USDC_MINT, `a cotação anuncia outro USDC (${quote.asset}) que o do .env (${USDC_MINT})`);
  const price = usdcToUnits(Number(quote.priceUsdc));
  log("1. cotação", `${SLUG}: ${quote.priceUsdc} USDC, custódia ${quote.payTo}`);

  // ---------- 2. Agente novo, só com USDC ----------
  const agent = await generateKeyPairSigner();
  await c.faucet(agent.address, price + usdcToUnits(5));
  const before = await c.usdcBalance(agent.address);
  check((await c.solBalance(agent.address)) === 0n, "o agente não deve ter SOL (a plataforma paga a taxa)");
  log("2. agente criado, sem SOL", { wallet: agent.address, usdc: unitsToUsdc(before) });

  // ---------- 3. O 402 ----------
  const r402 = await fetch(`${API}/api/x402/solvers/${quote.agentId}/license`, { method: "POST" });
  check(r402.status === 402, `esperava 402, veio ${r402.status}`);
  check(/no-store/.test(r402.headers.get("cache-control") ?? ""), "402 sem Cache-Control no-store");
  const header = r402.headers.get("payment-required");
  check(header, "402 sem o cabeçalho PAYMENT-REQUIRED");
  const required = decodePaymentRequiredHeader(header);
  const body = (await r402.json()) as typeof required;
  check(JSON.stringify(required) === JSON.stringify(body), "PAYMENT-REQUIRED difere do corpo do 402");
  const accepts = required.accepts[0]!;
  check(accepts.amount === price.toString() && accepts.asset === USDC_MINT && accepts.payTo === quote.payTo, "accepts não bate com a cotação");
  const memo = (accepts.extra as { memo: string }).memo;
  check(/^ord_[0-9a-f]{24}$/.test(memo), `memo inesperado: ${memo}`);
  log("3. 402 com ordem de preço travado", { orderId: memo, amount: accepts.amount });

  // ---------- 4. Pagamento adulterado é recusado SEM mover dinheiro ----------
  const tamper = async (patch: (a: typeof accepts) => typeof accepts) => {
    const forged = { ...required, accepts: [patch(structuredClone(accepts))] };
    const payload = await x402For(agent).createPaymentPayload(forged as never);
    return fetch(`${API}/api/x402/solvers/${quote.agentId}/license`, { method: "POST", headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) } });
  };
  const cheap = await tamper((a) => ({ ...a, amount: "5000000" }));
  const cheapBody = (await cheap.json()) as { code?: string; field?: string };
  check(cheap.status === 400 && cheapBody.code === "payment_mismatch" && cheapBody.field === "amount", `valor menor deveria dar 400 payment_mismatch: ${cheap.status} ${JSON.stringify(cheapBody)}`);
  const ghost = await tamper((a) => ({ ...a, extra: { ...a.extra, memo: `ord_${"0".repeat(24)}` } }));
  const ghostBody = (await ghost.json()) as { code?: string };
  check(ghost.status === 409 && ghostBody.code === "order_invalid", `ordem inexistente deveria dar 409 order_invalid: ${ghost.status} ${JSON.stringify(ghostBody)}`);
  check((await c.usdcBalance(agent.address)) === before, "pagamento adulterado moveu dinheiro");
  log("4. valor adulterado e ordem inexistente recusados, nenhum USDC movido");

  // ---------- 5. Compra ----------
  const t0 = Date.now();
  const { res: bought, orderId } = await buy(API, agent, quote.agentId);
  const done = (await bought.json()) as { agentId: string; asset: string; owner: string; paymentSignature: string; mintSignature: string; code?: string; error?: string };
  check(bought.status === 200, `compra deveria dar 200, veio ${bought.status}: ${JSON.stringify(done)}`);
  check(/no-store/.test(bought.headers.get("cache-control") ?? ""), "resposta paga sem Cache-Control no-store");
  const settle = decodePaymentResponseHeader(bought.headers.get("payment-response") ?? "");
  check(settle.success && settle.transaction === done.paymentSignature && settle.payer === agent.address, `PAYMENT-RESPONSE inconsistente: ${JSON.stringify(settle)}`);
  check(done.owner === agent.address, "o dono informado não é o agente");
  const core = await c.fetchCoreAsset(address(done.asset));
  check(core?.owner === agent.address, `o NFT não está na carteira do agente (dono on-chain: ${core?.owner})`);
  const after = await c.usdcBalance(agent.address);
  check(before - after === price, `o débito deveria ser exatamente o preço: debitou ${before - after}, preço ${price}`);
  check((await c.usdcBalance(address(quote.payTo))) === 0n, "a custódia deveria terminar sem USDC (entra e sai na mesma operação)");
  log(`5. comprou em ${Date.now() - t0} ms: licença na carteira do agente`, { asset: done.asset, pagamento: done.paymentSignature, emissão: done.mintSignature });

  // ---------- 6. Estado da ordem ----------
  const order = (await (await fetch(`${API}/api/x402/orders/${orderId}`)).json()) as { status: string; owner: string; asset: string };
  check(order.status === "minted" && order.owner === agent.address && order.asset === done.asset, `ordem inconsistente: ${JSON.stringify(order)}`);
  log("6. ordem", order.status);

  // ---------- 7. Usa o Solver: login SIWS em duas chamadas ----------
  const { accessToken: token } = await connectAgent(agent, { memory: true });
  const mine = await call(token, "list_my_solvers");
  check(mine.includes(quote.agentId), `list_my_solvers não mostra o Solver comprado:\n${mine}`);
  const act = await call(token, "activate_solver", { agent_id: quote.agentId });
  const sessionId = /session_id: (ses_[0-9a-f]+)/.exec(act)?.[1];
  check(sessionId, `activate_solver não abriu sessão:\n${act}`);
  check(act.includes("licença vitalícia"), `esperava access = licença:\n${act}`);
  log("7. list_my_solvers e activate_solver", "acesso por licença vitalícia");
  const step = await call(token, "next_step", { session_id: sessionId, completed_step: 0 });
  check(step.length > 0, "next_step vazio");
  if (act.includes("a11y_check")) {
    const out = await call(token, "run_tool", {
      session_id: sessionId,
      tool: "a11y_check",
      input: { files: { "Bad.tsx": '<div onClick={x}><img src="a.png"/><input id="e"/></div>' } },
    });
    log("   run_tool a11y_check", `${JSON.parse(out).issues.length} problemas`);
  }
  void rpc;

  // ---------- 8. Segunda compra: 409 sem cobrança ----------
  // Com saldo para pagar de novo (o `verify` do facilitator simula o pagamento: sem saldo ele recusa antes da guarda de posse).
  await c.faucet(agent.address, price);
  const funded = await c.usdcBalance(agent.address);
  const dup = await buy(API, agent, quote.agentId);
  const dupBody = (await dup.res.json()) as { code?: string; assetId?: string };
  check(dup.res.status === 409 && dupBody.code === "already_owned", `segunda compra deveria dar 409 already_owned: ${dup.res.status} ${JSON.stringify(dupBody)}`);
  check(dupBody.assetId === done.asset, "already_owned deveria informar a licença que o agente já tem");
  check((await c.usdcBalance(agent.address)) === funded, "a segunda compra cobrou");
  log("8. segunda compra", "409 already_owned, nenhum USDC movido");

  // ---------- 9. Emissão que falha depois do pagamento: reembolso ----------
  if (FAIL_API) {
    const victim = await generateKeyPairSigner();
    await c.faucet(victim.address, price + usdcToUnits(5));
    const bal = await c.usdcBalance(victim.address);
    const r = await buy(FAIL_API, victim, quote.agentId);
    const rb = (await r.res.json()) as { code?: string; refunded?: boolean; refundSignature?: string };
    check(r.res.status === 502 && rb.code === "mint_failed" && rb.refunded === true && rb.refundSignature, `esperava 502 mint_failed refunded: ${r.res.status} ${JSON.stringify(rb)}`);
    check((await c.usdcBalance(victim.address)) === bal, "o reembolso não devolveu o saldo original");
    check((await c.usdcBalance(address(quote.payTo))) === 0n, "a custódia ficou com USDC depois do reembolso");
    const st = (await (await fetch(`${FAIL_API}/api/x402/orders/${r.orderId}`)).json()) as { status: string; refunded: boolean };
    check(st.status === "refunded" && st.refunded, `ordem deveria estar refunded: ${JSON.stringify(st)}`);
    log("9. emissão falhou depois do pagamento", { status: 502, refundSignature: rb.refundSignature, saldoDevolvido: unitsToUsdc(bal) });
  } else {
    log("9. reembolso", "pulado (defina API_FAIL_MINT_URL com um servidor X402_TEST_FAIL_MINT=true)");
  }

  console.log("\nE2E do agente (compra por x402) OK");
}

await main();
