import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createTelegramApi, TelegramApiError, type TelegramApi, type TgUpdate } from "../src/telegram/api.js";
import {
  CHAT_MAX_FAILURES,
  createFailureLimiter,
  deepLinkOf,
  generateLinkCode,
  hashLinkCode,
  LINK_MAX_PER_WINDOW,
  LINK_TTL_MS,
  LINK_WINDOW_MS,
  linkExpiry,
  linkIsLive,
  normalizeLinkCode,
  parseCommand,
  planIssue,
  replyText,
} from "../src/telegram/link-rules.js";
import { processUpdate, runTelegramPolling, type PollDeps } from "../src/telegram/poller.js";

// Regras puras da vinculação do Telegram, o tratamento de uma atualização e o laço do bot, tudo sem rede nem banco.

const T0 = new Date("2026-10-02T12:00:00Z");
const BOT_TOKEN = "123456:SECRET-TOKEN-VALUE";

describe("código de vinculação", () => {
  it("tem o formato LINK- + 8 caracteres sem ambíguos e varia a cada chamada", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = generateLinkCode();
      assert.match(c, /^LINK-[A-HJ-NP-Z2-9]{8}$/);
      seen.add(c);
    }
    assert.ok(seen.size > 190);
    assert.equal(generateLinkCode(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7])), "LINK-ABCDEFGH");
  });

  it("normaliza o que a pessoa colou: prefixo opcional, minúsculas, espaço e hífen; recusa o resto", () => {
    for (const raw of ["LINK-ABCD2345", "link-abcd2345", "  ABCD2345 ", "LINK ABCD 2345", "link_abcd-2345", "LINKABCD2345"]) assert.equal(normalizeLinkCode(raw), "LINK-ABCD2345", raw);
    // O alfabeto não tem I: nenhum corpo de código começa com LINK, então o prefixo nunca é ambíguo.
    assert.equal(normalizeLinkCode("LINKABCD"), null);
    for (const bad of ["", "LINK-", "ABCD234", "ABCD23456", "LINK-ABCD234O", "LINK-ABCD2341", "LINK-ABCD234!", "SLV-ABCD-EFGH-JKLM"]) assert.equal(normalizeLinkCode(bad), null, bad);
  });

  it("o hash é estável, não é o código e muda com qualquer caractere", () => {
    const h = hashLinkCode("LINK-ABCD2345");
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(h, hashLinkCode("LINK-ABCD2345"));
    assert.notEqual(h, hashLinkCode("LINK-ABCD2346"));
    assert.ok(!h.includes("ABCD2345"));
  });

  it("vale 15 minutos e some no instante do vencimento", () => {
    const exp = linkExpiry(T0);
    assert.equal(exp.getTime() - T0.getTime(), 15 * 60_000);
    assert.equal(LINK_TTL_MS, 15 * 60_000);
    assert.equal(linkIsLive(exp, new Date(exp.getTime() - 1)), true);
    assert.equal(linkIsLive(exp, exp), false);
    assert.equal(linkIsLive(null, T0), false);
    assert.equal(linkIsLive(undefined, T0), false);
  });

  it("deep link do bot", () => {
    assert.equal(deepLinkOf("solvers_bot", "LINK-ABCD2345"), "https://t.me/solvers_bot?start=LINK-ABCD2345");
  });
});

describe("limite de 5 códigos por hora", () => {
  it("o primeiro abre a janela; do 1º ao 5º passam; o 6º espera o fim da janela", () => {
    let st = { windowStart: null as Date | null, count: 0 };
    for (let i = 1; i <= LINK_MAX_PER_WINDOW; i++) {
      const p = planIssue(st, new Date(T0.getTime() + i * 1000));
      assert.equal(p.ok, true, `código ${i}`);
      if (p.ok) st = { windowStart: p.windowStart, count: p.count };
    }
    assert.equal(st.count, 5);
    assert.deepEqual(st.windowStart, new Date(T0.getTime() + 1000));
    const blocked = planIssue(st, new Date(T0.getTime() + 600_000));
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.retryAfterSec, (LINK_WINDOW_MS - 599_000) / 1000);
  });

  it("depois de 1 h a janela zera", () => {
    const p = planIssue({ windowStart: T0, count: 5 }, new Date(T0.getTime() + LINK_WINDOW_MS));
    assert.deepEqual(p, { ok: true, windowStart: new Date(T0.getTime() + LINK_WINDOW_MS), count: 1 });
  });
});

describe("comandos do bot", () => {
  it("/vincular e /start com código (inclusive @bot, caixa e texto depois do código)", () => {
    assert.deepEqual(parseCommand("/vincular LINK-ABCD2345"), { kind: "link", command: "vincular", arg: "LINK-ABCD2345" });
    assert.deepEqual(parseCommand("/start LINK-ABCD2345"), { kind: "link", command: "start", arg: "LINK-ABCD2345" });
    assert.deepEqual(parseCommand("  /VINCULAR   link-abcd2345  obrigado "), { kind: "link", command: "vincular", arg: "link-abcd2345" });
    assert.deepEqual(parseCommand("/vincular@Solvers_Bot LINK-ABCD2345", "solvers_bot"), { kind: "link", command: "vincular", arg: "LINK-ABCD2345" });
  });

  it("sem código: arg vazio; comando para outro bot e texto qualquer: other", () => {
    assert.deepEqual(parseCommand("/start"), { kind: "link", command: "start", arg: "" });
    assert.deepEqual(parseCommand("/vincular"), { kind: "link", command: "vincular", arg: "" });
    assert.deepEqual(parseCommand("/vincular@outro_bot LINK-ABCD2345", "solvers_bot"), { kind: "other" });
    for (const t of ["oi", "vincular LINK-ABCD2345", "/ajuda", "/vincularx LINK-ABCD2345", "", "/start2 x"]) assert.deepEqual(parseCommand(t), { kind: "other" }, t);
  });
});

describe("respostas", () => {
  it("o texto de sucesso traz o nome; o de código ruim não revela se o código existe", () => {
    assert.equal(replyText({ kind: "linked", name: "Ana" }), "Pronto! Seu Telegram foi vinculado ao Solvers como Ana.");
    const bad = replyText({ kind: "invalid" });
    assert.match(bad, /errado, vencido ou já usado/);
    assert.match(replyText({ kind: "chat_taken" }), /outro criador/);
    assert.ok(replyText({ kind: "help" }).length < 200 && !replyText({ kind: "help" }).includes("\n"));
  });
});

describe("limitador de erros por chat", () => {
  it("bloqueia depois de 10 erros na hora, libera depois e zera no sucesso", () => {
    const lim = createFailureLimiter();
    const t = T0.getTime();
    for (let i = 0; i < CHAT_MAX_FAILURES; i++) {
      assert.equal(lim.blocked("1", t + i), false);
      lim.fail("1", t + i);
    }
    assert.equal(lim.blocked("1", t + 100), true);
    assert.equal(lim.blocked("2", t + 100), false, "outro chat não é afetado");
    assert.equal(lim.blocked("1", t + LINK_WINDOW_MS + CHAT_MAX_FAILURES), false, "passada a janela, libera");
    lim.clear("1");
    assert.equal(lim.blocked("1", t + 100), false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// processUpdate: o que o bot responde a cada atualização

type Sent = { chatId: string | number; text: string };
function fakeApi(over: Partial<TelegramApi> = {}) {
  const sent: Sent[] = [];
  const api: TelegramApi = {
    getMe: async () => ({ username: "solvers_bot" }),
    getUpdates: async () => [],
    sendMessage: async (chatId, text) => void sent.push({ chatId, text }),
    deleteWebhook: async () => undefined,
    ...over,
  };
  return { api, sent };
}
const msg = (text: string | undefined, chat: { id: number; type: string } = { id: 4242, type: "private" }, id = 1): TgUpdate => ({ update_id: id, message: { message_id: id, text, chat } });

describe("processUpdate", () => {
  const deps = (api: TelegramApi, redeem: PollDeps["redeem"]): PollDeps => ({ api, redeem, now: () => T0, botUsername: "solvers_bot", limiter: createFailureLimiter(), log: () => undefined });

  it("código certo: resgata com o chat e o código digitado e responde com o nome", async () => {
    const { api, sent } = fakeApi();
    const calls: unknown[][] = [];
    const out = await processUpdate(msg("/vincular LINK-ABCD2345"), deps(api, async (...a) => (calls.push(a), { status: "linked", name: "Ana" })));
    assert.equal(out, "replied");
    assert.deepEqual(calls, [["4242", "LINK-ABCD2345", T0]]);
    assert.deepEqual(sent, [{ chatId: "4242", text: "Pronto! Seu Telegram foi vinculado ao Solvers como Ana." }]);
  });

  it("deep link /start CODIGO funciona igual", async () => {
    const { api, sent } = fakeApi();
    await processUpdate(msg("/start LINK-ABCD2345"), deps(api, async () => ({ status: "linked", name: "Ana" })));
    assert.match(sent[0]!.text, /^Pronto!/);
  });

  it("código errado, vencido ou usado: mesma resposta curta; chat de outro criador: recusa", async () => {
    const { api, sent } = fakeApi();
    await processUpdate(msg("/vincular LINK-ZZZZ2222"), deps(api, async () => ({ status: "invalid" })));
    await processUpdate(msg("/vincular LINK-ZZZZ2222"), deps(api, async () => ({ status: "chat_taken" })));
    assert.equal(sent[0]!.text, replyText({ kind: "invalid" }));
    assert.equal(sent[1]!.text, replyText({ kind: "chat_taken" }));
  });

  it("outras mensagens: ajuda de uma linha, sem tocar no banco", async () => {
    const { api, sent } = fakeApi();
    const never: PollDeps["redeem"] = async () => assert.fail("não deveria resgatar");
    await processUpdate(msg("oi, tudo bem?"), deps(api, never));
    await processUpdate(msg("/start"), deps(api, never));
    await processUpdate(msg("/vincular"), deps(api, never));
    assert.equal(sent[0]!.text, replyText({ kind: "help" }));
    assert.equal(sent[1]!.text, replyText({ kind: "help" }));
    assert.equal(sent[2]!.text, replyText({ kind: "usage" }));
  });

  it("só chats privados com texto: grupo, canal, mensagem sem texto e update sem mensagem são ignorados", async () => {
    const { api, sent } = fakeApi();
    const never: PollDeps["redeem"] = async () => assert.fail("não deveria resgatar");
    for (const u of [msg("/vincular LINK-ABCD2345", { id: -100, type: "group" }), msg("/vincular LINK-ABCD2345", { id: -200, type: "supergroup" }), msg("/vincular LINK-ABCD2345", { id: -300, type: "channel" }), msg(undefined), { update_id: 9 }]) {
      assert.equal(await processUpdate(u, deps(api, never)), "ignored");
    }
    assert.equal(sent.length, 0);
  });

  it("comando dirigido a outro bot é tratado como mensagem comum", async () => {
    const { api, sent } = fakeApi();
    await processUpdate(msg("/vincular@outro_bot LINK-ABCD2345"), deps(api, async () => assert.fail("não deveria resgatar")));
    assert.equal(sent[0]!.text, replyText({ kind: "help" }));
  });

  it("depois de 10 códigos errados o chat para de ser conferido; um acerto zera a conta", async () => {
    const { api, sent } = fakeApi();
    let redeems = 0;
    const d = deps(api, async () => (redeems++, { status: "invalid" }));
    for (let i = 0; i < CHAT_MAX_FAILURES + 3; i++) await processUpdate(msg(`/vincular LINK-ZZZZ222${i % 8 + 2}`), d);
    assert.equal(redeems, CHAT_MAX_FAILURES);
    assert.equal(sent.at(-1)!.text, replyText({ kind: "throttled" }));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// runTelegramPolling

describe("runTelegramPolling", () => {
  const noBackoff = { timeoutSec: 1, backoffMinMs: 1, backoffMaxMs: 4 };

  it("sem cliente (sem token) fica desligado e registra uma vez", async () => {
    const logs: string[] = [];
    await runTelegramPolling(() => false, { api: null, redeem: async () => ({ status: "invalid" }), log: (m) => logs.push(m) });
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /desligado/);
  });

  it("avança o offset, trata cada atualização e para quando pedem para parar", async () => {
    let stop = false;
    const offsets: number[] = [];
    const batches: TgUpdate[][] = [[msg("/vincular LINK-ABCD2345", undefined, 10), msg("oi", undefined, 11)], []];
    const { api, sent } = fakeApi({
      getUpdates: async ({ offset }) => {
        offsets.push(offset);
        const b = batches.shift();
        if (!b) {
          stop = true;
          return [];
        }
        return b;
      },
    });
    const redeemed: string[] = [];
    await runTelegramPolling(() => stop, { api, redeem: async (_c, code) => (redeemed.push(code), { status: "linked", name: "Ana" }), log: () => undefined }, noBackoff);
    assert.deepEqual(offsets, [0, 12, 12]);
    assert.deepEqual(redeemed, ["LINK-ABCD2345"]);
    assert.equal(sent.length, 2);
  });

  it("uma atualização que falha não trava o laço nem repete: o offset avança", async () => {
    let stop = false;
    const offsets: number[] = [];
    const { api } = fakeApi({
      getUpdates: async ({ offset }) => {
        offsets.push(offset);
        if (offsets.length === 1) return [msg("/vincular LINK-ABCD2345", undefined, 5)];
        stop = true;
        return [];
      },
    });
    await runTelegramPolling(() => stop, { api, redeem: async () => Promise.reject(new Error("banco caiu")), log: () => undefined }, noBackoff);
    assert.deepEqual(offsets, [0, 6]);
  });

  it("erro de rede: backoff e nova tentativa, sem derrubar o laço", async () => {
    let stop = false;
    let calls = 0;
    const logs: string[] = [];
    const { api } = fakeApi({
      getUpdates: async () => {
        calls++;
        if (calls < 3) throw new TelegramApiError(0, "getUpdates: falha de rede");
        stop = true;
        return [];
      },
    });
    await runTelegramPolling(() => stop, { api, redeem: async () => ({ status: "invalid" }), log: (m) => logs.push(m) }, noBackoff);
    assert.equal(calls, 3);
    assert.equal(logs.filter((l) => l.includes("getUpdates falhou")).length, 2);
  });

  it("409 por webhook ativo: chama deleteWebhook UMA vez e segue; um segundo 409 só faz backoff", async () => {
    let stop = false;
    let calls = 0;
    let deletes = 0;
    const { api } = fakeApi({
      getUpdates: async () => {
        calls++;
        if (calls <= 2) throw new TelegramApiError(409, "getUpdates: Conflict: can't use getUpdates method while webhook is active");
        stop = true;
        return [];
      },
      deleteWebhook: async () => void deletes++,
    });
    await runTelegramPolling(() => stop, { api, redeem: async () => ({ status: "invalid" }), log: () => undefined }, noBackoff);
    assert.equal(deletes, 1);
    assert.equal(calls, 3);
  });

  it("409 de outro poller (sem webhook) não chama deleteWebhook", async () => {
    let stop = false;
    let calls = 0;
    let deletes = 0;
    const { api } = fakeApi({
      getUpdates: async () => {
        if (++calls === 1) throw new TelegramApiError(409, "getUpdates: Conflict: terminated by other getUpdates request");
        stop = true;
        return [];
      },
      deleteWebhook: async () => void deletes++,
    });
    await runTelegramPolling(() => stop, { api, redeem: async () => ({ status: "invalid" }), log: () => undefined }, noBackoff);
    assert.equal(deletes, 0);
  });

  it("SIGTERM durante a espera longa: aborta o getUpdates e encerra rápido", async () => {
    let stop = false;
    const { api } = fakeApi({
      getUpdates: ({ signal }) =>
        new Promise((_res, rej) => {
          signal?.addEventListener("abort", () => rej(new TelegramApiError(0, "getUpdates: interrompido", true)));
        }),
    });
    const t0 = Date.now();
    const run = runTelegramPolling(() => stop, { api, redeem: async () => ({ status: "invalid" }), log: () => undefined }, { timeoutSec: 25 });
    setTimeout(() => (stop = true), 100);
    await run;
    assert.ok(Date.now() - t0 < 2000, "não esperou os 25 s");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Cliente HTTP: o token nunca aparece em erro

describe("createTelegramApi", () => {
  const ok = (result: unknown) => async () => new Response(JSON.stringify({ ok: true, result }), { status: 200 });

  it("chama o método certo, com o corpo certo", async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)) });
      return ok(seen.length === 1 ? { username: "solvers_bot" } : [])();
    }) as unknown as typeof fetch;
    const api = createTelegramApi(BOT_TOKEN, f);
    assert.deepEqual(await api.getMe(), { username: "solvers_bot" });
    await api.getUpdates({ offset: 7, timeoutSec: 25 });
    assert.equal(seen[0]!.url, `https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    assert.deepEqual(seen[1]!.body, { offset: 7, timeout: 25, allowed_updates: ["message"] });
  });

  it("erro do Telegram vira TelegramApiError com status e descrição, sem o token", async () => {
    const f = (async () => new Response(JSON.stringify({ ok: false, description: `Unauthorized ${BOT_TOKEN}` }), { status: 401 })) as unknown as typeof fetch;
    const api = createTelegramApi(BOT_TOKEN, f);
    await assert.rejects(api.getMe(), (e: unknown) => {
      assert.ok(e instanceof TelegramApiError);
      assert.equal(e.status, 401);
      assert.ok(!e.message.includes("SECRET-TOKEN-VALUE"), e.message);
      return true;
    });
  });

  it("falha de rede também não vaza o token", async () => {
    const f = (async () => {
      throw new Error(`connect ECONNREFUSED https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    }) as unknown as typeof fetch;
    await assert.rejects(createTelegramApi(BOT_TOKEN, f).sendMessage(1, "oi"), (e: unknown) => {
      assert.ok(e instanceof TelegramApiError);
      assert.equal(e.status, 0);
      assert.ok(!e.message.includes("SECRET-TOKEN-VALUE"), e.message);
      return true;
    });
  });
});
