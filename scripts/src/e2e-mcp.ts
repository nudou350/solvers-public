// E2E do conector (fase 3): faz o papel do Claude/ChatGPT.
// 1. Descobre o authorization server pelo 401 do /mcp.  2. Registro dinâmico de cliente.
// 3. /oauth/authorize + assinatura SIWS e da chave de memória (carteira simulada).
// 4. Troca o código por token (PKCE S256).  5. Usa as ferramentas: lista, busca, ativa (teste grátis),
//    preflight, etapas, conhecimento, run_tool e memória.
import { createHash, randomBytes } from "node:crypto";
import { getBase58Decoder, signBytes, type KeyPairSigner } from "@solana/kit";
import { key, log } from "./env.js";

const API = process.env.API_URL ?? "http://localhost:3017";
const REDIRECT = "http://localhost:6274/oauth/callback";

async function sign(signer: KeyPairSigner, text: string) {
  return getBase58Decoder().decode(await signBytes(signer.keyPair.privateKey, new TextEncoder().encode(text)));
}

export async function connect(signer: KeyPairSigner, withMemory = true): Promise<string> {
  const probe = await fetch(`${API}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const wwwAuth = probe.headers.get("www-authenticate") ?? "";
  if (probe.status !== 401 || !wwwAuth.includes("resource_metadata")) throw new Error(`esperava 401 com WWW-Authenticate, veio ${probe.status}`);
  const prmUrl = /resource_metadata="([^"]+)"/.exec(wwwAuth)![1]!;
  const prm = (await (await fetch(prmUrl)).json()) as { authorization_servers: string[]; resource: string };
  const asMeta = (await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json()) as Record<string, string>;

  const reg = (await (
    await fetch(asMeta.registration_endpoint!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude (teste)", redirect_uris: [REDIRECT] }),
    })
  ).json()) as { client_id: string };

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(8).toString("hex");
  const authUrl = new URL(asMeta.authorization_endpoint!);
  Object.entries({
    response_type: "code",
    client_id: reg.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "solvers",
    resource: prm.resource,
  }).forEach(([k, v]) => authUrl.searchParams.set(k, v));
  // O servidor guarda o pedido e redireciona para a tela de consentimento da vitrine (/conectar?req=...).
  const redirect = await fetch(authUrl, { redirect: "manual" });
  const location = redirect.headers.get("location") ?? "";
  const req = /[?&]req=(ar_[0-9a-f]+)/.exec(location)?.[1];
  if (redirect.status !== 302 || !location.includes("/conectar?") || !req) throw new Error(`autorização deveria redirecionar para /conectar: ${redirect.status} ${location}`);
  const info = (await (await fetch(`${API}/oauth/authorize/info?req=${req}`)).json()) as { clientName?: string; extensionUrl?: string };
  if (!info.clientName || !info.extensionUrl) throw new Error(`dados do pedido incompletos: ${JSON.stringify(info)}`);
  const ext = await fetch(info.extensionUrl);
  if (ext.status !== 200 || !(await ext.text()).includes(`"req":"${req}"`)) throw new Error("página para carteira de extensão indisponível");

  const nonce = (await (await fetch(`${API}/oauth/authorize/nonce?req=${req}&wallet=${signer.address}`)).json()) as { message: string };
  const done = (await (
    await fetch(`${API}/oauth/authorize/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        req,
        wallet: signer.address,
        message: nonce.message,
        signature: await sign(signer, nonce.message),
        memorySignature: withMemory ? await sign(signer, "Solvers memory key v1") : undefined,
      }),
    })
  ).json()) as { redirectTo: string };
  const cb = new URL(done.redirectTo);
  if (cb.searchParams.get("state") !== state) throw new Error("state não confere");

  const tok = (await (
    await fetch(asMeta.token_endpoint!, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: cb.searchParams.get("code")!,
        code_verifier: verifier,
        client_id: reg.client_id,
        redirect_uri: REDIRECT,
        resource: prm.resource,
      }),
    })
  ).json()) as { access_token: string; refresh_token: string };
  if (!tok.access_token) throw new Error(`token falhou: ${JSON.stringify(tok)}`);
  return tok.access_token;
}

let rpcId = 0;
export async function rpc(token: string, method: string, params: unknown = {}) {
  const res = await fetch(`${API}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const body = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] }; error?: unknown };
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result!;
}

export async function call(token: string, name: string, args: Record<string, unknown> = {}) {
  const r = await rpc(token, "tools/call", { name, arguments: args });
  const text = r.content?.map((c) => c.text).join("\n") ?? "";
  if (r.isError) throw new Error(`${name}: ${text}`);
  return text;
}

async function main() {
  const user = await key(process.env.E2E_WALLET ?? "buyer1");
  const token = await connect(user);
  log("OAuth completo (DCR + SIWS + PKCE)", user.address);

  await rpc(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  const tools = await rpc(token, "tools/list");
  log("ferramentas", tools.tools?.map((t) => t.name).join(", "));

  log("list_my_solvers", (await call(token, "list_my_solvers")).split("\n")[0]);
  const found = await call(token, "find_solver", { need: "preciso de um formulário de login acessível em React com testes" });
  const agentId = /agent_id: ([0-9a-f]{32})/.exec(found)?.[1];
  if (!agentId) throw new Error(`find_solver sem resultado:\n${found}`);
  log("find_solver", found.split("\n")[1]);

  const act = await call(token, "activate_solver", { agent_id: agentId });
  const sessionId = /session_id: (ses_[0-9a-f]+)/.exec(act)?.[1];
  if (!sessionId) throw new Error(`activate_solver não abriu sessão:\n${act}`);
  log("activate_solver", act.split("\n")[1]);

  const pre = await call(token, "preflight_check", { session_id: sessionId, available_tools: ["solvers:next_step", "web_search"] });
  log("preflight_check", pre.split("\n")[0]);

  const s1 = await call(token, "next_step", { session_id: sessionId });
  log("next_step (etapa 1)", s1.split("\n")[0]);
  const s2 = await call(token, "next_step", { session_id: sessionId, result_summary: "Requisitos: login com e-mail e senha, React 19, Vitest." });
  log("next_step (etapa 2)", s2.split("\n")[0]);

  const kb = await call(token, "search_knowledge", { session_id: sessionId, query: "como associar mensagens de erro ao campo" });
  log("search_knowledge", `${kb.length} caracteres`);

  const a11y = await call(token, "run_tool", {
    session_id: sessionId,
    tool: "a11y_check",
    input: { files: { "Bad.tsx": '<div onClick={x}><img src="a.png"/><input id="e"/></div>' } },
  });
  log("run_tool a11y_check", `${JSON.parse(a11y).issues.length} problemas encontrados (esperado > 0)`);

  await call(token, "save_memory", { agent_id: agentId, content: "Prefere TypeScript estrito e Vitest." });
  const mem = await call(token, "get_memory", { agent_id: agentId });
  if (!mem.includes("TypeScript estrito")) throw new Error(`memória não voltou: ${mem}`);
  log("memória criptografada ida e volta", "ok");

  const wrongSession = await fetch(`${API}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer invalido" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  if (wrongSession.status !== 401) throw new Error("token inválido deveria dar 401");
  log("token inválido -> 401", "ok");
  console.log("\nE2E do conector OK");
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("e2e-mcp.ts")) await main();
