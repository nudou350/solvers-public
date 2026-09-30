// E2E pela API da loja (fase 2): login com carteira (SIWS), faucet, compra montada pelo servidor,
// assinatura da "carteira" e envio; confere que a licença aparece em /api/me/licenses na hora.
import {
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
  signBytes,
  type KeyPairSigner,
} from "@solana/kit";
import { key, log } from "./env.js";

const API = process.env.API_URL ?? "http://localhost:3017";

export async function api<T = unknown>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

export async function login(signer: KeyPairSigner): Promise<string> {
  const { message } = await api<{ message: string }>(`/api/auth/nonce?wallet=${signer.address}`);
  const sig = await signBytes(signer.keyPair.privateKey, new TextEncoder().encode(message));
  const signature = getBase58Decoder().decode(sig);
  const { token } = await api<{ token: string }>("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ wallet: signer.address, message, signature, returnToken: true }),
  });
  return token;
}

/** Faz o papel da carteira: assina a transação montada pelo servidor. */
export async function signAsWallet(signer: KeyPairSigner, txBase64: string): Promise<string> {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(txBase64));
  const signed = await partiallySignTransaction([signer.keyPair], tx);
  return getBase64EncodedWireTransaction(signed);
}

async function main() {
  const buyer = await key("buyer2");
  const token = await login(buyer);
  log("login SIWS", buyer.address);

  const agents = await api<{ id: string; name: string; priceUsdc: number }[]>("/api/agents");
  const agent = agents[0];
  if (!agent) throw new Error("nenhum solver ativo; rode e2e:purchase ou o seed antes");
  log("solver", `${agent.name} (${agent.priceUsdc} USDC)`);

  await api("/api/faucet", { method: "POST", token }).catch((e) => log("faucet", (e as Error).message));
  const bal = await api<{ usdc: number }>("/api/me/balance", { token });
  log("saldo", bal.usdc);

  // Pagamento por uso acabou: compra de créditos é recusada.
  const credits = await api("/api/tx/purchase", { method: "POST", token, body: JSON.stringify({ agentId: agent.id, type: "credits", amount: 10 }) }).catch((e) => e as Error);
  if (!(credits instanceof Error) || !credits.message.includes("400")) throw new Error("compra de créditos deveria ser recusada (400)");
  log("compra de créditos recusada", "400");

  const built = await api<{ transaction: string; meta: { asset: string } }>("/api/tx/purchase", {
    method: "POST",
    token,
    body: JSON.stringify({ agentId: agent.id }),
  });
  const signed = await signAsWallet(buyer, built.transaction);
  const sub = await api<{ signature: string; events: string[] }>("/api/tx/submit", {
    method: "POST",
    token,
    body: JSON.stringify({ transaction: signed }),
  });
  log("compra enviada", sub);

  const licenses = await api<{ id: string; agentId: string }[]>("/api/me/licenses", { token });
  if (!licenses.some((l) => l.id === built.meta.asset)) throw new Error("licença não apareceu em /me/licenses");
  log("licença aparece na hora em /api/me/licenses", built.meta.asset);

  const rep = await api<{ purchases: number; guaranteeLevel: string }>("/api/me/reputation", { token });
  log("reputação", rep);
  const detail = await api<{ agent: { id: string }; priceBrl: number }>(`/api/agents/${agent.id}`);
  log("detalhe com preço em reais", detail.priceBrl);
  console.log("\nE2E da API OK");
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("e2e-api.ts")) {
  await main();
}
