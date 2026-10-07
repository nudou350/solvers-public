import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { canTransition, nextActionFor, SUBMISSION_STATUSES, type SubmissionStatus } from "@solvers/shared";
import {
  adminWallets,
  creatorNotReady,
  differentiatorsOf,
  generateInviteCode,
  isAdminWallet,
  mergeWarnings,
  normalizeInviteCode,
  normalizeManifest,
  planApproval,
  priceToUnits,
  reviewPathProblem,
  reviewTransitionProblem,
  safeManifestFields,
  toSubmissionView,
  uploadLimitProblem,
} from "../src/submissions/rules.js";

// Regras puras do envio e da revisão (sem banco, rede ou disco).

const CHECKLIST = { promiseDelivered: true, twoDifferentiatorsProven: true, rightsAndSources: true, noHarmfulInstructions: true, priceTrialShowcaseCoherent: true };
const OK_VALIDATION = { ok: true, errors: [], warnings: [] };
const manifest = (pricing: Record<string, unknown> = { priceUsdc: 9, royaltyBps: 500 }) => ({ name: "Meu Solver", version: "1.0.0", pricing });
const plan = (over: Partial<Parameters<typeof planApproval>[0]> = {}) =>
  planApproval({ status: "pending_review", validation: OK_VALIDATION, manifest: manifest(), checklist: CHECKLIST, versionHash: "ab".repeat(32), minPriceUnits: 5_000_000n, ...over });

describe("máquina de estados da revisão", () => {
  it("só pending_review aprova; pending_review e changes_requested recusam; só pending_review pede mudanças", () => {
    for (const s of SUBMISSION_STATUSES) {
      assert.equal(reviewTransitionProblem(s, "approve") === null, s === "pending_review", `approve em ${s}`);
      assert.equal(reviewTransitionProblem(s, "request_changes") === null, s === "pending_review", `request_changes em ${s}`);
      assert.equal(reviewTransitionProblem(s, "reject") === null, s === "pending_review" || s === "changes_requested", `reject em ${s}`);
    }
  });

  it("as ações do revisor nunca contornam canTransition", () => {
    const from: SubmissionStatus = "pending_review";
    assert.ok(canTransition(from, "awaiting_creator_signature"));
    assert.ok(!canTransition("rejected", "awaiting_creator_signature"));
    assert.ok(!canTransition("published", "awaiting_creator_signature"));
    assert.ok(!canTransition("awaiting_creator_signature", "pending_review"), "aprovado não volta para a revisão");
    assert.ok(canTransition("publish_failed", "awaiting_creator_signature"), "a retomada da publicação existe, mas não é uma aprovação");
    assert.ok(reviewTransitionProblem("publish_failed", "approve"));
  });

  it("o reenvio só vale em changes_requested e leva a validating", () => {
    assert.ok(canTransition("changes_requested", "validating"));
    assert.ok(!canTransition("rejected_validation", "validating"), "reprovado pelo validador não reenvia na mesma submissão");
    assert.ok(!canTransition("rejected", "validating"));
  });

  it("o passo seguinte do criador acompanha o estado", () => {
    assert.equal(nextActionFor("changes_requested", false), "fix_and_resubmit");
    assert.equal(nextActionFor("awaiting_creator_signature", true), "sign_register");
    assert.equal(nextActionFor("awaiting_creator_signature", false), "sign_update");
    assert.equal(nextActionFor("pending_review", true), "wait_review");
  });
});

describe("planApproval", () => {
  it("aprova e congela hash, preço em unidades de 6 casas, royalty, nome e versão", () => {
    const p = plan();
    assert.ok(p.ok);
    if (!p.ok) return;
    assert.deepEqual(p.approved, { versionHash: "ab".repeat(32), priceUsdc: "9000000", royaltyBps: 500, name: "Meu Solver", version: "1.0.0" });
    assert.equal(p.priceUnits, 9_000_000n);
  });

  it("recusa estado errado, validador reprovado e checklist incompleto", () => {
    assert.deepEqual([plan({ status: "published" }).ok, (plan({ status: "published" }) as { code: string }).code], [false, "invalid_state"]);
    assert.equal((plan({ validation: { ok: false, errors: [{}], warnings: [] } }) as { code: string }).code, "validation_failed");
    assert.equal((plan({ validation: null }) as { code: string }).code, "validation_failed");
    assert.equal((plan({ checklist: { ...CHECKLIST, rightsAndSources: false } }) as { code: string }).code, "checklist_incomplete");
    assert.equal((plan({ checklist: {} }) as { code: string }).code, "checklist_incomplete");
  });

  it("preço: no mínimo o min_price (5 USDC), com até 6 casas", () => {
    assert.ok(plan({ manifest: manifest({ priceUsdc: 5, royaltyBps: 0 }) }).ok, "exatamente o mínimo passa");
    assert.equal((plan({ manifest: manifest({ priceUsdc: 4.99, royaltyBps: 0 }) }) as { code: string }).code, "price_below_min");
    assert.equal((plan({ manifest: manifest({ priceUsdc: 0, royaltyBps: 0 }) }) as { code: string }).code, "price_invalid");
    assert.equal((plan({ manifest: manifest({ priceUsdc: -9, royaltyBps: 0 }) }) as { code: string }).code, "price_invalid");
    assert.equal((plan({ manifest: manifest({ priceUsdc: "9", royaltyBps: 0 }) }) as { code: string }).code, "price_invalid");
    assert.equal((plan({ manifest: manifest({ priceUsdc: 9.1234567, royaltyBps: 0 }) }) as { code: string }).code, "price_invalid", "7 casas não cabem no USDC");
    assert.equal((plan({ manifest: manifest({ priceUsdc: Number.NaN, royaltyBps: 0 }) }) as { code: string }).code, "price_invalid");
    assert.equal((plan({ minPriceUnits: 12_000_000n }) as { code: string }).code, "price_below_min", "o mínimo da cadeia vale");
  });

  it("royaltyBps: inteiro de 0 a 1000", () => {
    for (const ok of [0, 1, 1000]) assert.ok(plan({ manifest: manifest({ priceUsdc: 9, royaltyBps: ok }) }).ok, `bps ${ok}`);
    for (const bad of [-1, 1001, 5.5, "500", undefined]) {
      assert.equal((plan({ manifest: manifest({ priceUsdc: 9, royaltyBps: bad }) }) as { code: string }).code, "royalty_invalid", `bps ${String(bad)}`);
    }
  });

  it("sem manifesto não aprova", () => {
    assert.equal((plan({ manifest: null }) as { code: string }).code, "no_manifest");
  });
});

describe("priceToUnits", () => {
  it("converte valores exatos e recusa o resto", () => {
    assert.equal(priceToUnits(9), 9_000_000n);
    assert.equal(priceToUnits(0.1 + 0.2), 300_000n, "ruído de ponto flutuante não reprova");
    assert.equal(priceToUnits(9.1234567), null);
    assert.equal(priceToUnits(5.5), 5_500_000n);
    assert.equal(priceToUnits(Infinity), null);
  });
});

describe("administradores", () => {
  it("ADMIN_WALLETS separa por vírgula e ignora espaços e vazios", () => {
    assert.deepEqual([...adminWallets(" A , B,, C ")], ["A", "B", "C"]);
    assert.ok(isAdminWallet("B", "A,B"));
    assert.ok(!isAdminWallet("b", "A,B"), "diferencia maiúsculas");
    assert.ok(!isAdminWallet(undefined, "A,B"));
    assert.ok(!isAdminWallet("A", ""), "lista vazia = ninguém é admin");
  });
});

describe("convites", () => {
  it("gera códigos legíveis, únicos e sem caracteres ambíguos", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateInviteCode()));
    assert.equal(codes.size, 200);
    for (const c of codes) assert.match(c, /^SLV-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("o que o criador digita vira a chave do banco", () => {
    assert.equal(normalizeInviteCode("  slv-abcd-efgh-2345 "), "SLV-ABCD-EFGH-2345");
    assert.equal(normalizeInviteCode("slv abcd"), "SLVABCD");
  });
});

describe("limites de envio", () => {
  const limits = { maxPending: 3, maxPerDay: 5 };
  it("pendentes e envios por dia", () => {
    assert.equal(uploadLimitProblem({ pending: 2, last24h: 4 }, limits), null);
    assert.equal(uploadLimitProblem({ pending: 3, last24h: 3 }, limits)?.code, "too_many_pending");
    assert.equal(uploadLimitProblem({ pending: 0, last24h: 5 }, limits)?.code, "too_many_per_day");
  });

  it("só criador convidado, com perfil e termos, envia", () => {
    assert.ok(creatorNotReady(undefined));
    assert.ok(creatorNotReady({ invited: false, termsAcceptedAt: new Date() }));
    assert.ok(creatorNotReady({ invited: true, termsAcceptedAt: null }));
    assert.equal(creatorNotReady({ invited: true, termsAcceptedAt: new Date() }), null);
  });
});

describe("manifesto no envio", () => {
  it("o servidor sobrescreve id e creator.id e mantém o resto", () => {
    const out = normalizeManifest({ slug: "x", id: "0".repeat(32), creator: { id: "falso", name: "A", bio: "B" } }, { agentId: "a".repeat(32), creatorId: "cr_1" }) as { id: string; creator: Record<string, string>; slug: string };
    assert.equal(out.id, "a".repeat(32));
    assert.deepEqual(out.creator, { id: "cr_1", name: "A", bio: "B" });
    assert.equal(out.slug, "x");
    assert.deepEqual((normalizeManifest({}, { agentId: "a".repeat(32), creatorId: "cr_1" }) as { creator: unknown }).creator, { id: "cr_1" });
  });

  it("slug, versão e nome só entram na linha com formato seguro", () => {
    assert.deepEqual(safeManifestFields({ slug: "meu-solver", version: "1.2.3", name: "Nome" }), { slug: "meu-solver", version: "1.2.3", name: "Nome" });
    assert.deepEqual(safeManifestFields({ slug: "../../x", version: "1.0", name: "  " }), {});
    assert.deepEqual(safeManifestFields({ slug: "a".repeat(41), version: "1.0.0-beta" }), {});
    assert.deepEqual(safeManifestFields(null), {});
    assert.deepEqual(safeManifestFields([]), {});
  });

  it("caminho pedido pela tela de revisão não sai do pacote", () => {
    assert.equal(reviewPathProblem("steps/01.md"), null);
    for (const bad of ["../x", "/etc/passwd", "a\\b", "a/../b", "", undefined, "a\u0000b", "C:/x"]) assert.ok(reviewPathProblem(bad), String(bad));
  });
});

describe("visões", () => {
  const row = {
    id: "a".repeat(24),
    agentId: "b".repeat(32),
    slug: "s",
    version: "1.0.0",
    status: "changes_requested",
    manifest: { name: "Nome" },
    sizeBytes: 10,
    validation: { ok: true, errors: [], warnings: [] },
    reviewerNotes: "ajuste X",
    error: null,
    createdAt: new Date("2026-10-02T10:00:00Z"),
    updatedAt: new Date("2026-10-02T11:00:00Z"),
  };
  it("a visão do criador não tem caminhos de disco nem o manifesto", () => {
    const v = toSubmissionView({ ...row, zipPath: "C:/segredo/a.zip" } as typeof row, true);
    assert.equal(v.name, "Nome");
    assert.equal(v.nextAction, "fix_and_resubmit");
    assert.ok(!JSON.stringify(v).includes("segredo"));
    assert.ok(!("manifest" in v) && !("zipPath" in v));
  });

  it("diferenciais declarados × comprovados", () => {
    assert.deepEqual(differentiatorsOf({ differentiators: ["memory", "tool", 5] }, { stats: { differentiators: ["memory"] } }), { declared: ["memory", "tool"], proven: ["memory"] });
    assert.deepEqual(differentiatorsOf(null, null), { declared: [], proven: [] });
  });

  it("junta os avisos do extrator sem repetir", () => {
    const merged = mergeWarnings([{ code: "ZIP_IGNORED_FILE", path: "a", message: "m" }], [{ code: "ZIP_IGNORED_FILE", path: "a", message: "m", fix: "f" }, { code: "ZIP_IGNORED_FILE", path: "b", message: "m", fix: "f" }]);
    assert.deepEqual(merged.map((w) => w.path), ["a", "b"]);
  });
});

describe("textos para o criador saem em inglês", () => {
  it("quem ainda não pode enviar", () => {
    assert.match(creatorNotReady(undefined) ?? "", /^Complete your creator profile/);
    assert.match(creatorNotReady({ invited: false, termsAcceptedAt: null }) ?? "", /invited creators only/);
    assert.match(creatorNotReady({ invited: true, termsAcceptedAt: null }) ?? "", /Accept the creator terms/);
  });
  it("limites de envio e transições da revisão", () => {
    assert.match(uploadLimitProblem({ pending: 3, last24h: 0 }, { maxPending: 3, maxPerDay: 10 })?.message ?? "", /already have 3 submission/);
    assert.match(uploadLimitProblem({ pending: 0, last24h: 10 }, { maxPending: 3, maxPerDay: 10 })?.message ?? "", /Daily limit of 10/);
    assert.equal(reviewTransitionProblem("published", "approve"), `You can't approve a submission in "published".`);
    assert.equal(reviewTransitionProblem("published", "request_changes"), `You can't request changes on a submission in "published".`);
  });
});
