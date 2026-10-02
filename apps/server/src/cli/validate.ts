import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validatePackage, type Issue, type ValidateOptions } from "../runtime/validate/index.js";
import { packageFromFolder } from "../runtime/validate/input.js";
import { extractZip, NUCLEO_ZIP_LIMITS, ZipError } from "../submissions/zip.js";

// Valida pacotes Solver no disco (PACKAGE_SPEC.md 13). Sem banco, rede ou env.
//
//   npm run cli:validate -- ../../agents/financas-pessoais          # um pacote (pasta)
//   npm run cli:validate -- meu-pacote.zip                          # um ZIP: extrai com as regras do upload (§3.2) e valida como terceiro
//   npm run cli:validate -- --all ../../agents                      # todas as pastas com manifest.json
//   npm run cli:validate -- --third-party --phase abertura <pasta>  # regras de terceiros (Núcleo por padrão)
//   npm run cli:validate -- --platform meu-pacote.zip               # ZIP validado com as regras da plataforma
//   npm run cli:validate -- --json <pasta ou zip>                   # saída máquina-legível
//
// Sai com código 1 se houver erro (aviso não reprova). ZIP é extraído numa pasta temporária (sem executar nada) que é apagada no fim.

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--phase" && args[i - 1] !== "--min-price");

if (positional.length === 0) {
  console.error("uso: cli:validate [--all] [--third-party|--platform] [--phase nucleo|abertura] [--min-price N] [--json] <pasta ou .zip>");
  process.exit(2);
}

const target = resolve(positional[0]!);
const isZip = existsSync(target) && statSync(target).isFile() && /\.zip$/i.test(target);

const options: ValidateOptions = {
  // Um ZIP é um envio: vale a regra de terceiros, a menos que se peça --platform.
  origin: flag("--third-party") || (isZip && !flag("--platform")) ? "third_party" : "platform",
  phase: opt("--phase") === "abertura" ? "abertura" : "nucleo",
  minPriceUsdc: opt("--min-price") ? Number(opt("--min-price")) : undefined,
};

const fmt = (i: { code: string; path: string; message: string; fix: string }) => `    ${i.code} ${i.path}\n      ${i.message}\n      → ${i.fix}`;

let tmp: string | undefined;
const cleanup = () => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
};

let dirs: string[];
const zipWarnings: Issue[] = [];
if (isZip) {
  tmp = mkdtempSync(join(tmpdir(), "solvers-validate-"));
  try {
    const out = await extractZip(target, join(tmp, "pkg"), NUCLEO_ZIP_LIMITS);
    options.archive = { zipBytes: out.zipBytes, expandedBytes: out.expandedBytes, roots: 1 };
    zipWarnings.push(...(out.warnings as Issue[]));
    dirs = [out.root];
  } catch (e) {
    cleanup();
    if (!(e instanceof ZipError)) throw e;
    if (flag("--json")) console.log(JSON.stringify({ ok: false, errors: e.issues, warnings: [] }, null, 2));
    else console.log(`✘ ${target}\n  ${e.issues.length} erro(s) no ZIP:\n${e.issues.map(fmt).join("\n")}`);
    process.exit(1);
  }
} else {
  dirs = flag("--all")
    ? readdirSync(target)
        .map((n) => join(target, n))
        .filter((d) => existsSync(join(d, "manifest.json")))
    : [target];
}

let failed = 0;
const json: Record<string, unknown> = {};
for (const dir of dirs) {
  const r = validatePackage(packageFromFolder(dir), options);
  for (const w of zipWarnings) r.warnings.push(w);
  if (!r.ok) failed += 1;
  json[dir] = r;
  if (flag("--json")) continue;
  const name = isZip ? target.split(/[\\/]/).pop() : dir.split(/[\\/]/).pop();
  console.log(`${r.ok ? "✔" : "✘"} ${name}  (v${r.stats.specVersion}; ${r.stats.steps} etapas, ${r.stats.knowledgeFiles} arquivos de conhecimento ≈ ${r.stats.knowledgeChunksEstimate} trechos, ${r.stats.cases} casos; diferenciais: ${r.stats.differentiators.join(", ") || "nenhum"})`);
  if (r.errors.length) console.log(`  ${r.errors.length} erro(s):\n${r.errors.map(fmt).join("\n")}`);
  if (r.warnings.length) console.log(`  ${r.warnings.length} aviso(s):\n${r.warnings.map(fmt).join("\n")}`);
}
if (flag("--json")) console.log(JSON.stringify(dirs.length === 1 ? json[dirs[0]!] : json, null, 2));
cleanup();
process.exit(failed ? 1 : 0);
