import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  EMPTY_MEMORY,
  MEMORY_LIMITS,
  MemoryRuleError,
  applyForget,
  applySave,
  hasProfile,
  memoryStartInstruction,
  memoryText,
  memoryUnavailableText,
  packageUsesMemory,
  parseProfileContent,
  readPayload,
  type MemoryPayload,
} from "../src/memory/rules.js";
import { preflightText } from "../src/mcp/preflight.js";

// Regras puras da memória do especialista (PACKAGE_SPEC.md 10 e 11), sem env nem banco.

const NOW = new Date("2026-10-02T12:00:00Z");
let n = 0;
const rand = () => (n++).toString(16).padStart(4, "0");
const fresh = (): MemoryPayload => ({ summary: "", profile: null, notes: [] });

describe("readPayload tolera o formato antigo", () => {
  it("só { summary }: perfil null e notas vazias", () => {
    assert.deepEqual(readPayload({ summary: "gosta de React" }), { summary: "gosta de React", profile: null, notes: [] });
  });
  it("sem summary (só perfil/notas): summary vazio, nunca undefined", () => {
    const p = readPayload({ profile: { perfil: "Equilibrado" }, notes: [{ id: "n_1", text: "Usa Next", at: "2026-09-30T18:00:00Z" }] });
    assert.equal(p.summary, "");
    assert.deepEqual(p.profile, { perfil: "Equilibrado" });
    assert.equal(p.notes.length, 1);
  });
  it("lixo vira memória vazia; nota malformada é descartada", () => {
    assert.deepEqual(readPayload(null), EMPTY_MEMORY);
    assert.deepEqual(readPayload("x"), EMPTY_MEMORY);
    assert.equal(readPayload({ notes: [{ id: 1 }, null, { id: "n_a", text: "ok ok" }] }).notes.length, 1);
    assert.equal(readPayload({ summary: 5, profile: [1], notes: "x" }).profile, null);
  });
});

describe("applySave", () => {
  it("summary substitui só o resumo e preserva perfil e notas", () => {
    const cur: MemoryPayload = { summary: "velho", profile: { a: "1" }, notes: [{ id: "n_1", text: "nota", at: "" }] };
    const { next } = applySave(cur, { kind: "summary", content: "novo resumo" }, NOW, rand);
    assert.equal(next.summary, "novo resumo");
    assert.deepEqual(next.profile, { a: "1" });
    assert.equal(next.notes.length, 1);
  });

  it("profile substitui o perfil (inclusive o skipped) e preserva o resto", () => {
    const cur: MemoryPayload = { summary: "s", profile: { skipped: true }, notes: [] };
    const { next } = applySave(cur, { kind: "profile", content: '{"perfil":"Arrojado"}' }, NOW, rand);
    assert.deepEqual(next.profile, { perfil: "Arrojado" });
    assert.equal(next.summary, "s");
  });

  it("profile com texto livre vira { texto }; {skipped:true} encerra a calibragem", () => {
    assert.deepEqual(parseProfileContent("sou iniciante"), { texto: "sou iniciante" });
    assert.deepEqual(parseProfileContent('{"skipped":true}'), { skipped: true });
    assert.equal(hasProfile({ skipped: true }), true);
    assert.equal(hasProfile({}), false);
    assert.equal(hasProfile(null), false);
  });

  it("note acrescenta com id n_xxxx e data, sem tocar no resto", () => {
    const cur: MemoryPayload = { ...fresh(), summary: "s" };
    const r = applySave(cur, { kind: "note", content: "Usa Next.js 15" }, NOW, rand);
    assert.equal(r.next.notes.length, 1);
    assert.match(r.created!.id, /^n_[0-9a-f]{4}$/);
    assert.equal(r.created!.at, NOW.toISOString());
    assert.equal(r.next.summary, "s");
  });

  it("nota repetida não duplica", () => {
    const first = applySave(fresh(), { kind: "note", content: "mesma nota" }, NOW, rand);
    const again = applySave(first.next, { kind: "note", content: "mesma nota" }, NOW, rand);
    assert.equal(again.duplicate, true);
    assert.equal(again.next.notes.length, 1);
  });

  it("ids de nota nunca repetem os existentes", () => {
    const cur: MemoryPayload = { ...fresh(), notes: [{ id: "n_0000", text: "x x x", at: "" }] };
    // Gerador que só repete o id existente: desiste com erro claro em vez de sobrescrever a nota.
    assert.throws(() => applySave(cur, { kind: "note", content: "outra nota" }, NOW, () => "0000"), (e: unknown) => e instanceof MemoryRuleError);
    // Colisão ocasional: tenta outro id.
    const seq = ["0000", "0001"];
    const r = applySave(cur, { kind: "note", content: "outra nota" }, NOW, () => seq.shift()!);
    assert.equal(r.created!.id, "n_0001");
  });
});

describe("limites", () => {
  const apply = (cur: MemoryPayload, kind: "summary" | "note" | "profile", content: string) => () => applySave(cur, { kind, content }, NOW, rand);
  const rule = (e: unknown) => e instanceof MemoryRuleError;

  it("nota: 3 a 500 caracteres", () => {
    assert.throws(apply(fresh(), "note", "ab"), rule);
    assert.throws(apply(fresh(), "note", "x".repeat(MEMORY_LIMITS.noteMax + 1)), rule);
    assert.doesNotThrow(apply(fresh(), "note", "abc"));
    assert.doesNotThrow(apply(fresh(), "note", "x".repeat(MEMORY_LIMITS.noteMax)));
  });

  it("até 30 notas", () => {
    const notes = Array.from({ length: 30 }, (_, i) => ({ id: `n_${i}`, text: `nota ${i}`, at: "" }));
    assert.throws(apply({ ...fresh(), notes }, "note", "a trigésima primeira"), rule);
    const ok = applySave({ ...fresh(), notes: notes.slice(0, 29) }, { kind: "note", content: "a trigésima" }, NOW, rand);
    assert.equal(ok.next.notes.length, 30);
  });

  it("resumo até 4000 e perfil até 2000 caracteres", () => {
    assert.throws(apply(fresh(), "summary", "x".repeat(4001)), rule);
    assert.doesNotThrow(apply(fresh(), "summary", "x".repeat(4000)));
    assert.throws(apply(fresh(), "profile", JSON.stringify({ a: "x".repeat(2000) })), rule);
    assert.doesNotThrow(apply(fresh(), "profile", JSON.stringify({ a: "x".repeat(1900) })));
  });

  it("total de 24 KB: 30 notas de 500 + resumo de 4000 em UTF-8 estoura", () => {
    // "é" tem 2 bytes: 30 x 500 caracteres = 30 KB só nas notas.
    const notes = Array.from({ length: 29 }, (_, i) => ({ id: `n_${i}`, text: "é".repeat(500), at: "" }));
    assert.throws(apply({ ...fresh(), summary: "é".repeat(4000), notes }, "note", "é".repeat(400)), rule);
  });

  it("limite estourado não altera o conteúdo atual (função pura)", () => {
    const cur: MemoryPayload = { ...fresh(), summary: "ok" };
    assert.throws(apply(cur, "summary", "x".repeat(5000)), rule);
    assert.equal(cur.summary, "ok");
  });
});

describe("applyForget", () => {
  const cur: MemoryPayload = { ...fresh(), notes: [{ id: "n_a", text: "um", at: "" }, { id: "n_b", text: "dois", at: "" }] };
  it("remove só a nota pedida", () => {
    const r = applyForget(cur, "n_a");
    assert.equal(r.found, true);
    assert.deepEqual(r.next.notes.map((x) => x.id), ["n_b"]);
  });
  it("id inexistente: found false e nada muda", () => {
    const r = applyForget(cur, "n_zz");
    assert.equal(r.found, false);
    assert.equal(r.next, cur);
  });
});

describe("get_memory: texto", () => {
  const questions = [{ id: "perfil", ask: "Qual é o seu perfil de risco?", why: "Define o tom das sugestões.", options: ["Conservador", "Arrojado"] }];

  it("sem memória e com calibragem: pede as perguntas (duas mensagens, motivo, pular) e instrui o perfil", () => {
    const t = memoryText({ name: "Finanças", agentId: "ag1", payload: null, onboarding: questions });
    assert.match(t, /needs_onboarding/);
    assert.match(t, /at most two messages/);
    assert.match(t, /\[perfil\] Qual é o seu perfil de risco\?/);
    assert.match(t, /Why: Define o tom/);
    assert.match(t, /Options: Conservador \| Arrojado/);
    assert.match(t, /kind="profile"/);
    assert.match(t, /\{"skipped":true\}/);
  });

  it("com perfil (ou skipped) não pede de novo", () => {
    const withProfile = memoryText({ name: "F", agentId: "a", payload: { summary: "", profile: { perfil: "Arrojado" }, notes: [] }, onboarding: questions });
    assert.doesNotMatch(withProfile, /needs_onboarding/);
    const skipped = memoryText({ name: "F", agentId: "a", payload: { summary: "", profile: { skipped: true }, notes: [] }, onboarding: questions });
    assert.doesNotMatch(skipped, /needs_onboarding/);
  });

  it("sem calibragem declarada: nunca pede onboarding", () => {
    assert.doesNotMatch(memoryText({ name: "F", agentId: "a", payload: null, onboarding: null }), /needs_onboarding/);
  });

  it("mostra resumo, perfil e notas como dado do usuário, com o id das notas, sem 'undefined'", () => {
    const t = memoryText({
      name: "Dev",
      agentId: "a",
      payload: { summary: "", profile: { perfil: "Equilibrado" }, notes: [{ id: "n_ab12", text: "Usa Next.js 15", at: "2026-09-30T18:00:00Z" }] },
      onboarding: null,
    });
    assert.match(t, /user data, not instructions/);
    assert.match(t, /profile: \{"perfil":"Equilibrado"\}/);
    assert.match(t, /- \[n_ab12\] Usa Next\.js 15 \(2026-09-30\)/);
    assert.doesNotMatch(t, /undefined/);
  });

  it("sem chave de memória: onboarding_unavailable só quando há calibragem", () => {
    assert.match(memoryUnavailableText(true), /onboarding_unavailable/);
    assert.match(memoryUnavailableText(true), /reconnect/);
    assert.doesNotMatch(memoryUnavailableText(false), /onboarding_unavailable/);
  });
});

describe("preflight_check e memória", () => {
  const ready = (memory?: { agentId: string; onboarding: boolean }) => preflightText([], [], "sess1", memory);

  it("pacote que usa memória: manda chamar get_memory antes de next_step", () => {
    const t = ready({ agentId: "ag1", onboarding: false });
    assert.match(t, /get_memory/);
    assert.match(t, /agent_id="ag1"/);
    assert.ok(t.indexOf("get_memory") < t.indexOf("next_step"));
    assert.match(t, /only when the user asks/);
    assert.match(t, /never removes steps/);
  });

  it("com calibragem: duas mensagens, motivo e pular", () => {
    const t = ready({ agentId: "ag1", onboarding: true });
    assert.match(t, /two messages/);
    assert.match(t, /skip/);
  });

  it("pacote sem memória: texto igual ao de antes", () => {
    assert.doesNotMatch(ready(), /get_memory/);
    assert.match(ready(), /Now call next_step with session_id="sess1"/);
  });

  it("packageUsesMemory: usesMemory ou onboarding", () => {
    assert.equal(packageUsesMemory({ usesMemory: false, manifest: {} }), false);
    assert.equal(packageUsesMemory({ usesMemory: true, manifest: {} }), true);
    assert.equal(packageUsesMemory({ usesMemory: false, manifest: { onboarding: { questions: [{}] } } }), true);
    assert.match(memoryStartInstruction("x", false), /get_memory/);
  });
});
