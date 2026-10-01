import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { KeyError, loadSigner, parseKeyBase58, parseKeyJson } from "@solvers/chain";
import { assertNetwork, DEVNET_GENESIS, MAINNET_GENESIS, NetworkError, networkName } from "../src/cli/admin-guard.js";

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
