import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseAdminArgs, parseUsdcAmount, UsageError } from "../src/cli/admin-args.js";

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
});
