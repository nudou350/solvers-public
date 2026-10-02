// Fumaça do Criador de Solvers num servidor de verdade (sem gastar nada: o Criador é gratuito e só no banco).
//   API_URL=https://solvers.wondervelop.com npx tsx src/smoke-criador.ts
// Carteira nova de agente (login SIWS sem navegador), ativa o Criador, lê a 1ª etapa, valida um manifesto pelo
// `validate_package`, pede um template, consulta o conhecimento e confere a memória/calibragem. Sai com código 1 se algo falhar.
import { generateKeyPairSigner } from "@solana/kit";
import { call, connectAgent, rpc } from "./lib/agent-client.js";

const SLUG_ID = "c71ad0a50f750e75c71ad0a50f750e75";
let falhas = 0;
const ok = (nome: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${nome}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
};

async function main() {
  const signer = await generateKeyPairSigner();
  const { accessToken: token } = await connectAgent(signer, { memory: true });
  await rpc(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
  const tools = (await rpc(token, "tools/list")).tools?.map((t) => t.name) ?? [];
  ok("conector expõe get_template e forget_memory", tools.includes("get_template") && tools.includes("forget_memory"), `${tools.length} tools`);

  const found = await call(token, "find_solver", { need: "quero criar e publicar um Solver meu, montar o pacote e enviar para revisão" });
  ok("find_solver acha o Criador de Solvers (gratuito)", found.includes(SLUG_ID), found.split("\n")[1] ?? "");

  const act = await call(token, "activate_solver", { agent_id: SLUG_ID });
  const session = /session_id: (\S+)/.exec(act)?.[1];
  ok("activate_solver abre sessão sem licença nem teste grátis", !!session && !/compr|checkout|teste grátis acab/i.test(act.slice(0, 400)), session ?? act.slice(0, 160));
  if (!session) return;

  const pre = await call(token, "preflight_check", { session_id: session, available_tools: ["solvers:next_step", "web_search"] });
  ok("preflight manda consultar get_memory (calibragem)", /get_memory/.test(pre), "");

  const mem = await call(token, "get_memory", { agent_id: SLUG_ID });
  ok("get_memory devolve as perguntas de calibragem", /needs_onboarding|pergunt/i.test(mem), mem.slice(0, 80).replace(/\n/g, " "));
  await call(token, "save_memory", { agent_id: SLUG_ID, kind: "profile", content: JSON.stringify({ skipped: true }) });
  ok("pular a calibragem grava perfil skipped", !/needs_onboarding/.test(await call(token, "get_memory", { agent_id: SLUG_ID })));

  const step = await call(token, "next_step", { session_id: session });
  ok("next_step entrega a etapa 1", /Etapa 1|Promessa/i.test(step), step.slice(0, 70).replace(/\n/g, " "));

  const bad = await call(token, "run_tool", {
    session_id: session,
    tool: "validate_package",
    input: { manifest: { specVersion: 1, slug: "x", platform: true }, steps: [{ file: "steps/01.md", content: "# Etapa" }] },
  });
  ok("validate_package aponta erros com código e correção", /MANIFEST_|STEP_|"ok":\s*false|ok: false/i.test(bad) && /fix|corrig/i.test(bad), bad.slice(0, 90).replace(/\n/g, " "));

  const tpl = await call(token, "get_template", { session_id: session, name: "manifest-esqueleto" }).catch((e: Error) => `ERRO ${e.message}`);
  ok("get_template entrega um esqueleto de manifesto", /specVersion/.test(tpl), tpl.slice(0, 60).replace(/\n/g, " "));

  const kn = await call(token, "search_knowledge", { session_id: session, query: "como escrever as perguntas de calibragem" });
  ok("search_knowledge responde com fonte", kn.length > 80 && /fonte|source/i.test(kn), kn.slice(0, 70).replace(/\n/g, " "));
}

main()
  .then(() => {
    console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} falha(s)`);
    process.exit(falhas === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("ERRO:", e);
    process.exit(1);
  });
