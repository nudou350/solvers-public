// QA de corrida (PACKAGE_SPEC.md 14): (a) uploads simultâneos não furam o limite de envios em andamento por criador;
// (b) decisões simultâneas do revisor sobre a MESMA submissão: só uma vale. Pré-requisito: o estado do QA depois do e2e-creator.
//   cd scripts && npx tsx --env-file=../apps/server/.env.qa src/qa-race.ts
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { loadSigner } from "@solvers/chain";

process.env.API_URL ??= "http://localhost:3027";
const API = process.env.API_URL;
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) throw new Error("API_URL precisa ser local");
const { login } = await import("./e2e-api.js");
const { qaPackageFiles, zipOfFiles } = await import("./lib/qa-package.js");
const SERVER_DIR = join(import.meta.dirname, "..", "..", "apps", "server");
const PG = process.env.PG_CONTAINER ?? "solvers-pg-criador";
const sql = <T = any>(q: string): T[] => JSON.parse(execFileSync("docker", ["exec", PG, "psql", "-U", "postgres", "-d", process.env.PG_DB ?? "t_qa", "-tA", "-c", `select coalesce(json_agg(t),'[]'::json) from (${q}) t`], { encoding: "utf8" }).trim());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const creator = await loadSigner(join(SERVER_DIR, ".qa-data", "keys", "qa-creator.json"));
const admin = await loadSigner(join(SERVER_DIR, ".qa-data", "keys", "qa-admin.json"));
const [tC, tA] = [await login(creator), await login(admin)];
const open = () => sql<{ n: number }>(`select count(*)::int n from package_submissions where creator_wallet = '${creator.address}' and status in ('submitted','validating','pending_review','changes_requested','awaiting_creator_signature','awaiting_onchain_approval','publishing','publish_failed')`)[0]!.n;
const before = open();
console.log(`envios em andamento antes: ${before} (limite 3)`);

const slugs = ["qa-corrida-a", "qa-corrida-b", "qa-corrida-c", "qa-corrida-d", "qa-corrida-e", "qa-corrida-f"];
const results = await Promise.all(
  slugs.map(async (slug) => {
    const r = await fetch(`${API}/api/creator/submissions`, { method: "POST", headers: { authorization: `Bearer ${tC}`, "content-type": "application/zip" }, body: zipOfFiles(qaPackageFiles({ slug }), slug) as unknown as BodyInit });
    return { slug, status: r.status, body: (await r.json().catch(() => ({}))) as { id?: string; code?: string } };
  }),
);
const accepted = results.filter((r) => r.status === 202);
console.log(`6 uploads simultâneos: ${accepted.length} aceitos (202), ${results.filter((r) => r.status === 429).length} recusados (429), outros: ${results.filter((r) => ![202, 429].includes(r.status)).map((r) => r.status)}`);
const limitOk = before + accepted.length <= 3;
console.log(limitOk ? `LIMITE OK: ${before} + ${accepted.length} <= 3` : `LIMITE FURADO: ${before} + ${accepted.length} > 3`);

// (b) decisões simultâneas sobre a mesma submissão: espera a primeira aceita chegar a pending_review.
const target = accepted[0]?.body.id;
let raceOk = false;
if (target) {
  for (let i = 0; i < 120; i++) {
    const s = sql<{ status: string }>(`select status from package_submissions where id = '${target}'`)[0]?.status;
    if (s === "pending_review") break;
    await sleep(1000);
  }
  const checklist = { promiseDelivered: true, twoDifferentiatorsProven: true, rightsAndSources: true, noHarmfulInstructions: true, priceTrialShowcaseCoherent: true };
  const call = (action: string) => fetch(`${API}/api/admin/submissions/${target}/${action}`, { method: "POST", headers: { authorization: `Bearer ${tA}`, "content-type": "application/json" }, body: JSON.stringify({ notes: `corrida: ${action}`, checklist }) }).then(async (r) => ({ action, status: r.status }));
  const out = await Promise.all([call("approve"), call("approve"), call("approve"), call("request-changes")]);
  const wins = out.filter((o) => o.status === 200);
  const rows = sql<{ action: string }>(`select action from package_reviews where submission_id = '${target}'`);
  console.log(`4 decisões simultâneas (3 aprovar + 1 pedir mudanças): ${JSON.stringify(out)}; linhas na trilha: ${JSON.stringify(rows.map((r) => r.action))}`);
  raceOk = wins.length === 1 && rows.length === 1;
  console.log(raceOk ? "DECISÃO ÚNICA OK" : "DECISÃO DUPLICADA");
}
// Limpa: recusa o que sobrou aberto para não deixar o criador travado.
for (const a of accepted) {
  if (a.body.id === target) continue;
  for (let i = 0; i < 60; i++) {
    const s = sql<{ status: string }>(`select status from package_submissions where id = '${a.body.id}'`)[0]?.status;
    if (s === "pending_review") break;
    await sleep(1000);
  }
  await fetch(`${API}/api/admin/submissions/${a.body.id}/reject`, { method: "POST", headers: { authorization: `Bearer ${tA}`, "content-type": "application/json" }, body: JSON.stringify({ notes: "limpeza do teste de corrida", checklist: {} }) });
}
process.exitCode = limitOk && (raceOk || !target) ? 0 : 1;
