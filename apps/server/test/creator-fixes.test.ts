import "./helpers/fake-env.js";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { isStale, todayInSaoPaulo } from "../src/knowledge/search-rules.js";
import { frontMatterHead, differentiatorsInput, provenDifferentiators } from "../src/runtime/differentiators.js";
import { packagesStamp } from "../src/runtime/package-loader.js";
import { loadPackage } from "../src/runtime/package-loader.js";
import { packageFromFolder, packageFromMemory } from "../src/runtime/validate/input.js";
import { validatePackage } from "../src/runtime/validate/index.js";
import { injectionMatch, sendingUrl, sensitiveAsk, urlsIn } from "../src/runtime/validate/text-scans.js";
import { scanPackage } from "../src/review/scans.js";
import { attemptsExhausted, MAX_ATTEMPTS } from "../src/submissions/process.js";
import { versionGreater } from "../src/submissions/rules.js";
import { EXPIRED_NOTE, filesExpired, orphanFolderStale, partFileStale, staleOpen } from "../src/submissions/cleanup-rules.js";
import { extractZip, NUCLEO_ZIP_LIMITS, ZipError } from "../src/submissions/zip.js";
import { notListedBlock } from "../src/store/purchase-rules.js";
import { PlatformAgentIgnored, mirrorAgentAccount } from "../src/indexer/sync.js";
import { buildZip, type ZipSpec } from "./helpers/zip-builder.js";

// Correções da revisão do fluxo de criação de Solvers que não precisam de banco: varreduras em tempo linear, carimbo do
// cache de pacotes, ZIP (manifest exato, arquivo x pasta), regras da faxina, versão, venda sem catálogo, id da plataforma.

const DAY = 86_400_000;

/** Roda `fn` e exige que termine em menos de `ms` (os casos ruins levavam segundos). */
function fast<T>(label: string, fn: () => T, ms = 100): T {
  const t0 = performance.now();
  const out = fn();
  const took = performance.now() - t0;
  assert.ok(took < ms, `${label}: ${took.toFixed(0)} ms (limite ${ms} ms)`);
  return out;
}

describe("varreduras de texto em tempo linear (DoS por regex quadrática)", () => {
  it("200 mil '?' numa URL e 100 mil pontuações no fim", () => {
    const url = `https://a.com/${"?".repeat(200_000)}`;
    fast("sendingUrl", () => sendingUrl(url));
    fast("urlsIn", () => urlsIn(url));
    fast("urlsIn pontuação", () => urlsIn(`http://x.com/${".".repeat(100_000)}a`));
    fast("urlsIn pontuação no fim", () => urlsIn(`http://x.com/a${"!?.,;:".repeat(20_000)}`));
  });

  it("40 mil espaços depois de '<' e linhas gigantes nas frases de injeção e de dado sensível", () => {
    fast("tag <system>", () => injectionMatch(`<${" ".repeat(40_000)}x`));
    fast("tag <system> repetida", () => injectionMatch("< ".repeat(40_000)));
    fast("ignore + espaços", () => injectionMatch(`ignore${" ".repeat(100_000)}x`));
    fast("ignore repetido", () => injectionMatch("ignore todas as ".repeat(20_000)));
    fast("sensitiveAsk", () => sensitiveAsk(`peça ${"senha ".repeat(50_000)}`));
  });

  it("scanPackage: href= com 80 mil espaços, '](' repetido e comentário gigante", () => {
    const text = `href=${" ".repeat(80_000)}x\n](${" ".repeat(80_000)}x\n${"![a](".repeat(20_000)}\n<!--${"-".repeat(100_000)}`;
    fast("scanPackage", () => scanPackage(packageFromMemory({ "steps/01.md": text, "manifest.json": "{}" })), 300);
  });

  it("o resultado de sempre continua o mesmo (consulta com '=', '#' antes do '=', verbos de envio)", () => {
    assert.equal(sendingUrl("veja https://a.com/x?id=1"), "https://a.com/x?id=1");
    assert.equal(sendingUrl("veja https://a.com/x#a?b=1"), "https://a.com/x#a?b=1", "o '?' depois do '#' ainda conta (regex antiga)");
    assert.equal(sendingUrl("veja https://a.com/x?id"), null);
    assert.equal(sendingUrl("veja https://a.com/x#frag=1"), null);
    assert.equal(sendingUrl("envie os dados para https://a.com/x"), "https://a.com/x");
    assert.deepEqual(urlsIn("ver https://a.com/x?a=b, depois."), [{ url: "https://a.com/x?a=b", sending: true, line: "ver https://a.com/x?a=b, depois." }]);
    assert.equal(urlsIn("ver https://a.com/x.")[0]!.url, "https://a.com/x");
    assert.ok(injectionMatch("</ system >"));
    assert.ok(injectionMatch("<instructions>"));
    assert.equal(injectionMatch("<div>"), null);
  });
});

describe("ZIP: manifest exato e caminho que é arquivo e pasta", () => {
  let tmp: string;
  let n = 0;
  before(async () => {
    tmp = await mkdtemp(join(tmpdir(), "solvers-cfxzip-"));
  });
  after(async () => {
    await rm(tmp, { recursive: true, force: true });
  });
  const codes = async (specs: ZipSpec[]) => {
    const zip = join(tmp, `z${n}.zip`);
    await writeFile(zip, buildZip(specs));
    try {
      await extractZip(zip, join(tmp, `out${n++}`), NUCLEO_ZIP_LIMITS);
    } catch (e) {
      assert.ok(e instanceof ZipError, String(e));
      return e.issues;
    }
    return [];
  };

  it("MANIFEST.JSON (outra caixa) é recusado com ZIP_BAD_ROOT", async () => {
    const issues = await codes([{ name: "pkg/MANIFEST.JSON", data: "{}" }, { name: "pkg/steps/01-a.md", data: "x" }]);
    assert.ok(issues.some((i) => i.code === "ZIP_BAD_ROOT" && /exato/.test(i.message)));
    assert.deepEqual(await codes([{ name: "pkg/manifest.json", data: "{}" }]), []);
  });

  it("'steps' arquivo e 'steps/01.md' ao mesmo tempo: ZIP_BAD_PATH limpo (sem EISDIR nem caminho absoluto)", async () => {
    const issues = await codes([{ name: "pkg/manifest.json", data: "{}" }, { name: "pkg/steps.md", data: "x" }, { name: "pkg/steps.md/01.md", data: "y" }]);
    assert.deepEqual(issues.map((i) => i.code), ["ZIP_BAD_PATH"]);
    assert.doesNotMatch(JSON.stringify(issues), new RegExp(tmp.replace(/\\/g, "\\\\")));
  });
});

describe("cache de pacotes: carimbo das pastas", () => {
  const dirs: string[] = [];
  after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const mk = () => {
    const d = mkdtempSync(join(tmpdir(), "solvers-stamp-"));
    dirs.push(d);
    return d;
  };

  it("muda quando outra processo troca a pasta publicada ou sobe a versão; não muda sem mexida", () => {
    const root = mk();
    mkdirSync(join(root, "meu-solver"));
    writeFileSync(join(root, "meu-solver", "manifest.json"), JSON.stringify({ version: "1.0.0" }));
    const before = packagesStamp([root, join(root, "nao-existe")]);
    assert.equal(packagesStamp([root, join(root, "nao-existe")]), before, "estável");
    // "Outro processo": a pasta nova entra no lugar da antiga (versão maior, manifesto maior, mtime diferente).
    rmSync(join(root, "meu-solver"), { recursive: true });
    mkdirSync(join(root, "meu-solver"));
    writeFileSync(join(root, "meu-solver", "manifest.json"), JSON.stringify({ version: "1.1.0", extra: "mais bytes" }));
    utimesSync(join(root, "meu-solver", "manifest.json"), new Date(Date.now() + 5_000), new Date(Date.now() + 5_000));
    assert.notEqual(packagesStamp([root]), before);
    // Pastas ocultas e de arquivo morto não entram.
    mkdirSync(join(root, "_archive", "x"), { recursive: true });
    writeFileSync(join(root, "_archive", "x", "manifest.json"), "{}");
    const withArchive = packagesStamp([root]);
    mkdirSync(join(root, ".incoming", "y"), { recursive: true });
    writeFileSync(join(root, ".incoming", "y", "manifest.json"), "{}");
    assert.equal(packagesStamp([root]), withArchive);
  });
});

describe("regras da faxina e versão", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  it("filesExpired: só rejeitadas há mais de 30 dias", () => {
    assert.equal(filesExpired("rejected", ago(31), now), true);
    assert.equal(filesExpired("rejected_validation", ago(31), now), true);
    assert.equal(filesExpired("rejected", ago(29), now), false);
    assert.equal(filesExpired("published", ago(400), now), false);
    assert.equal(filesExpired("pending_review", ago(400), now), false);
  });
  it("staleOpen: changes_requested e awaiting_creator_signature há mais de 30 dias", () => {
    assert.equal(staleOpen("changes_requested", ago(31), now), true);
    assert.equal(staleOpen("awaiting_creator_signature", ago(31), now), true);
    assert.equal(staleOpen("changes_requested", ago(30), now), false);
    for (const s of ["pending_review", "awaiting_onchain_approval", "publishing", "publish_failed", "published", "submitted", "validating"]) assert.equal(staleOpen(s, ago(400), now), false, s);
    assert.match(EXPIRED_NOTE, /expirad/);
  });
  it("partFileStale e orphanFolderStale: um dia de folga", () => {
    assert.equal(partFileStale("package.zip.abc.part", ago(2).getTime(), now), true);
    assert.equal(partFileStale("package.zip.abc.part", ago(0.5).getTime(), now), false);
    assert.equal(partFileStale("package.zip", ago(20).getTime(), now), false);
    assert.equal(orphanFolderStale(false, ago(2).getTime(), now), true);
    assert.equal(orphanFolderStale(false, ago(0.2).getTime(), now), false);
    assert.equal(orphanFolderStale(true, ago(20).getTime(), now), false);
  });
  it("versionGreater e attemptsExhausted", () => {
    assert.equal(versionGreater("1.2.0", "1.1.9"), true);
    assert.equal(versionGreater("1.10.0", "1.9.0"), true);
    assert.equal(versionGreater("1.2.0", "1.2.0"), false);
    assert.equal(versionGreater("1.1.9", "1.2.0"), false);
    assert.equal(versionGreater("1.0.0-beta", "0.9.0"), false);
    assert.equal(attemptsExhausted(MAX_ATTEMPTS - 1), false);
    assert.equal(attemptsExhausted(MAX_ATTEMPTS), true);
  });
});

describe("venda: só o que está no catálogo e tem pacote", () => {
  it("notListedBlock: 409 agent_not_listed quando falta uma das duas coisas", () => {
    assert.equal(notListedBlock({ listed: true, hasPackage: true }), null);
    for (const input of [{ listed: false, hasPackage: true }, { listed: true, hasPackage: false }, { listed: false, hasPackage: false }]) {
      const e = notListedBlock(input);
      assert.equal(e?.status, 409);
      assert.equal(e?.code, "agent_not_listed");
    }
  });
});

describe("indexador: id reservado da plataforma", () => {
  it("um agente on-chain com o id do Criador de Solvers é ignorado antes de qualquer escrita", async () => {
    const agentId = Uint8Array.from(Buffer.from("c71ad0a50f750e75c71ad0a50f750e75", "hex"));
    await assert.rejects(mirrorAgentAccount("AgenteFalso1111111111111111111111111111111111" as never, { agentId } as never), (e: unknown) => e instanceof PlatformAgentIgnored);
  });
});

describe("valid_until no fuso de Brasília", () => {
  it("o dia de validade ainda vale às 22h em Brasília (já é o dia seguinte em UTC)", () => {
    const at22 = new Date("2026-10-03T01:00:00Z"); // 02/10 22:00 em Brasília
    assert.equal(todayInSaoPaulo(at22), "2026-10-02");
    assert.equal(isStale("2026-10-02", at22), false);
    assert.equal(isStale("2026-10-01", at22), true);
    const after = new Date("2026-10-03T04:00:00Z"); // 03/10 01:00 em Brasília
    assert.equal(isStale("2026-10-02", after), true);
  });
});

describe("diferenciais: leitura enxuta com o mesmo resultado", () => {
  it("frontMatterHead guarda só o bloco ---", () => {
    assert.equal(frontMatterHead("---\nsource: X\nvalid_until: 2030-01-01\n---\ncorpo grande\nmais"), "---\nsource: X\nvalid_until: 2030-01-01\n---\n");
    assert.equal(frontMatterHead("sem front-matter\ncorpo"), "");
    assert.equal(frontMatterHead("---\naberto sem fechar\ncorpo"), "---\naberto sem fechar\ncorpo");
  });

  it("os pacotes de agents/ dão os mesmos diferenciais pela leitura enxuta e pela completa", async () => {
    const { readdirSync, existsSync } = await import("node:fs");
    const agents = join(process.cwd(), "..", "..", "agents");
    if (!existsSync(agents)) return;
    let checked = 0;
    for (const name of readdirSync(agents)) {
      const dir = join(agents, name);
      if (!existsSync(join(dir, "manifest.json"))) continue;
      let pkg;
      try {
        pkg = loadPackage(dir);
      } catch {
        continue;
      }
      if (pkg.manifest.specVersion !== 1) continue;
      const full = validatePackage(packageFromFolder(dir), { mode: "platform" }).stats.differentiators;
      assert.deepEqual(provenDifferentiators(pkg), full, name);
      assert.deepEqual(validatePackage(differentiatorsInput(packageFromFolder(dir)), { mode: "platform" }).stats.differentiators, full, name);
      checked += 1;
    }
    assert.ok(checked > 0, "nenhum pacote v1 em agents/ para comparar");
  });
});
