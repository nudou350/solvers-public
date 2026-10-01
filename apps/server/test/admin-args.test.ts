import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { parseAdminArgs, parsePauseFlags, parseUsdcAmount, reasonHashOf, UsageError } from "../src/cli/admin-args.js";

// Montagem dos argumentos de `cli:admin`: pura, sem rede nem chaves.

const ADDR = "EA2Nz3yBuF28hHC4xYBnSR4B3bJVWuDUt3VSsCV9KoGr";

describe("cli:admin: argumentos", () => {
  it("dry-run é o padrão; --yes e --keypair são lidos em qualquer posição", () => {
    assert.deepEqual(parseAdminArgs(["propose", ADDR]), { command: { cmd: "propose", newAdmin: ADDR }, yes: false, keypair: null, allowNetwork: null });
    assert.deepEqual(parseAdminArgs(["--yes", "accept", "--keypair", "novo-admin.json"]), { command: { cmd: "accept" }, yes: true, keypair: "novo-admin.json", allowNetwork: null });
    assert.deepEqual(parseAdminArgs(["cancel"]).command, { cmd: "cancel" });
    assert.deepEqual(parseAdminArgs(["set-treasury", ADDR, "--yes"]), { command: { cmd: "set-treasury", treasury: ADDR }, yes: true, keypair: null, allowNetwork: null });
  });

  it("--allow-network é opt-in e lido como texto", () => {
    assert.equal(parseAdminArgs(["cancel"]).allowNetwork, null);
    assert.equal(parseAdminArgs(["cancel", "--allow-network", "mainnet-beta", "--yes"]).allowNetwork, "mainnet-beta");
  });

  it("top-up-stake converte USDC em unidades de 6 casas", () => {
    assert.deepEqual(parseAdminArgs(["top-up-stake", "frontend-react", "12.5"]).command, { cmd: "top-up-stake", slug: "frontend-react", amount: 12_500_000n });
    assert.equal(parseUsdcAmount("5"), 5_000_000n);
    assert.equal(parseUsdcAmount("0,000001"), 1n);
    assert.equal(parseUsdcAmount("0.1"), 100_000n);
  });

  it("valores inválidos de USDC são recusados (zero, negativo, 7 casas, texto)", () => {
    for (const v of ["0", "0.0", "-1", "1.1234567", "abc", "", "1e6", "1."]) assert.throws(() => parseUsdcAmount(v), UsageError, v);
  });

  it("recusa comando desconhecido, endereço inválido, argumento a mais e opção desconhecida", () => {
    assert.throws(() => parseAdminArgs([]), UsageError);
    assert.throws(() => parseAdminArgs(["destroy"]), UsageError);
    assert.throws(() => parseAdminArgs(["propose"]), UsageError);
    assert.throws(() => parseAdminArgs(["propose", "não-é-endereço"]), UsageError);
    assert.throws(() => parseAdminArgs(["propose", ADDR, ADDR]), UsageError);
    assert.throws(() => parseAdminArgs(["accept", ADDR]), UsageError);
    assert.throws(() => parseAdminArgs(["top-up-stake", "x"]), UsageError);
    assert.throws(() => parseAdminArgs(["cancel", "--force"]), UsageError);
    assert.throws(() => parseAdminArgs(["accept", "--keypair"]), UsageError);
    assert.throws(() => parseAdminArgs(["cancel", "--allow-network"]), UsageError);
  });

  it("migrate-config: sem argumentos; dry-run por padrão; --keypair é a upgrade authority", () => {
    assert.deepEqual(parseAdminArgs(["migrate-config"]), { command: { cmd: "migrate-config" }, yes: false, keypair: null, allowNetwork: null });
    assert.deepEqual(parseAdminArgs(["migrate-config", "--keypair", "admin.json", "--yes"]), { command: { cmd: "migrate-config" }, yes: true, keypair: "admin.json", allowNetwork: null });
    assert.throws(() => parseAdminArgs(["migrate-config", ADDR]), UsageError);
  });

  it("set-pause: none/entradas/pagamentos/tudo ou número de 0 a 3; nada fora da máscara", () => {
    assert.equal(parsePauseFlags("none"), 0);
    assert.equal(parsePauseFlags("entradas"), 1);
    assert.equal(parsePauseFlags("PAGAMENTOS"), 2);
    assert.equal(parsePauseFlags("tudo"), 3);
    assert.equal(parsePauseFlags("0"), 0);
    assert.equal(parsePauseFlags("3"), 3);
    for (const v of ["4", "255", "-1", "1.5", "pausar", "", "0x1"]) assert.throws(() => parsePauseFlags(v), UsageError, v);
    assert.throws(() => parsePauseFlags(undefined), UsageError);
    assert.deepEqual(parseAdminArgs(["set-pause", "tudo", "--keypair", "guardian.json"]), { command: { cmd: "set-pause", flags: 3 }, yes: false, keypair: "guardian.json", allowNetwork: null });
    assert.throws(() => parseAdminArgs(["set-pause"]), UsageError);
    assert.throws(() => parseAdminArgs(["set-pause", "tudo", "none"]), UsageError);
    assert.throws(() => parseAdminArgs(["set-pause", "7"]), UsageError);
  });

  it("set-guardian: endereço válido ou none (remove); recusa lixo", () => {
    assert.deepEqual(parseAdminArgs(["set-guardian", ADDR, "--yes"]), { command: { cmd: "set-guardian", guardian: ADDR }, yes: true, keypair: null, allowNetwork: null });
    assert.deepEqual(parseAdminArgs(["set-guardian", "none"]).command, { cmd: "set-guardian", guardian: null });
    assert.deepEqual(parseAdminArgs(["set-guardian", "NONE"]).command, { cmd: "set-guardian", guardian: null });
    assert.throws(() => parseAdminArgs(["set-guardian"]), UsageError);
    assert.throws(() => parseAdminArgs(["set-guardian", "não-é-endereço"]), UsageError);
    assert.throws(() => parseAdminArgs(["set-guardian", ADDR, ADDR]), UsageError);
  });

  it("propose-slash: slug, USDC e motivo; o reason_hash é o sha256 do motivo (sem espaços nas pontas)", () => {
    const a = parseAdminArgs(["propose-slash", "frontend-react", "2.5", "  Entrega falsa no caso 123  ", "--yes"]);
    assert.deepEqual(a.command, { cmd: "propose-slash", slug: "frontend-react", amount: 2_500_000n, reason: "Entrega falsa no caso 123" });
    assert.equal(a.yes, true);
    assert.equal(Buffer.from(reasonHashOf("Entrega falsa no caso 123")).toString("hex"), createHash("sha256").update("Entrega falsa no caso 123").digest("hex"));
    assert.equal(reasonHashOf("  x ").length, 32);
    assert.deepEqual(reasonHashOf(" x "), reasonHashOf("x"));
    assert.throws(() => reasonHashOf("   "), UsageError);
    assert.throws(() => parseAdminArgs(["propose-slash", "x", "1"]), UsageError);
    assert.throws(() => parseAdminArgs(["propose-slash", "x", "0", "motivo"]), UsageError);
    assert.throws(() => parseAdminArgs(["propose-slash", "x", "1", "  "]), UsageError);
    assert.throws(() => parseAdminArgs(["propose-slash", "x", "1", "m", "extra"]), UsageError);
  });

  it("execute-slash, cancel-slash e extend-stake-exit", () => {
    assert.deepEqual(parseAdminArgs(["execute-slash", "frontend-react"]).command, { cmd: "execute-slash", slug: "frontend-react" });
    assert.deepEqual(parseAdminArgs(["cancel-slash", "frontend-react", "--yes"]).command, { cmd: "cancel-slash", slug: "frontend-react" });
    assert.deepEqual(parseAdminArgs(["extend-stake-exit", "frontend-react", "disputa aberta"]).command, { cmd: "extend-stake-exit", slug: "frontend-react", reason: "disputa aberta" });
    assert.throws(() => parseAdminArgs(["execute-slash"]), UsageError);
    assert.throws(() => parseAdminArgs(["cancel-slash", "a", "b"]), UsageError);
    assert.throws(() => parseAdminArgs(["extend-stake-exit", "a"]), UsageError);
  });
});
