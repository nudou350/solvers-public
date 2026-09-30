import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { refreshRejection } from "../src/oauth/rules.js";

// Rotação do refresh: tudo é validado antes de revogar (sem env ou banco).

const now = new Date("2026-01-10T00:00:00Z");
const ok = { clientId: "cli_a", revoked: false, expiresAt: new Date("2026-02-01T00:00:00Z") };

describe("refreshRejection", () => {
  it("token válido, com ou sem client_id igual: pode rotacionar", () => {
    assert.equal(refreshRejection(ok, undefined, now), null);
    assert.equal(refreshRejection(ok, "cli_a", now), null);
  });

  it("inexistente, revogado ou vencido: inválido", () => {
    assert.match(refreshRejection(undefined, "cli_a", now)!, /inválido ou expirado/);
    assert.match(refreshRejection({ ...ok, revoked: true }, "cli_a", now)!, /inválido ou expirado/);
    assert.match(refreshRejection({ ...ok, expiresAt: new Date("2026-01-09T00:00:00Z") }, "cli_a", now)!, /inválido ou expirado/);
  });

  it("client_id de outro cliente é recusado", () => {
    assert.match(refreshRejection(ok, "cli_b", now)!, /outro cliente/);
  });
});
