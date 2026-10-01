import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { PAUSE_ENTRIES, PAUSE_PAYMENTS, type ConfigState } from "@solvers/chain";
import { HttpError } from "../src/lib/http.js";
import { assertNotPaused, createConfigStateReader, PAUSED_MESSAGE } from "../src/store/pause-rules.js";

// Pausa de emergência no servidor: decisão pura + cache curto, sem rede. Config ilegível nunca bloqueia (fail-open).

const v2 = (pauseFlags: number): ConfigState => ({ kind: "v2", config: { pauseFlags } as never });

const run = (state: ConfigState | null, bit = PAUSE_ENTRIES) => {
  const logs: string[] = [];
  let thrown: unknown = null;
  try {
    assertNotPaused(state, bit, "purchase", (m) => logs.push(m));
  } catch (e) {
    thrown = e;
  }
  return { thrown, logs };
};

describe("assertNotPaused", () => {
  it("bit de entradas ligado: 503 platform_paused com a mensagem em português", () => {
    const { thrown } = run(v2(PAUSE_ENTRIES));
    assert.ok(thrown instanceof HttpError);
    assert.equal(thrown.status, 503);
    assert.equal(thrown.code, "platform_paused");
    assert.equal(thrown.message, "Compras pausadas temporariamente");
    assert.equal(PAUSED_MESSAGE, "Compras pausadas temporariamente");
  });

  it("pausa de pagamentos sozinha não bloqueia compras; liberada segue sem log", () => {
    assert.deepEqual(run(v2(PAUSE_PAYMENTS)), { thrown: null, logs: [] });
    assert.deepEqual(run(v2(0)), { thrown: null, logs: [] });
  });

  it("fail-open: leitura falhou, Config v1 não migrada, ausente ou de tamanho desconhecido seguem e vão para o log", () => {
    for (const st of [null, { kind: "v1" }, { kind: "missing" }, { kind: "unknown", size: 9 }] as const) {
      const { thrown, logs } = run(st);
      assert.equal(thrown, null);
      assert.equal(logs.length, 1);
      assert.match(logs[0]!, /purchase.*indisponível/);
    }
  });
});

describe("createConfigStateReader", () => {
  const setup = (results: Array<ConfigState | Error>) => {
    let t = 0;
    let calls = 0;
    const logs: string[] = [];
    const reader = createConfigStateReader({
      fetch: async () => {
        const r = results[Math.min(calls++, results.length - 1)]!;
        if (r instanceof Error) throw r;
        return r;
      },
      ttlMs: 10_000,
      failTtlMs: 2_000,
      now: () => t,
      log: (m) => logs.push(m),
    });
    return { reader, logs, calls: () => calls, advance: (ms: number) => (t += ms) };
  };

  it("lê uma vez por janela de 10 s e pedidos simultâneos compartilham a leitura", async () => {
    const s = setup([v2(0), v2(1)]);
    const [a, b] = await Promise.all([s.reader.read(), s.reader.read()]);
    assert.equal(s.calls(), 1);
    assert.equal(a, b);
    s.advance(9_999);
    assert.equal((await s.reader.read() as { kind: "v2"; config: { pauseFlags: number } }).config.pauseFlags, 0);
    assert.equal(s.calls(), 1);
    s.advance(1);
    assert.equal((await s.reader.read() as { kind: "v2"; config: { pauseFlags: number } }).config.pauseFlags, 1);
    assert.equal(s.calls(), 2);
  });

  it("falha de leitura devolve null (fail-open), registra e só vale 2 s", async () => {
    const s = setup([new Error("fetch failed"), v2(1)]);
    assert.equal(await s.reader.read(), null);
    assert.match(s.logs[0]!, /fetch failed/);
    s.advance(1_999);
    assert.equal(await s.reader.read(), null);
    assert.equal(s.calls(), 1);
    s.advance(1);
    assert.equal((await s.reader.read())?.kind, "v2");
    assert.equal(s.calls(), 2);
  });

  it("invalidate() (indexador viu PauseChanged) força nova leitura e descarta leitura em andamento", async () => {
    const s = setup([v2(0), v2(1)]);
    await s.reader.read();
    s.reader.invalidate();
    assert.equal(((await s.reader.read()) as { config: { pauseFlags: number } }).config.pauseFlags, 1);
    assert.equal(s.calls(), 2);
  });
});
