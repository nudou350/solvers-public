import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { AccountRole, generateKeyPairSigner } from "@solana/kit";
import { CORE_TRANSFER_V1_DATA, MPL_CORE_PROGRAM_ADDRESS, SolversChain, TxError, transferCoreIx } from "./chain.js";

// Custódia do x402 (docs/x402-agentes.md, 6.5): TransferV1 montado à mão e guardas que rodam antes de qualquer RPC.

const chainWith = async (withCustody: boolean) => {
  const feePayer = await generateKeyPairSigner();
  const custody = withCustody ? await generateKeyPairSigner() : undefined;
  const usdcMint = (await generateKeyPairSigner()).address;
  // RPC inexistente: os testes abaixo falham (ou passam) antes de qualquer chamada de rede.
  return { feePayer, custody, chain: new SolversChain({ rpcUrl: "http://127.0.0.1:1", usdcMint, feePayer, custody }) };
};

describe("transferCoreIx (TransferV1 do mpl-core)", () => {
  it("usa o discriminador 14 e compression_proof = None", () => {
    assert.deepEqual([...CORE_TRANSFER_V1_DATA], [14, 0]);
  });

  it("monta as 7 contas na ordem do mpl-core, com os papéis certos", async () => {
    const [asset, collection, payer, authority, owner] = await Promise.all(Array.from({ length: 5 }, () => generateKeyPairSigner()));
    const ix = transferCoreIx({ asset: asset.address, collection: collection.address, payer, authority, newOwner: owner.address });
    assert.equal(ix.programAddress, MPL_CORE_PROGRAM_ADDRESS);
    const accounts = ix.accounts ?? [];
    assert.deepEqual(
      accounts.map((a) => a.address),
      [
        asset.address,
        collection.address,
        payer.address,
        authority.address,
        owner.address,
        "11111111111111111111111111111111",
        MPL_CORE_PROGRAM_ADDRESS, // log_wrapper ausente: o próprio programa no lugar (como o builder do crate)
      ],
    );
    assert.deepEqual(
      accounts.map((a) => a.role),
      [
        AccountRole.WRITABLE,
        AccountRole.WRITABLE,
        AccountRole.WRITABLE_SIGNER,
        AccountRole.READONLY_SIGNER,
        AccountRole.READONLY,
        AccountRole.READONLY,
        AccountRole.READONLY,
      ],
    );
    assert.deepEqual([...(ix.data ?? [])], [14, 0]);
  });
});

describe("custódia no SolversChain", () => {
  it("sem custody (x402 desligado): custodyAddress é null e custody lança", async () => {
    const { chain } = await chainWith(false);
    assert.equal(chain.custodyAddress, null);
    assert.throws(() => chain.custody, TxError);
  });

  it("com custody: expõe o endereço", async () => {
    const { chain, custody } = await chainWith(true);
    assert.equal(chain.custodyAddress, custody!.address);
    assert.equal(chain.custody.address, custody!.address);
  });

  it("custodyMintFor e refundUsdcTx recusam custódia ou fee payer como pagador, sem tocar na rede", async () => {
    const { chain, feePayer, custody } = await chainWith(true);
    await assert.rejects(chain.custodyMintFor(custody!.address, "00".repeat(16), 5_000_000n), /reservada/);
    await assert.rejects(chain.custodyMintFor(feePayer.address, "00".repeat(16), 5_000_000n), /reservada/);
    await assert.rejects(chain.refundUsdcTx(custody!.address, 5_000_000n), /reservada/);
    await assert.rejects(chain.refundUsdcTx(feePayer.address, 5_000_000n), /reservada/);
    const other = await generateKeyPairSigner();
    await assert.rejects(chain.refundUsdcTx(other.address, 0n), /inválido/);
  });

  it("sem custody, custodyMintFor e refundUsdcTx lançam", async () => {
    const { chain } = await chainWith(false);
    const other = await generateKeyPairSigner();
    await assert.rejects(chain.custodyMintFor(other.address, "00".repeat(16), 5_000_000n), /Custódia/);
    await assert.rejects(chain.refundUsdcTx(other.address, 5_000_000n), /Custódia/);
  });

  it("a compra normal (sem signer) recusa a custódia como comprador: um agente nunca pode ser a custódia", async () => {
    const { chain, custody, feePayer } = await chainWith(true);
    await assert.rejects(chain.purchaseLicenseIxs(custody!.address, "00".repeat(16)), /reservada/);
    await assert.rejects(chain.purchaseLicenseIxs(feePayer.address, "00".repeat(16)), /reservada/);
  });

  it("com signer, o endereço precisa ser o do signer e nunca o fee payer", async () => {
    const { chain, custody, feePayer } = await chainWith(true);
    const other = await generateKeyPairSigner();
    await assert.rejects(chain.purchaseLicenseIxs(other.address, "00".repeat(16), 5_000_000n, custody), /reservada/);
    await assert.rejects(chain.purchaseLicenseIxs(feePayer.address, "00".repeat(16), 5_000_000n, feePayer), /reservada/);
  });
});
