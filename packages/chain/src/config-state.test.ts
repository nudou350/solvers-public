import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { address, getAddressEncoder } from "@solana/kit";
import * as gen from "@solvers/client";
import {
  CONFIG_V1_SIZE,
  CONFIG_V2_SIZE,
  PAUSE_ENTRIES,
  PAUSE_PAYMENTS,
  classifyConfigData,
  describePauseFlags,
  parseProgramDataAuthority,
  pauseDecision,
} from "./config-state.js";

// Estado da Config sem rede: v1 (187 B, devnet antes de migrate_config) não pode derrubar quem lê a pausa.

const A = address("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const SYS = address("11111111111111111111111111111111");

function v2(pauseFlags: number, guardian = SYS): Uint8Array {
  return Uint8Array.from(
    gen.getConfigEncoder().encode({
      admin: A,
      verifier: A,
      usageAuthority: A,
      treasury: A,
      usdcMint: A,
      feeBps: 1000,
      minStake: 0n,
      minPrice: 1n,
      bump: 255,
      layoutVersion: 2,
      pauseFlags,
      guardian,
      reserved: new Uint8Array(64),
    }),
  );
}

describe("classifyConfigData", () => {
  it("o tamanho do layout v2 bate com o cliente gerado (285) e o v1 é 187", () => {
    assert.equal(gen.getConfigSize(), CONFIG_V2_SIZE);
    assert.equal(CONFIG_V2_SIZE, 285);
    assert.equal(CONFIG_V1_SIZE, 187);
    assert.equal(v2(0).length, CONFIG_V2_SIZE);
  });

  it("v2: decodifica pause_flags e guardian", () => {
    const st = classifyConfigData(v2(3, A));
    assert.equal(st.kind, "v2");
    if (st.kind !== "v2") return;
    assert.equal(st.config.pauseFlags, 3);
    assert.equal(st.config.guardian, A);
  });

  it("v1 (187 bytes com o discriminador de Config) vira estado explícito, sem exceção de codec", () => {
    const v1 = v2(0).slice(0, CONFIG_V1_SIZE);
    assert.deepEqual(classifyConfigData(v1), { kind: "v1" });
  });

  it("conta ausente, tamanho estranho ou discriminador de outra conta", () => {
    assert.deepEqual(classifyConfigData(null), { kind: "missing" });
    assert.deepEqual(classifyConfigData(v2(0).slice(0, 200)), { kind: "unknown", size: 200 });
    assert.deepEqual(classifyConfigData(new Uint8Array(CONFIG_V2_SIZE)), { kind: "unknown", size: CONFIG_V2_SIZE });
    assert.deepEqual(classifyConfigData(new Uint8Array(3)), { kind: "unknown", size: 3 });
  });
});

describe("pauseDecision / describePauseFlags", () => {
  it("só o bit consultado pausa; sem v2 legível é 'unknown' (o servidor segue: fail-open)", () => {
    assert.equal(pauseDecision(classifyConfigData(v2(0)), PAUSE_ENTRIES), "open");
    assert.equal(pauseDecision(classifyConfigData(v2(PAUSE_ENTRIES)), PAUSE_ENTRIES), "paused");
    assert.equal(pauseDecision(classifyConfigData(v2(PAUSE_ENTRIES)), PAUSE_PAYMENTS), "open");
    assert.equal(pauseDecision(classifyConfigData(v2(PAUSE_PAYMENTS)), PAUSE_ENTRIES), "open");
    assert.equal(pauseDecision(classifyConfigData(v2(3)), PAUSE_PAYMENTS), "paused");
    for (const st of [null, { kind: "missing" }, { kind: "v1" }, { kind: "unknown", size: 1 }] as const) {
      assert.equal(pauseDecision(st, PAUSE_ENTRIES), "unknown");
    }
  });

  it("descreve os bits em português", () => {
    assert.equal(describePauseFlags(0), "nenhuma");
    assert.equal(describePauseFlags(1), "entradas");
    assert.equal(describePauseFlags(2), "pagamentos");
    assert.equal(describePauseFlags(3), "entradas, pagamentos");
    assert.equal(describePauseFlags(4), "bits inválidos: 4");
  });
});

describe("parseProgramDataAuthority", () => {
  const build = (tag: number, key?: Uint8Array) => {
    const d = new Uint8Array(45 + 100);
    d[0] = 3; // variante ProgramData
    d[12] = tag;
    if (key) d.set(key, 13);
    return d;
  };

  it("lê a upgrade authority; tag 0 = programa imutável", () => {
    const key = Uint8Array.from(getAddressEncoder().encode(A));
    assert.deepEqual(parseProgramDataAuthority(build(1, key)), { authority: A });
    assert.deepEqual(parseProgramDataAuthority(build(0)), { authority: null });
  });

  it("dados que não são ProgramData (variante errada, curtos, tag inválida) viram null", () => {
    const bad = build(1, new Uint8Array(32));
    bad[0] = 2;
    assert.equal(parseProgramDataAuthority(bad), null);
    assert.equal(parseProgramDataAuthority(new Uint8Array(10)), null);
    assert.equal(parseProgramDataAuthority(build(7)), null);
    assert.equal(parseProgramDataAuthority(build(1, new Uint8Array(32)).slice(0, 30)), null);
  });
});
