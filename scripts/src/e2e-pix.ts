// E2E do Pix na demo (Fase B): cobrança calculada para um especialista -> pagamento simulado ->
// USDC de teste creditado uma única vez -> compra da licença com o saldo -> webhook do Mercado Pago
// recusa assinatura inválida e aceita uma assinatura válida.
// Requer o servidor fora da mainnet com PIX_SIMULATE (padrão). Para testar a assinatura válida,
// o servidor e este script precisam do mesmo MP_WEBHOOK_SECRET (lido do ambiente ou de apps/server/.env).
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPairSigner } from "@solana/kit";
import { api, login, signAsWallet } from "./e2e-api.js";
import { log } from "./env.js";

const API = process.env.API_URL ?? "http://localhost:3017";
const ROOT = join(import.meta.dirname, "..", "..");

type Charge = {
  id: string;
  provider: string;
  status: string;
  amountBrl: number;
  amountUsdc: number;
  qrCode: string | null;
  creditSignature: string | null;
  purpose: { agentId: string; type: string } | null;
  simulated: boolean;
};

function webhookSecret(): string | undefined {
  if (process.env.MP_WEBHOOK_SECRET) return process.env.MP_WEBHOOK_SECRET;
  const f = join(ROOT, "apps", "server", ".env");
  if (!existsSync(f)) return undefined;
  return /^MP_WEBHOOK_SECRET=(.+)$/m.exec(readFileSync(f, "utf8"))?.[1]?.trim();
}

async function expectStatus(p: Promise<unknown>, status: number, what: string) {
  const r = await p.then(
    () => null,
    (e: Error) => e,
  );
  if (!r || !r.message.includes(`-> ${status}`)) throw new Error(`${what}: esperava ${status}, veio ${r?.message ?? "sucesso"}`);
}

async function webhook(dataId: string, headers: Record<string, string>) {
  return fetch(`${API}/webhooks/mercadopago?data.id=${encodeURIComponent(dataId)}&type=order`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ action: "order.processed", type: "order", data: { id: dataId, status: "processed" } }),
  });
}

async function main() {
  const config = await api<{ cluster: string; pix: { enabled: boolean; simulate: boolean; provider: string | null } }>("/api/config");
  if (!config.pix.enabled || !config.pix.simulate) throw new Error(`Pix/simulação desligados: ${JSON.stringify(config.pix)}`);
  log("config.pix", config.pix);

  const buyer = await generateKeyPairSigner();
  const token = await login(buyer);
  const post = <T>(path: string, body?: unknown) =>
    api<T>(path, { method: "POST", token, body: body === undefined ? undefined : JSON.stringify(body) });

  const agents = await api<{ id: string; slug: string; priceUsdc: number }[]>("/api/agents");
  const fe = agents.find((a) => a.slug === "frontend-react") ?? agents[0]!;

  // 1. Cobrança calculada para a licença (saldo zero: cobra o preço inteiro)
  const charge = await post<Charge>("/api/pix/charges", { agentId: fe.id, type: "permanent" });
  if (charge.status !== "pending" || charge.amountUsdc !== fe.priceUsdc || charge.purpose?.agentId !== fe.id) {
    throw new Error(`cobrança inesperada: ${JSON.stringify(charge)}`);
  }
  if (config.pix.provider === "simulated" && !charge.qrCode?.includes("TESTE")) throw new Error("copia e cola simulado deveria ser marcado como teste");
  log("cobrança criada", `${charge.id}: R$ ${charge.amountBrl} -> ${charge.amountUsdc} USDC (${charge.provider})`);

  // Outra carteira não enxerga a cobrança
  const stranger = await login(await generateKeyPairSigner());
  await expectStatus(api(`/api/pix/charges/${charge.id}`, { token: stranger }), 404, "cobrança de outra carteira");

  // 2. Pagamento simulado -> crédito
  const paid = await post<Charge>(`/api/pix/charges/${charge.id}/simulate`);
  if (paid.status !== "credited" || !paid.creditSignature) throw new Error(`esperava credited: ${JSON.stringify(paid)}`);
  const bal1 = (await api<{ usdc: number }>("/api/me/balance", { token })).usdc;
  if (bal1 !== charge.amountUsdc) throw new Error(`saldo ${bal1}, esperava ${charge.amountUsdc}`);
  const got = await api<Charge>(`/api/pix/charges/${charge.id}`, { token });
  if (got.status !== "credited") throw new Error(`GET deveria mostrar credited: ${got.status}`);
  log("pagamento simulado e USDC creditado", `${bal1} USDC (${paid.creditSignature.slice(0, 16)}...)`);

  // 3. Idempotência: simular de novo (e em paralelo) não credita outra vez
  const again = await Promise.all([post<Charge>(`/api/pix/charges/${charge.id}/simulate`), post<Charge>(`/api/pix/charges/${charge.id}/simulate`)]);
  if (again.some((c) => c.creditSignature !== paid.creditSignature)) throw new Error("assinatura do crédito mudou");
  const bal2 = (await api<{ usdc: number }>("/api/me/balance", { token })).usdc;
  if (bal2 !== bal1) throw new Error(`crédito duplicado: ${bal1} -> ${bal2}`);
  log("simular de novo não credita outra vez", `${bal2} USDC`);

  // Corrida: três aprovações simultâneas de uma cobrança nova creditam uma vez só
  const race = await post<Charge>("/api/pix/charges", { usdc: 2 });
  const results = await Promise.allSettled([1, 2, 3].map(() => post<Charge>(`/api/pix/charges/${race.id}/simulate`)));
  const sigs = new Set(results.flatMap((r) => (r.status === "fulfilled" && r.value.creditSignature ? [r.value.creditSignature] : [])));
  const bal2b = (await api<{ usdc: number }>("/api/me/balance", { token })).usdc;
  if (sigs.size !== 1 || Math.abs(bal2b - bal2 - race.amountUsdc) > 1e-9) throw new Error(`corrida creditou errado: ${bal2} -> ${bal2b}, ${sigs.size} assinaturas`);
  log("aprovações simultâneas creditam uma vez", `+${race.amountUsdc} USDC`);

  // Com saldo suficiente, a cobrança para a mesma compra é recusada
  await expectStatus(post("/api/pix/charges", { agentId: fe.id, type: "permanent" }), 400, "cobrança com saldo suficiente");
  // Limites de valor
  await expectStatus(post("/api/pix/charges", { usdc: 0.01 }), 400, "abaixo de R$ 1");
  await expectStatus(post("/api/pix/charges", { usdc: 999 }), 400, "acima de R$ 500");
  log("limites: saldo suficiente, mínimo e máximo recusados", "400");

  // 4. Compra da licença com o saldo
  const built = await post<{ transaction: string; meta: { asset: string } }>("/api/tx/purchase", { agentId: fe.id, type: "permanent" });
  const sub = await post<{ status: string; events: string[] }>("/api/tx/submit", { transaction: await signAsWallet(buyer, built.transaction) });
  const lic = await api<{ id: string }[]>("/api/me/licenses", { token });
  if (sub.status !== "confirmed" || !lic.some((l) => l.id === built.meta.asset)) throw new Error("licença não apareceu");
  log("licença comprada com o USDC do Pix", built.meta.asset);

  // 5. No máximo 3 cobranças pendentes por carteira
  for (let i = 0; i < 3; i++) await post("/api/pix/charges", { usdc: 1 });
  await expectStatus(post("/api/pix/charges", { usdc: 1 }), 429, "quarta cobrança pendente");
  log("limite de 3 cobranças pendentes", "429");

  // 6. Webhook do Mercado Pago
  const orderId = `ORD${randomBytes(12).toString("hex").toUpperCase()}`;
  const noSig = await webhook(orderId, {});
  const badSig = await webhook(orderId, { "x-signature": `ts=${Date.now()},v1=${"0".repeat(64)}`, "x-request-id": "e2e" });
  if (noSig.status !== 401 || badSig.status !== 401) throw new Error(`webhook sem/errada assinatura: ${noSig.status}/${badSig.status}`);
  log("webhook com assinatura ausente ou inválida recusado", "401");
  const secret = webhookSecret();
  if (!secret) {
    log("webhook com assinatura válida: PULADO", "defina MP_WEBHOOK_SECRET no servidor e aqui");
  } else {
    const ts = String(Date.now());
    const requestId = randomBytes(8).toString("hex");
    const v1 = createHmac("sha256", secret).update(`id:${orderId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex");
    const ok = await webhook(orderId, { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId });
    const body = (await ok.json()) as { ok?: boolean; ignored?: boolean };
    if (ok.status !== 200 || !body.ok || !body.ignored) throw new Error(`webhook válido: ${ok.status} ${JSON.stringify(body)}`);
    // Mesmo com assinatura válida, o corpo não credita nada: a order desconhecida é ignorada.
    const bal3 = (await api<{ usdc: number }>("/api/me/balance", { token })).usdc;
    if (Math.abs(bal3 - (bal2b - fe.priceUsdc)) > 1e-9) throw new Error(`saldo mudou depois do webhook: ${bal3}`);
    // Assinatura válida para outro id é recusada
    const swapped = await webhook(`${orderId}X`, { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId });
    if (swapped.status !== 401) throw new Error(`assinatura reaproveitada para outro id: ${swapped.status}`);
    log("webhook com assinatura válida aceito (order desconhecida ignorada, nada creditado)", "200");
  }

  console.log("\nE2E do Pix OK");
}

await main();
