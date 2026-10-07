import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { chunkMarkdown, chunkPlainText } from "../src/knowledge/chunk.js";
import { isKnowledgeFile, normalizeMeta, parseKnowledgeFile } from "../src/knowledge/file-rules.js";
import { QUOTA_WINDOW_MS, dateText, hitText, hitsText, isStale, quotaExceeded, quotaText, trialFilesOnly } from "../src/knowledge/search-rules.js";

// Regras puras do conhecimento (PACKAGE_SPEC.md 6): leitura de .md/.txt, front-matter, aviso de validade,
// teste grátis v1 e cota diária. Sem env nem banco.

const MD = `---
title: Rotativo do cartão
source: Banco Central do Brasil, Resolução CMN 4.549
source_url: https://www.bcb.gov.br/x
source_date: 2026-09-01
valid_until: 2026-12-31
tags: [juros, cartão]
trial: true
---
# Rotativo

Texto do rotativo.
`;

describe("parseKnowledgeFile .md", () => {
  it("front-matter vira meta e valid_until; o corpo não inclui o bloco ---", () => {
    const p = parseKnowledgeFile("knowledge/rotativo.md", MD);
    assert.deepEqual(p.meta, {
      title: "Rotativo do cartão",
      source: "Banco Central do Brasil, Resolução CMN 4.549",
      source_url: "https://www.bcb.gov.br/x",
      source_date: "2026-09-01",
      valid_until: "2026-12-31",
      tags: ["juros", "cartão"],
      trial: true,
    });
    assert.equal(p.validUntil, "2026-12-31");
    assert.equal(p.chunks.length, 1);
    assert.doesNotMatch(p.chunks[0]!, /---|source:/);
    assert.match(p.chunks[0]!, /Texto do rotativo/);
  });

  it("pacote v0 (sem front-matter): chunks idênticos ao chunkMarkdown, sem meta", () => {
    const md = "# A\n\ntexto\n\n## B\n\noutro";
    const p = parseKnowledgeFile("a.md", md);
    assert.deepEqual(p.chunks, chunkMarkdown(md));
    assert.equal(p.meta, null);
    assert.equal(p.validUntil, null);
  });

  it("sem title: usa o primeiro título do texto", () => {
    const p = parseKnowledgeFile("a.md", "---\nsource: Fonte X\n---\n# Meu título\n\ncorpo");
    assert.equal(p.meta?.title, "Meu título");
  });

  it("data inválida é descartada; trial só com true; tags limitadas a 10", () => {
    const p = parseKnowledgeFile("a.md", "---\nsource: S\nvalid_until: 2026-02-30\ntrial: false\ntags: [a,b,c,d,e,f,g,h,i,j,k,l]\n---\ncorpo");
    assert.equal(p.validUntil, null);
    assert.equal(p.meta?.valid_until, undefined);
    assert.equal(p.meta?.trial, undefined);
    assert.equal(p.meta?.tags?.length, 10);
  });

  it("front-matter quebrado: arquivo entra sem meta (o validador recusa na publicação)", () => {
    const p = parseKnowledgeFile("a.md", "---\nisto não é yaml\n---\ncorpo");
    assert.equal(p.meta, null);
    assert.ok(p.chunks.length >= 1);
  });
});

describe("parseKnowledgeFile .txt", () => {
  it("seção única: linhas com # não viram títulos", () => {
    const txt = "# não é título\nlinha 2\n\n# outra linha\nlinha 4";
    const p = parseKnowledgeFile("a.txt", txt);
    assert.equal(p.chunks.length, 1);
    assert.deepEqual(chunkMarkdown(txt).length, 2); // o .md teria dividido
  });

  it("metadados vêm do .txt.meta.json", () => {
    const p = parseKnowledgeFile("a.txt", "conteúdo", JSON.stringify({ title: "T", source: "Fonte", valid_until: "2026-01-01", trial: true, tags: ["x"] }));
    assert.equal(p.meta?.source, "Fonte");
    assert.equal(p.meta?.trial, true);
    assert.equal(p.validUntil, "2026-01-01");
  });

  it(".meta.json inválido ou ausente: sem meta", () => {
    assert.equal(parseKnowledgeFile("a.txt", "x y z", "{quebrado").meta, null);
    assert.equal(parseKnowledgeFile("a.txt", "x y z").meta, null);
  });

  it("texto longo é dividido por tamanho; vazio não gera trecho", () => {
    const big = Array.from({ length: 40 }, (_, i) => `parágrafo ${i} ${"x".repeat(150)}`).join("\n\n");
    assert.ok(chunkPlainText(big).length > 1);
    assert.deepEqual(chunkPlainText("   \n "), []);
  });

  it("só .md e .txt entram; .txt.meta.json e o resto não", () => {
    assert.equal(isKnowledgeFile("a.md"), true);
    assert.equal(isKnowledgeFile("a.TXT"), true);
    assert.equal(isKnowledgeFile("a.txt.meta.json"), false);
    assert.equal(isKnowledgeFile("a.pdf"), false);
    assert.equal(normalizeMeta({}), null);
  });
});

describe("aviso de validade e texto dos trechos", () => {
  const meta = { title: "Rotativo", source: "BCB, Res. 4.549", source_url: "https://bcb.gov.br/x", source_date: "2026-09-01" };

  it("dateBr e isStale (o dia de valid_until ainda vale)", () => {
    assert.equal(dateText("2026-12-31"), "2026-12-31");
    assert.equal(dateText(null), "");
    assert.equal(isStale("2026-10-01", new Date("2026-10-02T12:00:00Z")), true);
    assert.equal(isStale("2026-10-02", new Date("2026-10-02T23:59:00Z")), false);
    // O dia é o de Brasília: 22h de 02/10 lá já é 03/10 em UTC, e o dia de validade ainda vale.
    assert.equal(isStale("2026-10-02", new Date("2026-10-03T01:00:00Z")), false);
    assert.equal(isStale("2026-10-02", new Date("2026-10-03T04:00:00Z")), true);
    assert.equal(isStale(null, new Date()), false);
  });

  it("trecho vencido traz 'may be out of date (valid until AAAA-MM-DD)'", () => {
    const t = hitText({ source: "knowledge/a.md", content: "corpo", meta, validUntil: "2026-10-01" }, 1, new Date("2026-10-05T00:00:00Z"));
    assert.match(t, /may be out of date \(valid until 2026-10-01\)/);
    assert.match(t, /Source: BCB, Res\. 4\.549/);
    assert.match(t, /source date: 2026-09-01/);
    assert.match(t, /### Excerpt 1: Rotativo/);
  });

  it("trecho dentro da validade não traz aviso", () => {
    const t = hitText({ source: "knowledge/a.md", content: "corpo", meta, validUntil: "2026-12-31" }, 1, new Date("2026-10-05T00:00:00Z"));
    assert.doesNotMatch(t, /out of date/);
  });

  it("pacote v0 (sem meta): cabeçalho antigo, sem instrução de citar", () => {
    const hits = [{ source: "knowledge/a.md", content: "corpo", meta: null, validUntil: null }];
    assert.equal(hitText(hits[0]!, 2, new Date()), "### Excerpt 2 (knowledge/a.md)\ncorpo");
    const all = hitsText(hits, new Date(), "MARCA");
    assert.doesNotMatch(all, /Cite the source/);
    assert.ok(all.endsWith("\n\nMARCA"));
  });

  it("com fonte: instrução de citar, no máximo o que veio e marca d'água ao final", () => {
    const hits = [{ source: "knowledge/a.md", content: "corpo", meta, validUntil: "2026-01-01" }];
    const all = hitsText(hits, new Date("2026-10-05T00:00:00Z"), "MARCA");
    assert.match(all, /Cite the source of each excerpt/);
    assert.match(all, /suggesting confirming it at the source|suggest confirming it at the source/);
    assert.ok(all.endsWith("\n\nMARCA"));
  });
});

describe("teste grátis e cota", () => {
  it("teste grátis: só v1 filtra por trial:true; v0 mantém a base inteira; licença não filtra", () => {
    assert.equal(trialFilesOnly({ specVersion: 1, accessIsTrial: true }), true);
    assert.equal(trialFilesOnly({ specVersion: undefined, accessIsTrial: true }), false);
    assert.equal(trialFilesOnly({ specVersion: 1, accessIsTrial: false }), false);
  });

  it("cota: 0 desliga; no limite bloqueia; abaixo passa", () => {
    assert.equal(quotaExceeded(10_000, 0), false);
    assert.equal(quotaExceeded(299, 300), false);
    assert.equal(quotaExceeded(300, 300), true);
    assert.match(quotaText(300), /Daily limit reached/);
    assert.equal(QUOTA_WINDOW_MS, 86_400_000);
  });
});
