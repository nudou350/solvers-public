import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { HttpError } from "../src/lib/http.js";
import { purchaseBlock } from "../src/store/purchase-rules.js";

// Guardas de compra (POST /tx/purchase e rota x402). Regra pura, sem banco nem RPC.

const W = "Wallet1111111111111111111111111111111111111";
const CREATOR = "Creator111111111111111111111111111111111111";

describe("purchaseBlock", () => {
  it("quem não tem licença nem é o criador pode comprar", () => {
    assert.equal(purchaseBlock({ wallet: W, creatorWallet: CREATOR, ownedAssetId: null }), null);
    assert.equal(purchaseBlock({ wallet: W, creatorWallet: null, ownedAssetId: null }), null);
  });

  it("licença já possuída: 409 already_owned com assetId", () => {
    const e = purchaseBlock({ wallet: W, creatorWallet: CREATOR, ownedAssetId: "Asset1" });
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, 409);
    assert.equal(e.code, "already_owned");
    assert.equal(e.extra?.assetId, "Asset1");
  });

  it("o criador do solver não compra: 400 creator_cannot_buy", () => {
    const e = purchaseBlock({ wallet: CREATOR, creatorWallet: CREATOR, ownedAssetId: null });
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, 400);
    assert.equal(e.code, "creator_cannot_buy");
  });

  it("já possuída tem prioridade sobre criador (resposta estável)", () => {
    assert.equal(purchaseBlock({ wallet: CREATOR, creatorWallet: CREATOR, ownedAssetId: "A" })?.code, "already_owned");
  });
});
