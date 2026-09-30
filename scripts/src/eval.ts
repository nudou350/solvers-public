// Corretor dos evals dos solvers: aplica as checagens de agents/<slug>/evals/cases/*.json às respostas
// salvas em evals/outputs/<id>.md e grava evals/report.json (a nota que o publish leva on-chain).
//   npx tsx src/eval.ts                     # todos os pacotes com casos
//   npx tsx src/eval.ts frontend-react      # só alguns
//
// As respostas são geradas antes, com o solver ativo; evals/outputs/meta.json diz como
// ({ model, method, generatedAt }). Um caso passa só se todas as checagens passam. O relatório
// não depende da hora da correção: rodar de novo sem mudar nada dá o mesmo arquivo (e o mesmo hash).

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Check = { type: "regex" | "contains" | "not_contains"; value: string; description: string };
type Case = { id: string; input: string; checks: Check[] };
type Meta = { model: string; method: string; generatedAt: string };

const AGENTS = resolve(import.meta.dirname, "../../agents");

function passes(check: Check, out: string): boolean {
  const text = out.toLowerCase();
  switch (check.type) {
    case "regex":
      return new RegExp(check.value, "iu").test(out);
    case "contains":
      return text.includes(check.value.toLowerCase());
    case "not_contains":
      return !text.includes(check.value.toLowerCase());
    default:
      throw new Error(`tipo de checagem desconhecido: ${(check as Check).type}`);
  }
}

function grade(slug: string) {
  const dir = join(AGENTS, slug);
  const casesDir = join(dir, "evals", "cases");
  const outDir = join(dir, "evals", "outputs");
  const metaPath = join(outDir, "meta.json");
  if (!existsSync(metaPath)) throw new Error(`${slug}: falta evals/outputs/meta.json (gere as respostas antes)`);
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Meta;
  const { version } = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { version: string };

  const cases = readdirSync(casesDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(casesDir, f), "utf8")) as Case);
  const results = cases.map((c) => {
    const outPath = join(outDir, `${c.id}.md`);
    if (!existsSync(outPath)) return { id: c.id, passed: false, failed: ["sem resposta salva"] };
    const out = readFileSync(outPath, "utf8");
    const failed = c.checks.filter((k) => !passes(k, out)).map((k) => k.description);
    return { id: c.id, passed: failed.length === 0, failed };
  });
  const passed = results.filter((r) => r.passed).length;
  const report = {
    version,
    cases: cases.length,
    passed,
    scoreBps: cases.length ? Math.round((passed / cases.length) * 10000) : 0,
    runAt: meta.generatedAt,
    model: meta.model,
    method: meta.method,
    results,
  };
  writeFileSync(join(dir, "evals", "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const wanted = process.argv.slice(2);
const slugs = readdirSync(AGENTS).filter(
  (s) => existsSync(join(AGENTS, s, "evals", "cases")) && (wanted.length === 0 || wanted.includes(s)),
);
if (slugs.length === 0) throw new Error(`nenhum pacote com evals/cases: ${wanted.join(", ")}`);
let failedAny = false;
for (const slug of slugs) {
  try {
    const r = grade(slug);
    console.log(`${slug}: ${r.passed}/${r.cases} (${r.scoreBps / 100}%)`);
    for (const x of r.results.filter((x) => !x.passed)) console.log(`  ✗ ${x.id}: ${x.failed.join("; ")}`);
  } catch (e) {
    failedAny = true;
    console.error(`${slug}: ${(e as Error).message}`);
  }
}
if (failedAny) process.exitCode = 1;
