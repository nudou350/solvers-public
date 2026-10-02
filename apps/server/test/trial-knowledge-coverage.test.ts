import { strict as assert } from "node:assert";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { isKnowledgeFile, metaJsonPathFor, parseKnowledgeFile } from "../src/knowledge/file-rules.js";
import { trialFilesOnly } from "../src/knowledge/search-rules.js";

// Regressão do teste grátis: num pacote v1 o search_knowledge do teste só enxerga os arquivos de
// `knowledge/` com `trial: true` (PACKAGE_SPEC.md 6.5 item 4). Sem nenhum arquivo marcado, a busca do teste
// devolve "Nada relevante..." para qualquer consulta, mesmo com `trial.searches` > 0 no manifesto.
// Aqui, para cada pacote de `agents/`: com teste grátis e buscas liberadas, há arquivos liberados, e são uma
// parte pequena da base (a demonstração mostra valor sem entregar tudo). Sem env nem banco: só lê o disco.

const AGENTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "agents");
/** Teto da fatia da base liberada no teste, em arquivos e em trechos. */
const MAX_SHARE = 0.35;

type KFile = { source: string; chunks: number; trial: boolean };

function knowledgeFiles(root: string): KFile[] {
  const base = join(root, "knowledge");
  if (!existsSync(base) || !lstatSync(base).isDirectory()) return [];
  const out: KFile[] = [];
  const walk = (cur: string, rel: string[]) => {
    for (const name of readdirSync(cur).sort()) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const abs = join(cur, name);
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(abs, [...rel, name]);
      else if (isKnowledgeFile(name)) {
        const metaPath = metaJsonPathFor(abs);
        const metaJson = /\.txt$/i.test(name) && existsSync(metaPath) ? readFileSync(metaPath, "utf8") : null;
        const parsed = parseKnowledgeFile(name, readFileSync(abs, "utf8"), metaJson);
        out.push({ source: ["knowledge", ...rel, name].join("/").split(sep).join("/"), chunks: parsed.chunks.length, trial: parsed.meta?.trial === true });
      }
    }
  };
  walk(base, []);
  return out;
}

type Loaded = { slug: string; specVersion: number; trialSearches: number; files: KFile[] };

function loadAll(): Loaded[] {
  const out: Loaded[] = [];
  for (const dir of readdirSync(AGENTS).sort()) {
    if (dir.startsWith("_") || dir.startsWith(".")) continue;
    const root = join(AGENTS, dir);
    const manifestPath = join(root, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const m = JSON.parse(readFileSync(manifestPath, "utf8")) as { specVersion?: number; trial?: { available?: boolean; searches?: number } };
    const t = m.trial;
    const trialSearches = t && t.available !== false ? (t.searches ?? 0) : 0;
    out.push({ slug: dir, specVersion: m.specVersion ?? 0, trialSearches, files: knowledgeFiles(root) });
  }
  return out;
}

const packages = loadAll();

describe("teste grátis: conhecimento liberado em cada pacote de agents/", () => {
  it("encontra os pacotes (a verificação não passa por falta de pacote)", () => {
    assert.ok(packages.length >= 6, `esperava ao menos 6 pacotes em ${AGENTS}, achei ${packages.length}`);
    assert.ok(packages.some((p) => p.specVersion === 1 && p.trialSearches > 0), "nenhum pacote v1 com teste grátis e buscas");
  });

  for (const p of packages) {
    describe(p.slug, () => {
      const marked = p.files.filter((f) => f.trial);
      const gated = p.specVersion === 1 && p.trialSearches > 0 && p.files.length > 0;

      if (gated) {
        it("a busca do teste grátis é restrita a arquivos com trial: true (pacote v1)", () => {
          assert.equal(trialFilesOnly({ specVersion: p.specVersion, accessIsTrial: true }), true);
        });

        it("trial.searches > 0 e há ao menos um arquivo de conhecimento liberado no teste", () => {
          assert.ok(marked.length > 0, `${p.slug}: trial.searches = ${p.trialSearches}, mas nenhum arquivo de knowledge/ tem "trial: true"; a busca do teste grátis devolveria sempre "Nada relevante"`);
        });

        it(`os arquivos liberados são no máximo ${MAX_SHARE * 100}% dos arquivos`, () => {
          const share = marked.length / p.files.length;
          assert.ok(share <= MAX_SHARE, `${p.slug}: ${marked.length} de ${p.files.length} arquivos liberados (${Math.round(share * 100)}%)`);
        });

        it(`os trechos liberados são no máximo ${MAX_SHARE * 100}% dos trechos`, () => {
          const total = p.files.reduce((n, f) => n + f.chunks, 0);
          const free = marked.reduce((n, f) => n + f.chunks, 0);
          assert.ok(total > 0 && free / total <= MAX_SHARE, `${p.slug}: ${free} de ${total} trechos liberados (${total ? Math.round((free / total) * 100) : 0}%)`);
        });
      } else {
        it("sem teste com buscas (ou sem conhecimento, ou pacote v0): nenhum arquivo marcado", () => {
          assert.deepEqual(marked.map((f) => f.source), [], `${p.slug}: "trial: true" sem teste grátis com buscas não tem efeito`);
        });
      }
    });
  }
});
