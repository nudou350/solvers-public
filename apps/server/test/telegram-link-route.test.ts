import "./helpers/fake-env.js";
import { strict as assert } from "node:assert";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { signSession, SESSION_COOKIE } from "../src/auth/jwt.js";
import { createApp } from "../src/app.js";
import { creatorRouter } from "../src/creator/routes.js";
import { TelegramApiError, type TelegramApi } from "../src/telegram/api.js";
import { setTelegramApiForTests } from "../src/telegram/client.js";

// POST /api/creator/telegram-link nos casos que não precisam de banco (o bot é conferido antes de qualquer consulta):
// sem login e bot não configurado ou fora do ar. Os casos com banco estão em telegram-link.db.test.ts.

describe("POST /api/creator/telegram-link sem banco", () => {
  let server: Server;
  let base = "";
  const post = async (wallet: string | null) =>
    fetch(`${base}/api/creator/telegram-link`, { method: "POST", headers: wallet ? { cookie: `${SESSION_COOKIE}=${await signSession(wallet)}` } : {} });

  before(async () => {
    await new Promise<void>((resolve) => {
      server = createApp([(app) => app.use("/api", creatorRouter)]).listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  after(() => {
    server.close();
    setTelegramApiForTests(undefined);
  });

  it("sem login: 401", async () => {
    setTelegramApiForTests(null);
    assert.equal((await post(null)).status, 401);
  });

  it("bot não configurado (sem TELEGRAM_BOT_TOKEN): 503 telegram_unavailable com mensagem clara", async () => {
    setTelegramApiForTests(null);
    const res = await post("rota-sem-bot");
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code: string; error: string };
    assert.equal(body.code, "telegram_unavailable");
    assert.match(body.error, /unavailable/);
  });

  it("getMe falhando (Telegram fora do ar): 503, e a falha não vaza o motivo nem o token", async () => {
    const api: TelegramApi = {
      getMe: async () => Promise.reject(new TelegramApiError(0, "getMe: falha de rede")),
      getUpdates: async () => [],
      sendMessage: async () => undefined,
      deleteWebhook: async () => undefined,
    };
    setTelegramApiForTests(api);
    const res = await post("rota-getme-falha");
    assert.equal(res.status, 503);
    const text = JSON.stringify(await res.json());
    assert.match(text, /telegram_unavailable/);
    assert.ok(!text.includes("falha de rede"));
  });
});
