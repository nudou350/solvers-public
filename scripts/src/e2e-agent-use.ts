// E2E do agente que JÁ TEM licença (fase 1 do docs/x402-agentes.md): entra no conector só com o keypair (duas chamadas)
// e usa o Solver: lista, ativa (access = licença), preflight, next_step, search_knowledge, run_tool e memória.
// A compra por x402 é do e2e-agent.ts (fase 2). Uso:
//   E2E_WALLET=<nome do keypair em KEYS_DIR, ou caminho> [E2E_AGENT_ID=<agent_id>] pnpm tsx src/e2e-agent-use.ts
import { call, connectAgent, rpc } from "./lib/agent-client.js";
import { key, log } from "./env.js";

const API = process.env.API_URL ?? "http://localhost:3017";

async function main() {
  if (!process.env.E2E_WALLET) throw new Error("defina E2E_WALLET: a carteira (keypair) que já tem a licença de um Solver");
  const agent = await key(process.env.E2E_WALLET);
  const { accessToken: token } = await connectAgent(agent, { memory: true });
  log("login do agente em duas chamadas", agent.address);

  const init = await rpc(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e-agent", version: "1" } });
  log("initialize", (init as { instructions?: string }).instructions?.split("\n")[0]);
  const tools = await rpc(token, "tools/list");
  log("ferramentas", tools.tools?.map((t) => t.name).join(", "));

  const mine = await call(token, "list_my_solvers");
  const agentId = process.env.E2E_AGENT_ID ?? /agent_id: ([0-9a-f]{32})/.exec(mine)?.[1];
  if (!agentId || !mine.includes(agentId)) throw new Error(`list_my_solvers não mostra o Solver (${agentId ?? "nenhum"}):\n${mine}`);
  log("list_my_solvers", mine.split("\n")[1]);

  const act = await call(token, "activate_solver", { agent_id: agentId });
  const sessionId = /session_id: (ses_[0-9a-f]+)/.exec(act)?.[1];
  if (!sessionId) throw new Error(`activate_solver não abriu sessão:\n${act}`);
  if (!act.includes("licença vitalícia")) throw new Error(`esperava access = license:\n${act}`);
  if (/\/checkout|mostre ao usuário/i.test(act)) throw new Error(`texto de pessoa vazou para o agente:\n${act}`);
  log("activate_solver", "acesso por licença vitalícia");

  const pre = await call(token, "preflight_check", { session_id: sessionId, available_tools: ["solvers:next_step"] });
  log("preflight_check", pre.split("\n")[0]);
  const step = await call(token, "next_step", { session_id: sessionId, completed_step: 0 });
  if (!step.includes("agente autônomo")) throw new Error(`next_step sem o cabeçalho de agente:\n${step}`);
  log("next_step (etapa 1)", step.split("\n").find((l) => l.trim() && !l.includes("agente autônomo")));

  const kb = await call(token, "search_knowledge", { session_id: sessionId, query: "boas práticas" });
  log("search_knowledge", `${kb.length} caracteres`);

  // Ferramenta de servidor: a11y_check existe no Solver de front-end; nos demais, confere só que a lista de ferramentas veio.
  if (act.includes("a11y_check")) {
    const out = await call(token, "run_tool", {
      session_id: sessionId,
      tool: "a11y_check",
      input: { files: { "Bad.tsx": '<div onClick={x}><img src="a.png"/><input id="e"/></div>' } },
    });
    log("run_tool a11y_check", `${JSON.parse(out).issues.length} problemas encontrados`);
  } else {
    log("run_tool", "este Solver não tem a11y_check; pulado");
  }

  await call(token, "save_memory", { agent_id: agentId, content: "Agente de teste: prefere respostas curtas." });
  const mem = await call(token, "get_memory", { agent_id: agentId });
  if (!mem.includes("respostas curtas")) throw new Error(`memória não voltou: ${mem}`);
  log("memória ida e volta", "ok");

  const bad = await fetch(`${API}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer invalido" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  if (bad.status !== 401) throw new Error("token inválido deveria dar 401");
  console.log("\nE2E do agente (uso) OK");
}

await main();
