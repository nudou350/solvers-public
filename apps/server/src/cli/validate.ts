import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { validatePackage, type Issue, type ValidateOptions } from "../runtime/validate/index.js";
import { packageFromFolder } from "../runtime/validate/input.js";

// Valida pacotes Solver no disco (PACKAGE_SPEC.md 13). Sem banco, rede ou env.
//
//   npm run cli:validate -- ../../agents/financas-pessoais          # um pacote (pasta)
//   npm run cli:validate -- --all ../../agents                      # todas as pastas com manifest.json
//   npm run cli:validate -- --third-party --phase abertura <pasta>  # regras de terceiros (Núcleo por padrão)
//   npm run cli:validate -- --json <pasta>                          # saída máquina-legível
//
// Sai com código 1 se houver erro (aviso não reprova).

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--phase" && args[i - 1] !== "--min-price");

if (positional.length === 0) {
  console.error("uso: cli:validate [--all] [--third-party] [--phase nucleo|abertura] [--min-price N] [--json] <pasta>");
  process.exit(2);
}

const options: ValidateOptions = {
  origin: flag("--third-party") ? "third_party" : "platform",
  phase: opt("--phase") === "abertura" ? "abertura" : "nucleo",
  minPriceUsdc: opt("--min-price") ? Number(opt("--min-price")) : undefined,
};

const target = resolve(positional[0]!);
const dirs = flag("--all")
  ? readdirSync(target)
      .map((n) => join(target, n))
      .filter((d) => existsSync(join(d, "manifest.json")))
  : [target];

const fmt = (i: Issue) => `    ${i.code} ${i.path}\n      ${i.message}\n      → ${i.fix}`;
let failed = 0;
const json: Record<string, unknown> = {};
for (const dir of dirs) {
  const r = validatePackage(packageFromFolder(dir), options);
  if (!r.ok) failed += 1;
  json[dir] = r;
  if (flag("--json")) continue;
  const name = dir.split(/[\\/]/).pop();
  console.log(`${r.ok ? "✔" : "✘"} ${name}  (v${r.stats.specVersion}; ${r.stats.steps} etapas, ${r.stats.knowledgeFiles} arquivos de conhecimento ≈ ${r.stats.knowledgeChunksEstimate} trechos, ${r.stats.cases} casos; diferenciais: ${r.stats.differentiators.join(", ") || "nenhum"})`);
  if (r.errors.length) console.log(`  ${r.errors.length} erro(s):\n${r.errors.map(fmt).join("\n")}`);
  if (r.warnings.length) console.log(`  ${r.warnings.length} aviso(s):\n${r.warnings.map(fmt).join("\n")}`);
}
if (flag("--json")) console.log(JSON.stringify(dirs.length === 1 ? json[dirs[0]!] : json, null, 2));
process.exit(failed ? 1 : 0);
