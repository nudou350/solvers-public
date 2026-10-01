import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { KeyError, loadSigner, parseKeyBase58, parseKeyJson } from "@solvers/chain";
import { assertNetwork, decidePauseSigner, DEVNET_GENESIS, MAINNET_GENESIS, NetworkError, networkName, PauseRuleError, slashWait } from "../src/cli/admin-guard.js";

// Barreiras do `cli:admin`: rede (genesis hash) e leitura de chave sem vazar conteúdo. Puro, sem rede.

describe("cli:admin: rede", () => {
  it("o genesis da devnet é o do upgrade-devnet.sh e passa sem aviso", () => {
    assert.equal(DEVNET_GENESIS, "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
    assert.deepEqual(assertNetwork(DEVNET_GENESIS, null), { network: "devnet", warning: null });
  });

  it("mainnet e rede desconhecida abortam por padrão (e dizem como liberar)", () => {
    assert.equal(networkName(MAINNET_GENESIS), "mainnet-beta");
    assert.throws(() => assertNetwork(MAINNET_GENESIS, null), (e) => e instanceof NetworkError && /mainnet-beta/.test(e.message) && /--allow-network mainnet-beta/.test(e.message));
    assert.throws(() => assertNetwork("11111111111111111111111111111111", null), NetworkError);
  });

  it("override só vale com o nome da rede detectada; nome errado não libera", () => {
    assert.equal(assertNetwork(MAINNET_GENESIS, "mainnet-beta").network, "mainnet-beta");
    assert.match(assertNetwork(MAINNET_GENESIS, "mainnet-beta").warning ?? "", /AVISO/);
    assert.equal(assertNetwork("abc", "desconhecida").network, "desconhecida");
    assert.throws(() => assertNetwork(MAINNET_GENESIS, "devnet"), NetworkError);
    assert.throws(() => assertNetwork("abc", "mainnet-beta"), NetworkError);
  });
});

describe("leitura de chave: nenhum erro carrega trecho do conteúdo", () => {
  const SEGREDO = "SEGREDO-da-chave-privada-1234";
  const leaks = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof KeyError, "deve ser KeyError");
      assert.doesNotMatch(String((e as Error).message), /SEGREDO|1234|Unexpected|position|JSON/i);
      return;
    }
    assert.fail("deveria lançar");
  };

  it("JSON malformado, não-array, valores fora de 0..255 e tamanho errado", () => {
    leaks(() => parseKeyJson(`{"k":"${SEGREDO}" oops`));
    leaks(() => parseKeyJson(`"${SEGREDO}"`));
    leaks(() => parseKeyJson(`[1,2,"${SEGREDO}"]`));
    leaks(() => parseKeyJson("[1,2,300]"));
    leaks(() => parseKeyJson("[1,2,3]"));
  });

  it("base58 inválido e de tamanho errado", () => {
    leaks(() => parseKeyBase58(`${SEGREDO}0OIl`));
    leaks(() => parseKeyBase58("abc"));
  });

  it("64 bytes válidos são aceitos", () => {
    assert.equal(parseKeyJson(JSON.stringify(Array.from({ length: 64 }, (_, i) => i))).length, 64);
  });

  it("arquivo que não é JSON: loadSigner lança KeyError sem o conteúdo", async () => {
    const f = join(mkdtempSync(join(tmpdir(), "key-")), "k.json");
    writeFileSync(f, `[1,2,3,${SEGREDO} garbage`);
    await assert.rejects(loadSigner(f), (e) => e instanceof KeyError && !/SEGREDO|garbage|Unexpected|position/i.test(e.message));
  });
});

describe("decidePauseSigner (espelha set_pause do programa)", () => {
  const admin = "AdminAdminAdminAdminAdminAdminAdminAdminAdmi";
  const guardian = "GuardGuardGuardGuardGuardGuardGuardGuardGuar";
  const base = { admin, guardian, keyAddress: admin as string | null };

  it("admin liga, desliga e muda qualquer combinação", () => {
    assert.deepEqual(decidePauseSigner({ ...base, current: 0, next: 3 }), { role: "admin", unpausing: false });
    assert.deepEqual(decidePauseSigner({ ...base, current: 3, next: 0 }), { role: "admin", unpausing: true });
    assert.deepEqual(decidePauseSigner({ ...base, current: 1, next: 2 }), { role: "admin", unpausing: true });
  });

  it("guardian só acrescenta bits: ligar passa, soltar qualquer bit é recusado", () => {
    const g = { ...base, keyAddress: guardian };
    assert.deepEqual(decidePauseSigner({ ...g, current: 0, next: 1 }), { role: "guardian", unpausing: false });
    assert.deepEqual(decidePauseSigner({ ...g, current: 1, next: 3 }), { role: "guardian", unpausing: false });
    assert.throws(() => decidePauseSigner({ ...g, current: 3, next: 1 }), PauseRuleError);
    assert.throws(() => decidePauseSigner({ ...g, current: 1, next: 2 }), PauseRuleError);
    assert.throws(() => decidePauseSigner({ ...g, current: 1, next: 0 }), PauseRuleError);
  });

  it("chave que não é admin nem guardian é recusada (mesmo sem guardian definido)", () => {
    assert.throws(() => decidePauseSigner({ ...base, keyAddress: "OutraOutraOutraOutraOutraOutraOutraOutraOutr", current: 0, next: 1 }), PauseRuleError);
    assert.throws(() => decidePauseSigner({ ...base, guardian: null, keyAddress: guardian, current: 0, next: 1 }), PauseRuleError);
  });

  it("sem chave neste computador: planeja como admin (dry-run); valor igual ao atual não faz nada", () => {
    assert.deepEqual(decidePauseSigner({ ...base, keyAddress: null, current: 0, next: 3 }), { role: "admin", unpausing: false });
    assert.throws(() => decidePauseSigner({ ...base, current: 3, next: 3 }), PauseRuleError);
  });
});

describe("slashWait (72 h do confisco)", () => {
  const T = 1_700_000_000;
  it("antes do prazo: quanto falta, em dias, horas e minutos", () => {
    assert.deepEqual(slashWait(T, T), { remainingSecs: 259_200, executableAt: T + 259_200, expiresAt: T + 259_200 + 14 * 86_400, expired: false, text: "faltam 3 d" });
    assert.equal(slashWait(T, T + 2 * 86_400 + 3600 * 5 + 60 * 20).text, "faltam 18 h 40 min");
    assert.equal(slashWait(T, T + 259_200 - 30).text, "faltam 1 min");
    assert.equal(slashWait(T, T + 259_200 - 3600).text, "faltam 1 h");
  });
  it("no instante exato e depois: já passou (o programa usa now >= proposed_at + 72 h)", () => {
    assert.equal(slashWait(T, T + 259_200).remainingSecs, 0);
    assert.equal(slashWait(BigInt(T), T + 999_999).text, "a espera de 72 h já terminou");
  });
  it("janela de execução: vale até proposed_at + 72 h + 14 dias (o programa usa now <= esse instante); depois, vencida", () => {
    const end = T + 259_200 + 14 * 86_400;
    assert.equal(slashWait(T, end).expired, false);
    assert.equal(slashWait(T, end + 1).expired, true);
    assert.match(slashWait(T, end + 1).text, /VENCEU/);
  });
});
