import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import sharp from "sharp";
import { ART_H, ART_W, gallerySvgs, renderPng, truncate, wrap, type ArtInput } from "../src/images/seed-art.js";
import { SKIP_WITHOUT_PAID } from "./helpers/repo-agents.js";

// Cartões de galeria da demo, gerados do que o pacote declara. Sem banco nem rede (lê só os manifestos de /agents).

const base: ArtInput = {
  name: "A & B <script>",
  tagline: 'Frase com "aspas" e <tags>',
  category: "Desenvolvimento",
  version: "1.0.0",
  creatorName: "Criador",
  steps: [{ title: "Passo", gate: ["ok"] }],
  beforeAfter: [{ prompt: "p", withoutSolver: "a", withSolver: "b" }],
  packageContents: ["item"],
};

describe("wrap e truncate", () => {
  it("quebra em palavras inteiras e respeita o máximo de linhas com reticências", () => {
    assert.deepEqual(wrap("um dois três quatro", 9), ["um dois", "três", "quatro"]);
    const two = wrap("um dois três quatro cinco seis", 9, 2);
    assert.equal(two.length, 2);
    assert.ok(two[1]!.endsWith("…"));
  });

  it("truncate corta em palavra inteira e não passa do máximo", () => {
    const t = truncate("uma frase bem comprida para cortar", 20);
    assert.ok(t.length <= 20 && t.endsWith("…"), t);
    assert.ok(!/\s…$/.test(t));
    assert.equal(truncate("curta", 20), "curta");
  });
});

describe("gallerySvgs", () => {
  it("escapa XML: nome ou frase do criador nunca viram marcação", () => {
    const all = gallerySvgs(base).map((s) => s.svg).join("");
    assert.ok(!all.includes("<script>"));
    assert.ok(all.includes("A &amp; B &lt;script&gt;"));
  });

  it("só gera o cartão cujo conteúdo existe (capa sempre)", () => {
    assert.deepEqual(gallerySvgs({ ...base, steps: [], beforeAfter: [], packageContents: [] }).map((s) => s.name), ["capa"]);
    assert.deepEqual(gallerySvgs(base).map((s) => s.name), ["capa", "metodo", "antes-depois", "pacote"]);
  });

  it("os 8 especialistas do repositório geram de 3 a 5 cartões que viram PNG do tamanho certo", { skip: SKIP_WITHOUT_PAID }, async () => {
    const dir = join(import.meta.dirname, "..", "..", "..", "agents");
    // Pastas começadas por "_" (ex.: _exemplos) não são pacotes do catálogo.
    const slugs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_")).map((d) => d.name);
    assert.ok(slugs.length >= 8, `achou ${slugs.length} pacotes`);
    for (const slug of slugs) {
      const m = JSON.parse(readFileSync(join(dir, slug, "manifest.json"), "utf8"));
      const input: ArtInput = {
        name: m.name,
        tagline: m.tagline,
        category: m.category,
        version: m.version,
        creatorName: m.creator.name,
        steps: m.steps.map((s: { title?: string; gate?: string[] }) => ({ title: s.title ?? "Etapa", gate: s.gate ?? [] })),
        beforeAfter: m.beforeAfter ?? [],
        packageContents: m.packageContents,
      };
      const slides = gallerySvgs(input);
      assert.ok(slides.length >= 3 && slides.length <= 5, `${slug}: ${slides.length} cartões`);
      const meta = await sharp(await renderPng(slides[0]!.svg)).metadata();
      assert.deepEqual([meta.width, meta.height, meta.format], [ART_W, ART_H, "png"]);
    }
  });
});
