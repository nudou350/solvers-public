import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { refreshRejection } from "../src/oauth/rules.js";
import { authorizePage, pageLang } from "../src/oauth/page.js";

// Rotação do refresh: tudo é validado antes de revogar (sem env ou banco).

const now = new Date("2026-01-10T00:00:00Z");
const ok = { clientId: "cli_a", revoked: false, expiresAt: new Date("2026-02-01T00:00:00Z") };

describe("refreshRejection", () => {
  it("token válido, com ou sem client_id igual: pode rotacionar", () => {
    assert.equal(refreshRejection(ok, undefined, now), null);
    assert.equal(refreshRejection(ok, "cli_a", now), null);
  });

  it("inexistente, revogado ou vencido: inválido", () => {
    assert.match(refreshRejection(undefined, "cli_a", now)!, /Invalid or expired/);
    assert.match(refreshRejection({ ...ok, revoked: true }, "cli_a", now)!, /Invalid or expired/);
    assert.match(refreshRejection({ ...ok, expiresAt: new Date("2026-01-09T00:00:00Z") }, "cli_a", now)!, /Invalid or expired/);
  });

  it("client_id de outro cliente é recusado", () => {
    assert.match(refreshRejection(ok, "cli_b", now)!, /another client/);
  });
});

describe("página de autorização (idioma)", () => {
  it("pageLang: ?lang vence, depois Accept-Language; padrão inglês", () => {
    assert.equal(pageLang(undefined, undefined), "en");
    assert.equal(pageLang(undefined, "pt-BR,pt;q=0.9,en;q=0.8"), "pt");
    assert.equal(pageLang(undefined, "en-US,en;q=0.9"), "en");
    assert.equal(pageLang("en", "pt-BR"), "en");
    assert.equal(pageLang("pt", "en-US"), "pt");
    assert.equal(pageLang("fr", "de"), "en");
  });

  it("inglês por padrão, português quando pedido", () => {
    const en = authorizePage({ requestId: "ar_1", clientName: "Claude", redirectHost: "claude.ai", verified: true, apiBase: "https://x.test", webUrl: "https://x.test", memoryMessage: "m" });
    assert.match(en, /<html lang="en">/);
    assert.match(en, /Connect Claude to Solvers/);
    assert.match(en, /Verified destination/);
    const pt = authorizePage({ lang: "pt", requestId: "ar_1", clientName: "Claude", redirectHost: "claude.ai", verified: true, apiBase: "https://x.test", webUrl: "https://x.test", memoryMessage: "m" });
    assert.match(pt, /<html lang="pt-BR">/);
    assert.match(pt, /Conectar Claude ao Solvers/);
  });

  it("erro escapa HTML e usa o título do idioma", () => {
    const html = authorizePage({ error: "<b>x</b>" });
    assert.match(html, /We couldn't continue/);
    assert.doesNotMatch(html, /<b>x<\/b>/);
    assert.match(authorizePage({ lang: "pt", error: "x" }), /Não foi possível continuar/);
  });
});
