// E2E completo (fases 4-5): o roteiro da demo pela API e pelo conector.
// compra -> avaliação on-chain -> conector reconhece a licença -> preflight sem Figma ->
// garantia (entrega verificada, prévia, aprovação, download) -> contestação -> admin resolve ->
// memórias na vitrine -> painel do criador.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { api, login, signAsWallet } from "./e2e-api.js";
import { call, connect, rpc } from "./e2e-mcp.js";
import { generateKeyPairSigner, type KeyPairSigner } from "@solana/kit";
import { usdcToUnits } from "@solvers/shared";
import { chain, key, log } from "./env.js";

const ROOT = join(import.meta.dirname, "..", "..");
const API = process.env.API_URL ?? "http://localhost:3017";

async function tx(token: string, signer: KeyPairSigner, path: string, body: unknown) {
  const built = await api<{ transaction: string; meta?: Record<string, unknown> }>(path, { method: "POST", token, body: JSON.stringify(body) });
  const signed = await signAsWallet(signer, built.transaction);
  const res = await api<{ signature: string; events: string[] }>("/api/tx/submit", { method: "POST", token, body: JSON.stringify({ transaction: signed }) });
  return { ...res, meta: built.meta };
}

async function main() {
  // Carteira nova a cada execução: o limite de garantias abertas (20 USDC) não acumula entre rodadas.
  const buyer = process.env.E2E_BUYER ? await key(process.env.E2E_BUYER) : await generateKeyPairSigner();
  const token = await loginWithToken(buyer);
  // Licença (19) + tarefa com garantia (19); o servidor paga as taxas, então não precisa de SOL.
  await (await chain()).faucet(buyer.address, usdcToUnits(60));

  const agents = await api<{ id: string; slug: string; name: string; creatorId: string }[]>("/api/agents");
  const fe = agents.find((a) => a.slug === "frontend-react")!;
  const ui = agents.find((a) => a.slug === "ui-design")!;

  // 1. Compra da licença
  const mine = await api<{ agentId: string }[]>("/api/me/licenses", { token });
  if (!mine.some((l) => l.agentId === fe.id)) {
    const r = await tx(token, buyer, "/api/tx/purchase", { agentId: fe.id, type: "permanent" });
    log("licença comprada", r.events.join(","));
  }

  // 2. Avaliação (só com licença; texto off-chain, hash on-chain)
  const rv = await tx(token, buyer, "/api/tx/review", { agentId: fe.id, rating: 5, text: "Componentes com testes de verdade. Recomendo." });
  const reviews = await api<{ authorWallet: string; text: string }[]>(`/api/agents/${fe.slug}/reviews`);
  if (!reviews.some((r) => r.authorWallet === buyer.address && r.text.includes("Recomendo"))) throw new Error("avaliação não publicada");
  log("avaliação on-chain publicada", rv.events.join(","));
  const stranger = await key("creator2");
  const strangerToken = await loginWithToken(stranger);
  const denied = await api("/api/tx/review", { method: "POST", token: strangerToken, body: JSON.stringify({ agentId: fe.id, rating: 1, text: "x" }) }).catch((e) => e as Error);
  if (!(denied instanceof Error) || !denied.message.includes("403")) throw new Error("avaliação sem licença deveria ser recusada");
  log("avaliação sem licença recusada", "403");

  // 3. Conector reconhece a licença; UI Design exige Figma
  const mcp = await connect(buyer);
  await rpc(mcp, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  const list = await call(mcp, "list_my_solvers");
  if (!list.includes(fe.id)) throw new Error(`list_my_solvers não mostrou a licença:\n${list}`);
  const act = await call(mcp, "activate_solver", { agent_id: fe.id });
  if (!act.includes("licença permanente") && !act.includes("reaproveitada")) throw new Error(`esperava acesso por licença:\n${act}`);
  const sessionId = /session_id: (ses_[0-9a-f]+)/.exec(act)![1]!;
  log("conector reconhece a licença na hora", sessionId);

  const actUi = await call(mcp, "activate_solver", { agent_id: ui.id });
  const uiSession = /session_id: (ses_[0-9a-f]+)/.exec(actUi)![1]!;
  const pre = await call(mcp, "preflight_check", { session_id: uiSession, available_tools: ["web_search", "solvers:next_step"] });
  if (!pre.includes("Figma: NÃO encontrado")) throw new Error(`preflight deveria acusar Figma:\n${pre}`);
  const preOk = await call(mcp, "preflight_check", { session_id: uiSession, available_tools: ["figma:get_file", "web_search"] });
  if (!preOk.startsWith("Tudo pronto")) throw new Error(`preflight com Figma deveria passar:\n${preOk}`);
  log("preflight detecta falta do Figma e libera quando conectado", "ok");

  // Sessão de outra carteira é recusada
  const other = await connect(stranger);
  const leak = await call(other, "next_step", { session_id: sessionId }).catch((e) => e as Error);
  if (!(leak instanceof Error) || !leak.message.includes("outra carteira")) throw new Error("sessão de outra carteira não foi recusada");
  log("sessão de outra carteira recusada", "ok");

  // 4. Garantia: cria, entrega pelo conector, prévia, aprova, baixa
  const dir = join(ROOT, "agents", "frontend-react", "verifier", "example");
  const files = {
    "LoginForm.tsx": readFileSync(join(dir, "LoginForm.tsx"), "utf8"),
    "LoginForm.test.tsx": readFileSync(join(dir, "LoginForm.test.tsx"), "utf8"),
  };
  // As etapas vêm do modelo do criador (Plano 30% + Componente e testes 70%); o comprador só descreve a tarefa.
  // A bateria de aceite fixa vale para a etapa 2 (componente e testes).
  const detailFe = await api<{ guarantee: { priceUsdc: number; milestones: { title: string; criteria: string[] }[] } | null }>(`/api/agents/${fe.id}`);
  if (!detailFe.guarantee || detailFe.guarantee.milestones.length !== 2) throw new Error(`modelo de garantia ausente: ${JSON.stringify(detailFe.guarantee)}`);
  const esc = await tx(token, buyer, "/api/tx/escrow", {
    agentId: fe.id,
    title: "Formulário de login",
    description: "Formulário de login com e-mail e senha, validação no envio e mensagens de erro acessíveis.",
    acceptanceTests: [null, { "LoginForm.test.tsx": files["LoginForm.test.tsx"] }],
  });
  const escrowId = esc.meta!.escrowId as string;
  log("garantia criada com bateria de aceite", `${escrowId} (${esc.events.join(",")})`);
  const reserved = await call(mcp, "submit_deliverable", {
    session_id: sessionId,
    escrow_id: escrowId,
    milestone: 1,
    artifact: { files: { ...files, "acceptance.LoginForm.test.tsx": "it('ok',()=>{})" } },
  }).catch((e) => e as Error);
  if (!(reserved instanceof Error) || !reserved.message.includes("reservado")) throw new Error("entrega não pode sobrescrever a bateria de aceite");
  log("entrega não consegue trocar a bateria de aceite", "ok");
  const bad = await call(mcp, "submit_deliverable", { session_id: sessionId, escrow_id: escrowId, milestone: 1, artifact: { files: { "NOTAS.md": "sem componente" } } });
  if (!bad.includes("falhou")) throw new Error(`entrega sem o componente deveria falhar:\n${bad}`);
  const good = await call(mcp, "submit_deliverable", { session_id: sessionId, escrow_id: escrowId, milestone: 1, artifact: { files } });
  if (!good.includes("aprovada")) throw new Error(`entrega deveria passar:\n${good}`);
  const preview = /Prévia: (\S+)/.exec(good)![1]!;
  const pv = await fetch(preview);
  if (pv.status !== 200 || !(await pv.text()).includes("PRÉVIA")) throw new Error("prévia indisponível");
  const pvBad = await fetch(preview.replace(/t=[^&]+/, "t=errado"));
  if (pvBad.status !== 404) throw new Error("prévia com token errado deveria dar 404");
  log("entrega verificada, etapa marcada on-chain, prévia com marca d'água", preview.split("?")[0]);

  const detail = await api<{ escrow: { title: string; milestones: { status: string }[]; autoReleaseAt: string }; description: string }>(`/api/me/escrows/${escrowId}`, { token });
  if (detail.escrow.milestones[1]!.status !== "passed" || !detail.escrow.autoReleaseAt) throw new Error(`etapa deveria estar passed: ${JSON.stringify(detail)}`);
  if (detail.escrow.title !== "Formulário de login" || !detail.description) throw new Error("título/descrição da tarefa não gravados");
  const early = await api(`/api/me/escrows/${escrowId}/milestones/1/download`, { token }).catch((e) => e as Error);
  if (!(early instanceof Error)) throw new Error("download antes da aprovação deveria ser bloqueado");

  await tx(token, buyer, `/api/tx/escrow/${escrowId}/release`, { index: 1 });
  const dl = await api<{ files: Record<string, string> }>(`/api/me/escrows/${escrowId}/milestones/1/download`, { token });
  if (!dl.files["LoginForm.tsx"]) throw new Error("download sem arquivo");
  log("comprador aprovou; pagamento liberado e arquivo final disponível", Object.keys(dl.files).join(", "));

  // Etapa 1 (plano) é de revisão manual: sem testes, vai direto para o comprador revisar na prévia.
  const plan = await call(mcp, "submit_deliverable", {
    session_id: sessionId,
    escrow_id: escrowId,
    milestone: 0,
    artifact: { files: { "PLANO.md": "# Plano\n- Props: onSubmit, isLoading\n- Casos de teste: envio vazio, e-mail inválido, sucesso" } },
  });
  if (!plan.includes("revisão do usuário")) throw new Error(`plano deveria ir para revisão manual:\n${plan}`);
  const planDetail = await api<{ escrow: { milestones: { status: string }[] }; milestones: { verify: string }[] }>(`/api/me/escrows/${escrowId}`, { token });
  if (planDetail.escrow.milestones[0]!.status !== "passed" || planDetail.milestones[0]!.verify !== "manual") {
    throw new Error(`plano deveria estar passed/manual: ${JSON.stringify(planDetail)}`);
  }
  log("etapa de plano: revisão manual, liberada para o comprador", "ok");

  // 5. Contestação exige o critério; admin resolve com reembolso
  const noCrit = await api(`/api/tx/escrow/${escrowId}/dispute`, {
    method: "POST",
    token,
    body: JSON.stringify({ index: 0, criterion: "algo inventado", reason: "não entregou" }),
  }).catch((e) => e as Error);
  if (!(noCrit instanceof Error) || !noCrit.message.includes("invalid_criterion")) throw new Error("contestação sem critério válido deveria falhar");
  await tx(token, buyer, `/api/tx/escrow/${escrowId}/dispute`, { index: 0, criterion: "Props e estados definidos", reason: "O plano não foi entregue." });
  const admin = await key("admin");
  const adminToken = await loginWithToken(admin);
  const disputes = await api<{ escrowId: string; criterion: string }[]>("/api/admin/disputes", { token: adminToken });
  if (!disputes.some((d) => d.escrowId === escrowId && d.criterion === "Props e estados definidos")) throw new Error("disputa não listada para o admin");
  await api(`/api/admin/escrow/${escrowId}/resolve`, { method: "POST", token: adminToken, body: JSON.stringify({ index: 0, refund: true }) });
  const after = await api<{ escrow: { status: string; milestones: { status: string }[] } }>(`/api/me/escrows/${escrowId}`, { token });
  if (after.escrow.milestones[0]!.status !== "refunded") throw new Error(`etapa 1 deveria estar refunded: ${JSON.stringify(after.escrow)}`);
  log("contestação com critério + resolução do admin (reembolso)", after.escrow.status);

  // 6. Memórias na vitrine: pede a assinatura, lista e apaga
  await call(mcp, "save_memory", { agent_id: fe.id, content: "Usa Next.js 15 e prefere CSS Modules." });
  const locked = await api("/api/me/memories", { token }).catch((e) => e as Error);
  if (!(locked instanceof Error) || !locked.message.includes("memory_key_required")) throw new Error("memórias deveriam pedir a chave");
  const { signBytes, getBase58Decoder } = await import("@solana/kit");
  const sig = getBase58Decoder().decode(await signBytes(buyer.keyPair.privateKey, new TextEncoder().encode("Solvers memory key v1")));
  await api("/api/me/memory-key", { method: "POST", token, body: JSON.stringify({ signature: sig }) });
  const mems = await api<{ id: string; summary: string }[]>("/api/me/memories", { token });
  if (!mems.some((m) => m.summary.includes("CSS Modules"))) throw new Error("memória não apareceu na vitrine");
  await api(`/api/me/memories/${mems[0]!.id}`, { method: "DELETE", token });
  log("memórias: desbloqueio pela carteira, leitura e exclusão", `${mems.length} memória(s)`);

  // 7. Conector e reputação
  const conn = await api<{ authorizedClients: unknown[] }>("/api/connector", { token });
  const rep = await api<{ guaranteeLevel: string; purchases: number }>("/api/me/reputation", { token });
  log("status do conector e reputação", `${conn.authorizedClients.length} cliente(s), nível ${rep.guaranteeLevel}`);

  // 8. Endpoints das telas: limite de garantia, uso, perfil, criadores e painel
  const g = await api<{ limitUsdc: number; openUsdc: number; availableUsdc: number }>("/api/me/guarantee", { token });
  if (g.availableUsdc !== Math.max(0, g.limitUsdc - g.openUsdc)) throw new Error(`limite de garantia inconsistente: ${JSON.stringify(g)}`);
  const usage = await api<{ agentId: string; weekly: number[]; usesThisMonth: number }[]>("/api/me/usage", { token });
  if (!usage.some((u) => u.weekly.length === 8)) throw new Error(`uso sem série semanal: ${JSON.stringify(usage)}`);
  await api("/api/me/profile", { method: "PATCH", token, body: JSON.stringify({ displayName: "Comprador E2E", email: "E2E@Exemplo.com" }) });
  const prof = await api<{ displayName: string; email: string; memberSince: string }>("/api/me/profile", { token });
  if (prof.displayName !== "Comprador E2E" || prof.email !== "e2e@exemplo.com" || !prof.memberSince) throw new Error(`perfil: ${JSON.stringify(prof)}`);
  const creators = await api<{ id: string }[]>("/api/creators");
  if (!creators.some((c) => c.id === fe.creatorId)) throw new Error("criador do especialista fora da lista");
  log("limite de garantia, uso semanal, perfil e criadores", `${g.availableUsdc}/${g.limitUsdc} USDC livres`);
  console.log(`\nE2E completo OK (${API})`);
}

async function loginWithToken(signer: KeyPairSigner) {
  const { getBase58Decoder, signBytes } = await import("@solana/kit");
  const { message } = await api<{ message: string }>(`/api/auth/nonce?wallet=${signer.address}`);
  const signature = getBase58Decoder().decode(await signBytes(signer.keyPair.privateKey, new TextEncoder().encode(message)));
  const { token } = await api<{ token: string }>("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ wallet: signer.address, message, signature, returnToken: true }),
  });
  return token;
}

await main();
void login;
