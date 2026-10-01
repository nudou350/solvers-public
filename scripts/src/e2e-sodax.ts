// E2E da opção de pagamento SODAX na demo: cotação REAL (API pública do SODAX) -> cobrança -> pagamento de
// teste simulado -> USDC de teste creditado uma única vez -> compra da licença com o saldo.
// Requer o servidor fora da mainnet com SODAX_SIMULATE (padrão) e acesso à internet (a cotação é real).
import { generateKeyPairSigner } from "@solana/kit";
import { api, login, signAsWallet } from "./e2e-api.js";
import { log } from "./env.js";

type Charge = {
  id: string;
  provider: string;
  status: string;
  amountBrl: number;
  amountUsdc: number;
  creditSignature: string | null;
  purpose: { agentId: string; type: string } | null;
  simulated: boolean;
};
type Quote = { source: { key: string; label: string; symbol: string }; payAmount: number; receiveUsdc: number; needUsdc: number; minApplied: boolean; quotedAt: string };

async function expectStatus(p: Promise<unknown>, status: number, what: string) {
  const r = await p.then(
    () => null,
    (e: Error) => e,
  );
  if (!r || !r.message.includes(`-> ${status}`)) throw new Error(`${what}: esperava ${status}, veio ${r?.message ?? "sucesso"}`);
}

async function main() {
  const config = await api<{ sodax?: { enabled: boolean; simulate: boolean; sources: { key: string }[] }; pix: { enabled: boolean } }>("/api/config");
  if (!config.sodax?.enabled || !config.sodax.simulate) throw new Error(`SODAX/simulação desligados: ${JSON.stringify(config.sodax)}`);
  log("config.sodax", `${config.sodax.sources.map((s) => s.key).join(", ")}`);

  const buyer = await generateKeyPairSigner();
  const token = await login(buyer);
  const post = <T>(path: string, body?: unknown, t = token) =>
    api<T>(path, { method: "POST", token: t, body: body === undefined ? undefined : JSON.stringify(body) });

  const agents = await api<{ id: string; slug: string; priceUsdc: number }[]>("/api/agents");
  const ag = agents.find((a) => a.slug === "frontend-react") ?? agents[0]!;
  // `null` = sem login (undefined ativaria o valor padrão do parâmetro).
  const q = (source: string, t: string | null = token) =>
    api<Quote>(`/api/sodax/quote?agentId=${ag.id}&type=permanent&source=${source}`, t ? { token: t } : {});

  // 1. Cotação real de cada origem cobre o valor necessário
  for (const { key } of config.sodax.sources) {
    const quote = await q(key);
    if (quote.source.key !== key || !(quote.payAmount > 0) || quote.receiveUsdc + 1e-9 < quote.needUsdc || quote.needUsdc !== ag.priceUsdc) {
      throw new Error(`cotação ${key} inesperada: ${JSON.stringify(quote)}`);
    }
    log(`cotação ${key}`, `${quote.payAmount} ${quote.source.symbol} -> ${quote.receiveUsdc} USDC (precisa ${quote.needUsdc})`);
  }
  await expectStatus(q("btc-mainnet"), 400, "origem desconhecida");
  await expectStatus(q("eth-base", null), 401, "cotação sem login");
  log("origem desconhecida e sem login recusadas", "400 / 401");

  // 2. Cobrança calculada para a licença (saldo zero: cobra o preço inteiro)
  const charge = await post<Charge>("/api/sodax/charges", { agentId: ag.id, type: "permanent", source: "eth-base" });
  if (charge.provider !== "sodax" || charge.status !== "pending" || charge.amountUsdc !== ag.priceUsdc || charge.purpose?.agentId !== ag.id || !charge.simulated) {
    throw new Error(`cobrança inesperada: ${JSON.stringify(charge)}`);
  }
  log("cobrança criada", `${charge.id}: R$ ${charge.amountBrl} -> ${charge.amountUsdc} USDC (${charge.provider})`);
  await expectStatus(post("/api/sodax/charges", { agentId: ag.id, type: "permanent", source: "eth-base", extra: 1 }), 400, "campo extra");
  await expectStatus(post("/api/sodax/charges", { agentId: ag.id, type: "permanent", source: "btc-mainnet" }), 400, "origem desconhecida na cobrança");

  // Outra carteira não enxerga nem paga a cobrança
  const stranger = await login(await generateKeyPairSigner());
  await expectStatus(api(`/api/pix/charges/${charge.id}`, { token: stranger }), 404, "cobrança de outra carteira");
  await expectStatus(post(`/api/sodax/charges/${charge.id}/simulate`, undefined, stranger), 404, "simular cobrança de outra carteira");
  // O simulate do SODAX só vale para cobranças SODAX
  const pix = await post<Charge>("/api/pix/charges", { usdc: 2 });
  await expectStatus(post(`/api/sodax/charges/${pix.id}/simulate`), 400, "simulate SODAX numa cobrança Pix");
  log("isolamento entre carteiras e entre provedores", "404 / 400");

  // 3. Pagamento de teste -> crédito
  const paid = await post<Charge>(`/api/sodax/charges/${charge.id}/simulate`);
  if (paid.status !== "credited" || !paid.creditSignature) throw new Error(`esperava credited: ${JSON.stringify(paid)}`);
  const bal1 = (await api<{ usdc: number }>("/api/me/balance", { token })).usdc;
  if (Math.abs(bal1 - charge.amountUsdc) > 1e-9) throw new Error(`saldo ${bal1}, esperava ${charge.amountUsdc}`);
  const got = await api<Charge>(`/api/pix/charges/${charge.id}`, { token });
  if (got.status !== "credited") throw new Error(`GET deveria mostrar credited: ${got.status}`);
  log("pagamento de teste e USDC creditado", `${bal1} USDC (${paid.creditSignature.slice(0, 16)}...)`);

  // 4. Idempotência: simular de novo (e em paralelo) não credita outra vez
  const again = await Promise.all([post<Charge>(`/api/sodax/charges/${charge.id}/simulate`), post<Charge>(`/api/sodax/charges/${charge.id}/simulate`)]);
  if (again.some((c) => c.creditSignature !== paid.creditSignature)) throw new Error("assinatura do crédito mudou");
  const bal2 = (await api<{ usdc: number }>("/api/me/balance", { token })).usdc;
  if (bal2 !== bal1) throw new Error(`crédito duplicado: ${bal1} -> ${bal2}`);
  log("simular de novo não credita outra vez", `${bal2} USDC`);

  // 5. Com saldo suficiente, nem cotação nem cobrança
  await expectStatus(q("eth-base"), 400, "cotação com saldo suficiente");
  await expectStatus(post("/api/sodax/charges", { agentId: ag.id, type: "permanent", source: "eth-base" }), 400, "cobrança com saldo suficiente");
  log("com saldo suficiente a cobrança é recusada", "400");

  // 6. Compra da licença com o saldo
  const built = await post<{ transaction: string; meta: { asset: string } }>("/api/tx/purchase", { agentId: ag.id, type: "permanent" });
  const sub = await post<{ status: string }>("/api/tx/submit", { transaction: await signAsWallet(buyer, built.transaction) });
  const lic = await api<{ id: string }[]>("/api/me/licenses", { token });
  if (sub.status !== "confirmed" || !lic.some((l) => l.id === built.meta.asset)) throw new Error("licença não apareceu");
  log("licença comprada com o USDC do SODAX (teste)", built.meta.asset);

  // 7. No máximo 3 cobranças pendentes por carteira (contadas junto com as do Pix)
  const other = await login(await generateKeyPairSigner());
  for (let i = 0; i < 3; i++) await post("/api/sodax/charges", { agentId: ag.id, type: "permanent", source: "usdc-base" }, other);
  await expectStatus(post("/api/sodax/charges", { agentId: ag.id, type: "permanent", source: "usdc-base" }, other), 429, "quarta cobrança pendente");
  log("limite de 3 cobranças pendentes", "429");

  log("e2e SODAX ok", "");
}

main().catch((e) => {
  console.error("✖", e instanceof Error ? e.message : e);
  process.exit(1);
});
