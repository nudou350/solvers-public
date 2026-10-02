import "./helpers/fake-env.js";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

// Cache de pacotes: a API não pode servir o manifesto/versão antigos depois que OUTRO processo (cli:approve, worker) troca a
// pasta publicada. Os diretórios vêm do ambiente (env.ts lê na 1ª importação), então este arquivo só importa o runtime depois de
// apontar AGENTS_DIR e PUBLISHED_DIR para pastas temporárias (por isso fica separado de creator-fixes.test.ts).

describe("cache de pacotes: getPackage recarrega depois de uma publicação de outro processo", () => {
  let root: string;
  const ID = "0123456789abcdef0123456789abcdef";
  const manifest = (version: string) => ({
    id: ID,
    slug: "troca-solver",
    name: "Troca",
    tagline: "Frase",
    description: "Descrição",
    category: "Outros",
    version,
    creator: { id: "c", name: "Criador", bio: "Bio" },
    requirements: [],
    packageContents: [],
    steps: [{ file: "steps/01-primeira.md", gate: [] }],
    pricing: { priceUsdc: 5, royaltyBps: 0 },
    guarantee: { available: false, defaultCriteria: [] },
  });
  const publish = (version: string) => {
    const dir = join(root, "published", "troca-solver");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "steps"), { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest(version)));
    writeFileSync(join(dir, "steps", "01-primeira.md"), "# Etapa 1\n\nFaça.");
    const when = new Date(Date.now() + Number(version.split(".")[1]) * 10_000);
    utimesSync(join(dir, "manifest.json"), when, when);
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), "solvers-reload-"));
    mkdirSync(join(root, "agents"));
    mkdirSync(join(root, "published"));
    process.env.AGENTS_DIR = join(root, "agents");
    process.env.PUBLISHED_DIR = join(root, "published");
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it("a API segue o disco sem reiniciar (sem reloadPackages explícito)", async () => {
    const { getPackage, refreshPackagesIfChanged } = await import("../src/runtime/packages.js");
    publish("1.0.0");
    assert.equal(getPackage(ID)?.manifest.version, "1.0.0");
    // Outro processo (cli:approve) troca a pasta publicada: a API ainda tem o cache velho dentro do intervalo de 5 s...
    publish("1.1.0");
    assert.equal(getPackage(ID)?.manifest.version, "1.0.0", "dentro do intervalo não confere o disco (custo baixo)");
    // ...e recarrega quando a conferência roda.
    assert.equal(refreshPackagesIfChanged(true), true);
    assert.equal(getPackage(ID)?.manifest.version, "1.1.0");
    assert.equal(refreshPackagesIfChanged(true), false, "sem mudança não recarrega");
  });
});

