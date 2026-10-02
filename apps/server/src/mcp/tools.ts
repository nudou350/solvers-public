import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, eq, gt, ne } from "drizzle-orm";
import { unitsToUsdc } from "@solvers/shared";
import { isRowSoldOut, soldOutText, supplyLabel, supplyOfRow } from "../store/supply-rules.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { HttpError } from "../lib/http.js";
import { findAgentRow } from "../store/catalog.js";
import { searchAgentRows, searchKnowledge } from "../knowledge/search.js";
import {
  consumeTrialSearch,
  consumeTrialTool,
  ownedAgents,
  paidAccess,
  paidAccessById,
  refundTrialTool,
  resolveAccess,
  sessionGrantValid,
} from "../runtime/access.js";
import { paidAccessLine } from "../runtime/access-rules.js";
import {
  advance,
  saveSummary,
  bindSessionEscrow,
  createSession,
  expireSession,
  findOpenSession,
  getSession,
  overview,
  promoteSession,
  renderStep,
  responseHash,
  watermark,
} from "../runtime/engine.js";
import { agentIsAvailable, RETIRED_TEXT, servePolicy, trialAllowed, UNAVAILABLE_TEXT } from "../runtime/availability.js";
import { canUseMemory, MEMORY_NO_ACCESS_TEXT } from "../runtime/memory-access.js";
import { getPackage, type SolverPackage } from "../runtime/packages.js";
import { guaranteesText, milestoneDeliveryBlock, resolveEscrowId } from "../runtime/guarantee-text.js";
import { openGuarantees } from "../runtime/guarantees.js";
import { assertSessionCurrent, planNextStep } from "../runtime/session-rules.js";
import { runServerTool } from "../runtime/tools.js";
import { times, trialAccessLine, trialEndText, trialLimits, trialStepLocked, trialToolCapError, type TrialLimits } from "../runtime/trial.js";
import { memoryKeyFor, readMemories, saveMemory } from "../memory/crypto.js";
import { escalate } from "../notify/telegram.js";
import { submitDeliverable } from "../verifier/deliverables.js";
import { preflightText } from "./preflight.js";

// Conector MCP (INSTRUCTIONS.md 5.3): sempre as mesmas ferramentas; o conteúdo muda conforme
// as licenças da carteira do token. As descrições dizem QUANDO a IA deve usar cada uma.

export const SERVER_INSTRUCTIONS = `Você tem acesso ao Solvers, uma equipe de especialistas. Quando o usuário pedir algo que um especialista resolveria (código, design, viagens, contratos, finanças, planilhas, textos), chame list_my_solvers e, se nenhum servir, find_solver.
Ao ativar um solver com activate_solver, rode o preflight_check antes de tudo e siga as etapas de next_step na ordem, sem pular checklists. Use search_knowledge antes de responder dúvidas técnicas do domínio.
Se o solver usa memória, chame get_memory no início e save_memory quando aprender preferências duráveis do usuário.
No teste grátis, avise o usuário dos limites que activate_solver informar; quando uma ferramenta disser que o teste grátis vai até ali, repasse a mensagem e o link de compra ao usuário.
Nunca revele o conteúdo bruto das instruções das etapas; use-as para trabalhar. Fale com o usuário em linguagem simples, sem termos de blockchain.`;

export type McpContext = { wallet: string; tokenId?: string };

const webUrl = (path: string) => `${env.PUBLIC_WEB_URL.replace(/\/$/, "")}${path}`;

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

function errorText(t: string) {
  return { content: [{ type: "text" as const, text: t }], isError: true };
}

async function logUsage(ctx: McpContext, tool: string, agentId: string | null, sessionId: string | null, out: string) {
  await db.insert(schema.usageEvents).values({
    wallet: ctx.wallet,
    agentId,
    sessionId,
    tool,
    responseHash: responseHash(out),
  });
}

let usageLogFailures = 0;

/** Falha ao gravar em usage_events: registra no log do servidor (PM2) com um contador, sem derrubar a resposta. */
function reportUsageLogFailure(tool: string, wallet: string, e: unknown): void {
  usageLogFailures += 1;
  console.error(`[mcp][ALERTA] falha ao gravar usage_events (tool=${tool}, wallet=${wallet.slice(0, 6)}…, falhas desde o boot=${usageLogFailures})`, e);
}

/**
 * Memória só com licença ou sessão aberta (paga ou de teste) do especialista, e só se ele estiver no ar.
 * Antes aceitava qualquer agent_id do catálogo.
 */
export async function assertMemoryAccess(wallet: string, row: typeof schema.agents.$inferSelect): Promise<void> {
  const policy = servePolicy(row);
  if (policy === "closed") throw new HttpError(403, UNAVAILABLE_TEXT, "agent_unavailable");
  // Solver aposentado: sessão de teste não conta; só licença ou sessão paga.
  const [open] = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.wallet, wallet),
        eq(schema.sessions.agentId, row.id),
        gt(schema.sessions.expiresAt, new Date()),
        policy === "paid_only" ? ne(schema.sessions.access, "trial") : undefined,
      ),
    )
    .limit(1);
  const licensed = open ? false : (await ownedAgents(wallet)).has(row.id);
  if (!canUseMemory({ licensed, openSession: !!open })) throw new HttpError(403, MEMORY_NO_ACCESS_TEXT, "memory_no_access");
}

/** Envolve o handler: log em usage_events, erros amigáveis e nunca vaza stack. */
function tool<A>(ctx: McpContext, name: string, fn: (args: A) => Promise<{ text: string; agentId?: string | null; sessionId?: string | null }>) {
  return async (args: A) => {
    try {
      const r = await fn(args);
      // A resposta ao usuário não depende do log, mas a falha NUNCA é silenciosa: usage_events alimenta auditoria e lotes on-chain.
      await logUsage(ctx, name, r.agentId ?? null, r.sessionId ?? null, r.text).catch((e) => reportUsageLogFailure(name, ctx.wallet, e));
      return text(r.text);
    } catch (e) {
      if (e instanceof HttpError) return errorText(e.message);
      console.error(`[mcp] ${name}`, e);
      return errorText("Não consegui concluir agora. Tente de novo em instantes.");
    }
  };
}

function requirePackage(agentId: string): SolverPackage {
  const pkg = getPackage(agentId);
  if (!pkg) throw new HttpError(404, "Este especialista não está disponível no momento.");
  return pkg;
}

/** Pacote da sessão: se o especialista foi atualizado depois de a sessão abrir, pede nova ativação (nada de método novo com base antiga). */
function requireSessionPackage(session: { agentId: string; version: string }): SolverPackage {
  const pkg = requirePackage(session.agentId);
  assertSessionCurrent(session.version, pkg.manifest.version, pkg.manifest.name);
  return pkg;
}

/** Tarefas com garantia abertas do usuário com este especialista, já em texto para a IA ("" se não houver). */
async function guaranteeBlock(wallet: string, agentId: string): Promise<string> {
  return guaranteesText(await openGuarantees(wallet, agentId));
}

function purchaseLink(slug: string) {
  return webUrl(`/checkout?agent=${encodeURIComponent(slug)}&type=permanent`);
}

type AgentRow = typeof schema.agents.$inferSelect;

/** Sem link de compra quando o teto de licenças foi atingido: o programa recusaria a compra. */
const SOLD_OUT_LINK = "indisponível (licenças esgotadas, sem link de compra)";

export function purchaseLinkFor(row: AgentRow): string {
  return isRowSoldOut(row) ? SOLD_OUT_LINK : purchaseLink(row.slug);
}

async function purchaseLinkBySlug(slug: string): Promise<string> {
  const row = await findAgentRow(slug).catch(() => null);
  return row ? purchaseLinkFor(row) : purchaseLink(slug);
}

/** Texto de "esgotado" para a IA repassar ao usuário (menciona a revenda só com ela ligada). */
export function soldOutAdvice(row: AgentRow): string {
  return `${soldOutText(row.name, env.RESALE_ENABLED)} Não ofereça link de compra.`;
}

export function describeAgent(row: AgentRow) {
  const rating = row.ratingCount ? (Number(row.ratingSum) / row.ratingCount).toFixed(1) : "sem avaliações";
  const supply = supplyLabel(supplyOfRow(row));
  return `nota ${rating} (${row.ratingCount} avaliações), desempenho verificado ${(row.evalScoreBps / 100).toFixed(0)}%, licença vitalícia por ${unitsToUsdc(row.price)} USDC${supply ? ` (${supply})` : ""}`;
}

/** Uma linha sobre o teste grátis do especialista (find_solver). */
function describeTrial(trial: TrialLimits | null): string {
  if (!trial) return "Sem teste grátis: só com a licença.";
  return `Teste grátis (${trial.uses === 1 ? "1 uso" : `${trial.uses} usos`}): ${trial.summary}`;
}

type Session = Awaited<ReturnType<typeof getSession>>;

/**
 * Um limite do teste ia bloquear: se a carteira agora tem acesso pago (comprou a licença ou abriu
 * uma garantia no meio da conversa), promove a sessão e segue sem limites. Só roda no bloqueio.
 */
async function upgraded(session: Session): Promise<Session | null> {
  const paid = await paidAccessById(session.wallet, session.agentId);
  return paid ? promoteSession(session, paid) : null;
}

const UPGRADED_NOTE = "Acesso pago detectado: os limites do teste grátis não valem mais nesta sessão.";

/** Limites do teste de uma sessão de teste (null: sessão paga). Sem teste no manifest atual, nada fica liberado. */
async function sessionTrial(session: Session, pkg: SolverPackage): Promise<TrialLimits | null> {
  if (session.access !== "trial") return null;
  const trial = trialLimits(pkg.manifest);
  if (trial) return trial;
  if (await upgraded(session)) return null;
  throw new HttpError(403, `O teste grátis de ${pkg.manifest.name} não está mais disponível. Comprar: ${await purchaseLinkBySlug(pkg.manifest.slug)}`);
}

const endText = async (pkg: SolverPackage, trial: TrialLimits) => trialEndText(pkg.manifest.name, trial, await purchaseLinkBySlug(pkg.manifest.slug));

export function buildMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({ name: "solvers", version: "1.0.0" }, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    "list_my_solvers",
    {
      title: "Meus especialistas",
      description:
        "Lista os especialistas (solvers) que o usuário já tem (licença vitalícia). Use no começo, sempre que o pedido do usuário puder ser resolvido por um especialista.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    tool(ctx, "list_my_solvers", async () => {
      const owned = await ownedAgents(ctx.wallet);
      const tasks = await openGuarantees(ctx.wallet);
      const ids = new Set([...owned, ...tasks.map((t) => t.agentId)]);
      if (ids.size === 0) {
        return { text: "O usuário ainda não tem especialistas. Use find_solver com a necessidade dele para sugerir opções (alguns têm teste grátis)." };
      }
      const lines: string[] = [];
      for (const agentId of ids) {
        const row = await findAgentRow(agentId).catch(() => null);
        if (!row) continue;
        const open = tasks.filter((t) => t.agentId === agentId).length;
        const kind = [owned.has(agentId) ? "licença vitalícia" : null, open ? `${open} tarefa(s) com garantia aberta` : null].filter(Boolean).join("; ");
        lines.push(`- ${row.name} (agent_id: ${row.id}): ${row.tagline} [${kind}]`);
      }
      return { text: `Especialistas do usuário:\n${lines.join("\n")}\n\nPara usar, chame activate_solver com o agent_id. Para ver as tarefas com garantia abertas, chame list_open_guarantees.` };
    }),
  );

  server.registerTool(
    "find_solver",
    {
      title: "Encontrar especialista",
      description:
        "Busca na loja os 3 especialistas mais adequados para a necessidade do usuário, descrita em linguagem natural. Use quando o usuário não tem um especialista que sirva.",
      inputSchema: { need: z.string().min(3).max(500).describe("O que o usuário precisa, com as palavras dele") },
      annotations: { readOnlyHint: true },
    },
    tool(ctx, "find_solver", async ({ need }: { need: string }) => {
      const rows = await searchAgentRows(need, 3);
      if (rows.length === 0) return { text: "Nenhum especialista da loja cobre esse pedido ainda. Resolva com seu conhecimento geral." };
      const owned = await ownedAgents(ctx.wallet);
      const lines = rows.map((r) => {
        const has = owned.has(r.id) ? " — o usuário JÁ TEM este" : "";
        const pkg = getPackage(r.id);
        const trial = has || !pkg ? "" : `\n  ${describeTrial(trialLimits(pkg.manifest))}`;
        return `- ${r.name} (agent_id: ${r.id})${has}\n  ${r.tagline}\n  ${describeAgent(r)}${trial}\n  Comprar: ${purchaseLinkFor(r)}`;
      });
      return {
        text: `Sugestões:\n${lines.join("\n")}\n\nPara usar o teste grátis (quando o especialista tiver), chame activate_solver com o agent_id. Para comprar a licença vitalícia, mostre o link ao usuário (ele aprova o pagamento na carteira); especialista esgotado não tem link.`,
      };
    }),
  );

  server.registerTool(
    "get_purchase_link",
    {
      title: "Link de compra",
      description:
        "Gera o link da loja com o checkout da licença vitalícia do especialista. Mostre o link ao usuário; ele confirma o pagamento na própria carteira.",
      inputSchema: { agent_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    tool(ctx, "get_purchase_link", async ({ agent_id }: { agent_id: string }) => {
      const row = await findAgentRow(agent_id);
      if (!agentIsAvailable(row)) return { text: servePolicy(row) === "paid_only" ? RETIRED_TEXT : UNAVAILABLE_TEXT, agentId: row.id };
      if (isRowSoldOut(row)) return { text: soldOutAdvice(row), agentId: row.id };
      return { text: `Link para ${row.name} (licença vitalícia, ${unitsToUsdc(row.price)} USDC): ${purchaseLink(row.slug)}`, agentId: row.id };
    }),
  );

  server.registerTool(
    "list_open_guarantees",
    {
      title: "Tarefas com garantia abertas",
      description:
        "Lista as tarefas com garantia que o usuário já pagou e ainda estão abertas (escrow_id, briefing, etapas e critérios combinados). Use quando o usuário falar de uma tarefa contratada ou antes de submit_deliverable se você não tiver o escrow_id.",
      inputSchema: { agent_id: z.string().optional().describe("Filtra por especialista (agent_id)") },
      annotations: { readOnlyHint: true },
    },
    tool(ctx, "list_open_guarantees", async ({ agent_id }: { agent_id?: string }) => {
      const tasks = await openGuarantees(ctx.wallet, agent_id);
      if (tasks.length === 0) return { text: "O usuário não tem tarefas com garantia abertas.", agentId: agent_id ?? null };
      // Uma seção por especialista (a regra do escrow_id vale por especialista).
      const byAgent = new Map<string, typeof tasks>();
      for (const t of tasks) byAgent.set(t.agentId, [...(byAgent.get(t.agentId) ?? []), t]);
      const blocks = [...byAgent].map(([id, group]) => `### Especialista agent_id: ${id}\n${guaranteesText(group)}`);
      return { text: `${tasks.length} tarefa(s) com garantia aberta(s):\n\n${blocks.join("\n\n")}`, agentId: agent_id ?? null };
    }),
  );

  server.registerTool(
    "activate_solver",
    {
      title: "Ativar especialista",
      description:
        "Ativa um especialista para a tarefa atual e devolve session_id, visão geral e requisitos. Sem licença, cada ativação nova consome 1 uso do teste grátis (se o especialista tiver) e a resposta diz os limites do teste; se já existe uma sessão aberta deste especialista, ela é reaproveitada sem custo. Reutilize o session_id durante toda a tarefa. Depois, rode preflight_check.",
      inputSchema: { agent_id: z.string().describe("agent_id vindo de list_my_solvers ou find_solver") },
    },
    tool(ctx, "activate_solver", async ({ agent_id }: { agent_id: string }) => {
      const row = await findAgentRow(agent_id);
      const pkg = requirePackage(row.id);
      // Aposentado ("paid_only") ainda atende quem tem direito pago; fechado (suspenso) corta tudo.
      if (servePolicy(row) === "closed") return { text: UNAVAILABLE_TEXT, agentId: row.id };
      let open = await findOpenSession(ctx.wallet, row.id, pkg.manifest.version, pkg.steps.length);
      // Licença revendida ou garantia encerrada: descarta a sessão e segue o fluxo normal.
      if (open && !(await sessionGrantValid(open))) {
        await expireSession(open.id);
        open = null;
      }
      // Sessão de teste de quem comprou depois: vira paga, mantendo a etapa em que parou.
      if (open?.access === "trial") {
        const paid = await paidAccess(ctx.wallet, row);
        if (paid) open = await promoteSession(open, paid);
      }
      // Aposentado: sessão de teste que sobrou não serve (sem direito pago, fecha e cai no fluxo normal, que recusa).
      if (open?.access === "trial" && !trialAllowed(row)) {
        await expireSession(open.id);
        open = null;
      }
      if (open) {
        const step = Math.min(open.stepIndex + 1, pkg.steps.length);
        const trial = await sessionTrial(open, pkg);
        if (trial && trialStepLocked(trial, open.stepIndex, pkg.steps.length)) {
          return { text: `session_id: ${open.id}\n${await endText(pkg, trial)}`, agentId: row.id, sessionId: open.id };
        }
        const accessNote = open.access === "license" || open.access === "guarantee" ? ` ${paidAccessLine(open.access)}` : "";
        const task = await guaranteeBlock(ctx.wallet, row.id);
        return {
          text: `session_id: ${open.id}\nSessão já aberta reaproveitada (sem consumir outro uso).${accessNote} Continue de onde parou: etapa ${step} de ${pkg.steps.length}. Chame next_step para seguir.${task ? `\n\n${task}` : ""}`,
          agentId: row.id,
          sessionId: open.id,
        };
      }
      const access = await resolveAccess(ctx.wallet, row, pkg, { consume: true, allowTrial: trialAllowed(row) });
      if (!access.ok) {
        const price = `${unitsToUsdc(row.price)} USDC`;
        if (access.reason === "retired") return { text: RETIRED_TEXT, agentId: row.id };
        const why =
          access.reason === "no_trial"
            ? `${row.name} não tem teste grátis: para usar, o usuário precisa da licença vitalícia (${price}).`
            : `O usuário já usou os ${access.trial?.uses ?? 0} testes grátis de ${row.name}. Para continuar, ele precisa da licença vitalícia (${price}).`;
        if (isRowSoldOut(row)) return { text: `${why} ${soldOutAdvice(row)}`, agentId: row.id };
        return { text: `${why} Comprar: ${purchaseLink(row.slug)}. Mostre o link e explique que o pagamento é aprovado na carteira dele.`, agentId: row.id };
      }
      const session = await createSession(ctx.wallet, pkg, access);
      const accessLine =
        access.kind !== "trial"
          ? paidAccessLine(access.kind)
          : `${trialAccessLine(access.trial, {
              use: access.used,
              totalSteps: pkg.steps.length,
              toolNames: pkg.manifest.tools.map((t) => t.name),
              usage: access.usage,
            })} Quando o teste acabar, ${isRowSoldOut(row) ? `não há como comprar (${SOLD_OUT_LINK})` : `ofereça o link de compra: ${purchaseLink(row.slug)}`}`;
      const task = await guaranteeBlock(ctx.wallet, row.id);
      const reqs = pkg.manifest.requirements.map((r) => `- [${r.type}] ${r.label}${r.key ? ` (chave: ${r.key})` : ""}${r.optional ? " (opcional)" : ""}`).join("\n") || "- nenhum";
      const memoryHint = pkg.usesMemory ? `\nEste especialista usa memória: chame get_memory com agent_id="${row.id}" antes da etapa 1.` : "";
      const out = [
        `session_id: ${session.id}`,
        accessLine,
        "",
        overview(pkg),
        "",
        ...(task ? [task, ""] : []),
        "## Requisitos",
        reqs,
        "",
        `PRÓXIMO PASSO OBRIGATÓRIO: chame preflight_check com session_id="${session.id}" e a lista de nomes de ferramentas que você tem disponíveis agora.${memoryHint}`,
      ].join("\n");
      return { text: out, agentId: row.id, sessionId: session.id };
    }),
  );

  server.registerTool(
    "preflight_check",
    {
      title: "Checar requisitos",
      description:
        "Confere se a IA tem o que o especialista precisa (ex: conector do Figma). Chame logo depois de activate_solver, informando os nomes de TODAS as ferramentas que você tem disponíveis.",
      inputSchema: {
        session_id: z.string(),
        available_tools: z.array(z.string()).max(500).describe("Nomes das ferramentas disponíveis para você neste chat"),
      },
      annotations: { readOnlyHint: true },
    },
    tool(ctx, "preflight_check", async ({ session_id, available_tools }: { session_id: string; available_tools: string[] }) => {
      const session = await getSession(session_id, ctx.wallet);
      const pkg = requireSessionPackage(session);
      const out = preflightText(pkg.manifest.requirements, available_tools, session.id);
      return { text: out, agentId: session.agentId, sessionId: session.id };
    }),
  );

  server.registerTool(
    "next_step",
    {
      title: "Próxima etapa",
      description:
        "Entrega a próxima etapa do método do especialista (objetivo, instruções e checklist). Chame depois do preflight e sempre que o checklist da etapa atual estiver completo, passando o resumo do resultado e completed_step (o número da última etapa que você concluiu; 0 logo após o preflight). Se a resposta se perder e você repetir a chamada com o mesmo completed_step, a etapa é reenviada sem pular nenhuma.",
      inputSchema: {
        session_id: z.string(),
        completed_step: z.number().int().min(0).max(100).optional().describe("Número da última etapa concluída (0 se ainda não recebeu nenhuma). Evita pular etapa se a chamada for repetida."),
        result_summary: z.string().max(4000).optional().describe("Resumo do resultado da etapa anterior, no formato que ela pediu"),
      },
    },
    tool(
      ctx,
      "next_step",
      async ({ session_id, result_summary, completed_step }: { session_id: string; result_summary?: string; completed_step?: number }) => {
        let session = await getSession(session_id, ctx.wallet);
        const pkg = requireSessionPackage(session);
        const plan = planNextStep(session.stepIndex, completed_step);
        const index = plan.index;
        // Teste grátis: a etapa fora do teste não é entregue (e a sessão não avança), a não ser que a carteira já tenha acesso pago.
        const trial = await sessionTrial(session, pkg);
        let note = "";
        if (trial && trialStepLocked(trial, index, pkg.steps.length)) {
          const up = await upgraded(session);
          if (!up) return { text: await endText(pkg, trial), agentId: session.agentId, sessionId: session.id };
          session = up;
          note = `${UPGRADED_NOTE}\n\n`;
        }
        let updated: Session;
        if (plan.kind === "replay") {
          // Repetição depois de resposta perdida: reenvia a etapa sem avançar; o resumo vai para o slot certo.
          updated = result_summary && index > 0 ? await saveSummary(session, index - 1, result_summary) : session;
          note += `Reenvio: esta é a etapa ${index + 1} de novo (a sessão não avançou).\n\n`;
        } else {
          updated = await advance(session, result_summary);
        }
        const { text: out } = renderStep(pkg, updated, index);
        return { text: note + out, agentId: session.agentId, sessionId: session.id };
      },
    ),
  );

  server.registerTool(
    "search_knowledge",
    {
      title: "Consultar base do especialista",
      description:
        "Busca na base de conhecimento própria do especialista (padrões, armadilhas, exemplos). Use antes de responder dúvidas técnicas do domínio durante uma sessão.",
      inputSchema: { session_id: z.string(), query: z.string().min(2).max(500) },
      annotations: { readOnlyHint: true },
    },
    tool(ctx, "search_knowledge", async ({ session_id, query }: { session_id: string; query: string }) => {
      const session = await getSession(session_id, ctx.wallet);
      const pkg = requireSessionPackage(session);
      const trial = await sessionTrial(session, pkg);
      if (trial && !(await consumeTrialSearch(ctx.wallet, session.agentId, trial.searches)) && !(await upgraded(session))) {
        const out = `As consultas à base do teste grátis acabaram (${trial.searches} no total).\n\n${await endText(pkg, trial)}`;
        return { text: out, agentId: session.agentId, sessionId: session.id };
      }
      const hits = await searchKnowledge(session.agentId, session.version, query, 5);
      if (hits.length === 0) return { text: "Nada relevante na base para essa pergunta.", agentId: session.agentId, sessionId: session.id };
      const out =
        hits.map((h, i) => `### Trecho ${i + 1} (${h.source})\n${h.content}`).join("\n\n") +
        `\n\n${watermark(ctx.wallet, session.agentId)}`;
      return { text: out, agentId: session.agentId, sessionId: session.id };
    }),
  );

  server.registerTool(
    "run_tool",
    {
      title: "Rodar ferramenta do especialista",
      description:
        "Executa no servidor uma ferramenta do especialista listada na visão geral (ex: run_tests, a11y_check, contrast_check, budget_split). Use quando o checklist pedir uma verificação.",
      inputSchema: {
        session_id: z.string(),
        tool: z.string().describe("Nome da ferramenta"),
        input: z.record(z.unknown()).describe("Entrada da ferramenta, ex: { files: { 'Botao.tsx': '...' } }"),
      },
    },
    tool(ctx, "run_tool", async ({ session_id, tool: name, input }: { session_id: string; tool: string; input: Record<string, unknown> }) => {
      const session = await getSession(session_id, ctx.wallet);
      const pkg = requireSessionPackage(session);
      const trial = await sessionTrial(session, pkg);
      // No teste, só as ferramentas liberadas, contando no total. Nome inexistente cai no erro normal do runServerTool.
      if (trial && pkg.manifest.tools.some((t) => t.name === name)) {
        const limit = trial.tools[name] ?? 0;
        // Teto de tamanho da entrada no teste: confere antes de gastar saldo (a licença não tem teto).
        const capped = limit > 0 ? trialToolCapError(name, trial.toolCaps[name], input, await purchaseLinkBySlug(pkg.manifest.slug)) : null;
        if (capped && !(await upgraded(session))) return { text: capped, agentId: session.agentId, sessionId: session.id };
        if (limit > 0 && (await consumeTrialTool(ctx.wallet, session.agentId, name, limit))) {
          try {
            const result = await runServerTool(pkg, name, input);
            return { text: JSON.stringify(result, null, 2), agentId: session.agentId, sessionId: session.id };
          } catch (e) {
            // Entrada recusada (400): a execução volta para o saldo do teste.
            if (e instanceof HttpError && e.status === 400) await refundTrialTool(ctx.wallet, session.agentId, name).catch(() => undefined);
            throw e;
          }
        }
        // Bloqueada ou esgotada no teste: só segue se a carteira já tiver acesso pago.
        if (!(await upgraded(session))) {
          const why = limit > 0 ? `O teste grátis permitia rodar ${name} ${times(limit)} e esse limite acabou.` : `A ferramenta ${name} não faz parte do teste grátis.`;
          return { text: `${why}\n\n${await endText(pkg, trial)}`, agentId: session.agentId, sessionId: session.id };
        }
      }
      const result = await runServerTool(pkg, name, input);
      return { text: JSON.stringify(result, null, 2), agentId: session.agentId, sessionId: session.id };
    }),
  );

  server.registerTool(
    "get_memory",
    {
      title: "Ler memórias",
      description:
        "Lê o que este especialista já aprendeu sobre o usuário (preferências, contexto). Chame no começo da sessão de especialistas que usam memória.",
      inputSchema: { agent_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    tool(ctx, "get_memory", async ({ agent_id }: { agent_id: string }) => {
      const row = await findAgentRow(agent_id);
      await assertMemoryAccess(ctx.wallet, row);
      const key = await memoryKeyFor(ctx.tokenId, ctx.wallet);
      if (!key) {
        return { text: "Memória indisponível nesta conexão (a chave não foi autorizada). Siga sem memória.", agentId: row.id };
      }
      const mem = await readMemories(ctx.wallet, key, row.id);
      return { text: mem.length ? `Memórias do usuário para ${row.name}:\n${mem[0]!.summary}` : "Ainda não há memórias deste usuário.", agentId: row.id };
    }),
  );

  server.registerTool(
    "save_memory",
    {
      title: "Salvar memória",
      description:
        "Salva ou atualiza o que o especialista deve lembrar deste usuário nas próximas conversas (preferências duráveis). Envie o resumo COMPLETO atualizado; ele substitui o anterior. Nunca salve senhas, documentos ou dados de pagamento.",
      inputSchema: { agent_id: z.string(), content: z.string().min(3).max(4000) },
    },
    tool(ctx, "save_memory", async ({ agent_id, content }: { agent_id: string; content: string }) => {
      const row = await findAgentRow(agent_id);
      await assertMemoryAccess(ctx.wallet, row);
      const key = await memoryKeyFor(ctx.tokenId, ctx.wallet);
      if (!key) return { text: "Não foi possível salvar: memória não autorizada nesta conexão.", agentId: row.id };
      await saveMemory(ctx.wallet, row.id, key, content);
      return { text: "Memória salva (criptografada). O usuário pode ver e apagar na biblioteca da loja.", agentId: row.id };
    }),
  );

  server.registerTool(
    "submit_deliverable",
    {
      title: "Entregar etapa com garantia",
      description:
        "Entrega os arquivos de uma etapa de uma tarefa com garantia. Em etapas com testes, o servidor roda a verificação combinada e, se passar, libera a etapa para aprovação do usuário com um link de prévia. Em etapas de revisão manual (ex: plano), envie o texto (ex: PLANO.md): ele vai direto para o usuário revisar na prévia.",
      inputSchema: {
        session_id: z.string(),
        escrow_id: z.string().optional().describe("Omita se houver uma só tarefa com garantia aberta; com mais de uma é obrigatório (veja list_open_guarantees). Precisa ser de uma tarefa aberta deste especialista."),
        milestone: z.number().int().min(0).max(4),
        artifact: z.object({ files: z.record(z.string()) }).describe("Arquivos da entrega: { files: { 'LoginForm.tsx': '...', 'LoginForm.test.tsx': '...' } }"),
      },
    },
    tool(
      ctx,
      "submit_deliverable",
      async ({ session_id, escrow_id, milestone, artifact }: { session_id: string; escrow_id?: string; milestone: number; artifact: { files: Record<string, string> } }) => {
        const session = await getSession(session_id, ctx.wallet);
        const sessionEscrowId = (session.context as { escrowId?: unknown }).escrowId;
        // Garantias abertas deste especialista: o id informado precisa estar entre elas; com mais de uma, o id é obrigatório.
        const open = await openGuarantees(ctx.wallet, session.agentId);
        const choice = resolveEscrowId({ sessionEscrowId, given: escrow_id, open });
        const escrowId = choice.escrowId;
        const blocked = milestoneDeliveryBlock(open.find((x) => x.id === escrowId)!, milestone);
        if (blocked) throw new HttpError(400, blocked);
        if (choice.rebind) await bindSessionEscrow(session, escrowId);
        const r = await submitDeliverable({ wallet: ctx.wallet, agentId: session.agentId, escrowId, index: milestone, files: artifact.files });
        const out = r.passed
          ? `${r.report.mode === "manual" ? "Entrega recebida para a revisão do usuário." : `Verificação aprovada (${r.report.numPassed}/${r.report.numTests} testes). A etapa foi marcada como aprovada nos testes.`}\nPrévia: ${r.previewUrl}\nO usuário tem até ${r.autoReleaseAt} para aprovar ou contestar na loja; depois disso o pagamento é liberado automaticamente.`
          : `A verificação falhou (${r.report.numFailed} falha(s)). Corrija e envie de novo:\n${r.report.failures.map((f) => `- ${f.test}: ${f.message}`).join("\n")}`;
        return { text: out, agentId: session.agentId, sessionId: session.id };
      },
    ),
  );

  server.registerTool(
    "escalate_to_creator",
    {
      title: "Chamar o criador humano",
      description:
        "Aciona o criador humano do especialista quando o caso foge do método ou o usuário pede ajuda de uma pessoa. Devolve um protocolo para o usuário acompanhar.",
      inputSchema: { session_id: z.string(), summary: z.string().min(10).max(3000).describe("Resumo do problema e do que já foi tentado") },
    },
    tool(ctx, "escalate_to_creator", async ({ session_id, summary }: { session_id: string; summary: string }) => {
      const session = await getSession(session_id, ctx.wallet);
      const { protocol, notified } = await escalate(ctx.wallet, session.agentId, session.id, summary);
      return {
        text: `Chamado aberto: protocolo ${protocol}. ${notified ? "O criador foi avisado agora." : "O criador será avisado."} Informe o protocolo ao usuário.`,
        agentId: session.agentId,
        sessionId: session.id,
      };
    }),
  );

  return server;
}

/** Garante que a sessão MCP só acessa escrows da própria carteira (usado pelo verificador). */
export async function escrowBelongsTo(escrowId: string, wallet: string) {
  const [row] = await db.select().from(schema.escrows).where(and(eq(schema.escrows.id, escrowId), eq(schema.escrows.buyerWallet, wallet)));
  return !!row;
}
