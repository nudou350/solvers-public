// Cliente de referência do agente: entra no conector MCP só com um keypair Solana, em DUAS chamadas
// (GET /oauth/agent/nonce, POST /oauth/agent/token). Sem registro de cliente, PKCE nem navegador.
// Mesmo contrato descrito em docs/agentes-login.md. `rpc` e `call` são os do e2e-mcp (JSON-RPC do /mcp).
import { getBase58Decoder, signBytes, type KeyPairSigner } from "@solana/kit";

export { call, rpc } from "../e2e-mcp.js";

const API = process.env.API_URL ?? "http://localhost:3017";
/** Mensagem da chave de memória (mesma de auth/siws.ts): assinar dá ao servidor a chave que cifra a memória do agente. */
const MEMORY_KEY_MESSAGE = "Solvers memory key v1";

export type AgentTokens = { accessToken: string; refreshToken: string; expiresIn: number };

async function sign(signer: KeyPairSigner, text: string) {
  return getBase58Decoder().decode(await signBytes(signer.keyPair.privateKey, new TextEncoder().encode(text)));
}

function toTokens(t: { access_token?: string; refresh_token?: string; expires_in?: number }, what: string): AgentTokens {
  if (!t.access_token || !t.refresh_token) throw new Error(`${what} falhou: ${JSON.stringify(t)}`);
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in ?? 0 };
}

/**
 * Login do agente. Com `memory: true` assina também a chave de memória (sem ela, get_memory/save_memory respondem
 * "Memória indisponível"). Isto NÃO autoriza pagamentos: a mensagem assinada diz isso.
 */
export async function connectAgent(signer: KeyPairSigner, opts: { memory?: boolean } = {}): Promise<AgentTokens> {
  const nonceRes = await fetch(`${API}/oauth/agent/nonce?wallet=${signer.address}`);
  if (!nonceRes.ok) throw new Error(`nonce falhou (${nonceRes.status}): ${await nonceRes.text()}`);
  const { message } = (await nonceRes.json()) as { message: string };
  const res = await fetch(`${API}/oauth/agent/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet: signer.address,
      message,
      signature: await sign(signer, message),
      memorySignature: opts.memory ? await sign(signer, MEMORY_KEY_MESSAGE) : undefined,
    }),
  });
  return toTokens((await res.json()) as Record<string, never>, "login do agente");
}

/** Renova o token (o refresh token é de uso único: guarde o novo). `client_id` é sempre "agent". */
export async function refreshAgent(refreshToken: string): Promise<AgentTokens> {
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: "agent" }),
  });
  return toTokens((await res.json()) as Record<string, never>, "refresh do agente");
}
