// Fumaça dos especialistas pagos num servidor de verdade, SEM gastar nada (usa o teste grátis de uma carteira nova):
//   API_URL=https://solvers.wondervelop.com npx tsx src/smoke-prod-legacy.ts
// Confere que cada especialista ativa, entrega a etapa 1 e que a busca no conhecimento responde (a versão do pacote em
// disco precisa ter trechos no banco; foi o que o deploy do Criador de Solvers poderia ter quebrado).
import { generateKeyPairSigner } from "@solana/kit";
import { call, rpc } from "./lib/agent-client.js";
import { connect } from "./e2e-mcp.js";

const API = process.env.API_URL ?? "http://localhost:3017";
const CASOS: { slug: string; need: string; query: string }[] = [
  { slug: "copy-marketing", need: "texto de anúncio no Google Ads", query: "limite de caracteres do anúncio responsivo" },
  { slug: "financas-pessoais", need: "organizar dívidas e orçamento", query: "como priorizar dívidas" },
  { slug: "frontend-react", need: "formulário de login acessível em React", query: "foco e acessibilidade em modal" },
  { slug: "planejador-viagens", need: "planejar viagem para a Europa", query: "documentos para brasileiros na Europa" },
  { slug: "revisao-contratos", need: "revisar contrato de aluguel", query: "multa por rescisão antecipada" },
  { slug: "ui-design", need: "escala de espaçamento e contraste", query: "contraste mínimo WCAG" },
];

let falhas = 0;
const ok = (nome: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${nome}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
};

async function main() {
  const list = (await (await fetch(`${API}/api/agents`)).json()) as { slug: string; id: string; version: string }[] | { items: { slug: string; id: string; version: string }[] };
  const agents = Array.isArray(list) ? list : list.items;
  for (const c of CASOS) {
    const a = agents.find((x) => x.slug === c.slug);
    if (!a) {
      ok(`${c.slug}: está no catálogo`, false);
      continue;
    }
    const signer = await generateKeyPairSigner();
    // Fluxo de PESSOA (OAuth + PKCE com carteira simulada): só ele tem teste grátis; o login de agente (SIWS) não tem.
    const token = await connect(signer, false);
    await rpc(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
    const act = await call(token, "activate_solver", { agent_id: a.id });
    const session = /session_id: (\S+)/.exec(act)?.[1];
    ok(`${c.slug} v${a.version}: ativa (teste grátis)`, !!session, session ?? act.slice(0, 120));
    if (!session) continue;
    const kn = await call(token, "search_knowledge", { session_id: session, query: c.query });
    ok(`${c.slug}: search_knowledge devolve trechos`, kn.length > 120 && !/nada relevante/i.test(kn.slice(0, 200)), kn.slice(0, 60).replace(/\n/g, " "));
  }
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
