import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { generateKeyPairSigner, getAddressEncoder, getBase64Decoder, type Address } from "@solana/kit";
import * as gen from "@solvers/client";
import { RESALE_ERROR_CODES, resaleSplit } from "@solvers/shared";
import { MPL_CORE_PROGRAM_ADDRESS, PROGRAM_ID, ResaleError, SolversChain, decodeCoreLicense, listingIsLive, type CoreLicense } from "./chain.js";

// Revenda: leitura do TransferDelegate do mpl-core e decisões de domínio de list/buy/cancel (RPC simulado, sem rede).

const addr = (a: Address) => Uint8Array.from(getAddressEncoder().encode(a));
const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return [...b];
};
const u64 = (n: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return [...b];
};
const str = (s: string) => {
  const b = new TextEncoder().encode(s);
  return [...u32(b.length), ...b];
};

type Plugin = { type: number; authority: { tag: 0 | 1 | 2 } | { tag: 3; address: Address } };

/** AssetV1 (com coleção) + PluginHeaderV1 + registro de plugins, no layout do mpl-core. */
function coreAsset(owner: Address, collection: Address | null, plugins: Plugin[], seq: number | null = null): Uint8Array {
  const base = [
    1,
    ...addr(owner),
    ...(collection ? [2, ...addr(collection)] : [0]),
    ...str("Licença"),
    ...str("https://x.test/a.json"),
    ...(seq === null ? [0] : [1, ...u64(seq)]),
  ];
  if (plugins.length === 0) return Uint8Array.from(base);
  const header = 9;
  const pluginBytes = plugins.map(() => [0xaa]); // o conteúdo dos plugins não é lido
  const registryOffset = base.length + header + pluginBytes.length;
  const records = plugins.flatMap((p, i) => [
    p.type,
    p.authority.tag,
    ...(p.authority.tag === 3 ? addr(p.authority.address) : []),
    ...u64(base.length + header + i),
  ]);
  return Uint8Array.from([
    ...base,
    3, // Key::PluginHeaderV1
    ...u64(registryOffset),
    ...pluginBytes.flat(),
    4, // Key::PluginRegistryV1
    ...u32(plugins.length),
    ...records,
    ...u32(0), // external_registry
  ]);
}

const TRANSFER_DELEGATE = 3;
const FREEZE_DELEGATE = 1;

describe("decodeCoreLicense / listingIsLive", () => {
  it("lê dono, coleção e o TransferDelegate apontado para a PDA, com outros plugins no registro", async () => {
    const [owner, collection, market] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner()]);
    const data = coreAsset(owner.address, collection.address, [
      { type: FREEZE_DELEGATE, authority: { tag: 1 } },
      { type: TRANSFER_DELEGATE, authority: { tag: 3, address: market.address } },
    ]);
    const core = decodeCoreLicense(data);
    assert.deepEqual(core, { owner: owner.address, collection: collection.address, transferDelegate: { kind: "Address", address: market.address } });
    assert.ok(listingIsLive({ seller: owner.address }, core, collection.address, market.address));
  });

  it("seq preenchido, authority Owner (resetada após transferência) e asset sem plugin", async () => {
    const [owner, collection, market] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner()]);
    const reset = decodeCoreLicense(coreAsset(owner.address, collection.address, [{ type: TRANSFER_DELEGATE, authority: { tag: 1 } }], 7))!;
    assert.deepEqual(reset.transferDelegate, { kind: "Owner" });
    assert.ok(!listingIsLive({ seller: owner.address }, reset, collection.address, market.address));
    const bare = decodeCoreLicense(coreAsset(owner.address, collection.address, []))!;
    assert.equal(bare.transferDelegate, null);
    assert.ok(!listingIsLive({ seller: owner.address }, bare, collection.address, market.address));
  });

  it("anúncio velho: dono mudou, outra coleção, outro delegate ou asset queimado não são vivos", async () => {
    const [seller, other, collection, otherCollection, market] = await Promise.all(Array.from({ length: 5 }, () => generateKeyPairSigner()));
    const live: CoreLicense = { owner: seller!.address, collection: collection!.address, transferDelegate: { kind: "Address", address: market!.address } };
    const check = (core: CoreLicense | null, coll = collection!.address) => listingIsLive({ seller: seller!.address }, core, coll, market!.address);
    assert.ok(check(live));
    assert.ok(!check({ ...live, owner: other!.address }));
    assert.ok(!check(live, otherCollection!.address));
    assert.ok(!check({ ...live, collection: null }));
    assert.ok(!check({ ...live, transferDelegate: { kind: "Address", address: other!.address } }));
    assert.ok(!check(null));
  });

  it("não é AssetV1 devolve null; dado truncado ou registro inválido lança", async () => {
    const [owner, collection] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    assert.equal(decodeCoreLicense(Uint8Array.from([0, 0, 0])), null);
    const full = coreAsset(owner.address, collection.address, [{ type: TRANSFER_DELEGATE, authority: { tag: 1 } }]);
    assert.throws(() => decodeCoreLicense(full.subarray(0, full.length - 3)));
    assert.throws(() => decodeCoreLicense(full.subarray(0, 40)));
    const badKey = Uint8Array.from(full);
    badKey[badKey.length - 19] = 9; // Key do registro: 1 + 4 (contagem) + 10 (registro) + 4 (externos) do fim
    assert.throws(() => decodeCoreLicense(badKey));
  });
});

// ---------------------------------------------------------------------------------------- domínio ----

const USDC = 1_000_000n;
const MIN_PRICE = 5n * USDC;
const AGENT_ID = "3f9a1c2e7b8d4e6fa1b2c3d4e5f60718";
const b64 = (b: Uint8Array) => getBase64Decoder().decode(b);

async function world(opts: { royaltyBps?: number; feeBps?: number; status?: gen.AgentStatus } = {}) {
  const [feePayer, seller, buyer, creator, collection, asset, treasury, creatorUsdc, mint] = await Promise.all(
    Array.from({ length: 9 }, () => generateKeyPairSigner()),
  );
  const chain = new SolversChain({ rpcUrl: "http://127.0.0.1:1", usdcMint: mint!.address, feePayer: feePayer! });
  const accounts = new Map<string, { owner: Address; data: Uint8Array }>();
  const put = (a: Address, owner: Address, data: Uint8Array) => accounts.set(a, { owner, data });
  const agentAddr = await chain.agentPda(AGENT_ID);
  const market = await chain.marketAuthorityPda();
  const agentData = {
    agentId: Uint8Array.from(AGENT_ID.match(/../g)!.map((h) => parseInt(h, 16))),
    creator: creator!.address,
    collection: collection!.address,
    creatorUsdc: creatorUsdc!.address,
    metadataUri: "https://x.test/m.json",
    version: "1.0.0",
    versionHash: new Uint8Array(32),
    evalScoreBps: 9000,
    evalHash: new Uint8Array(32),
    price: 20n * USDC,
    pricePerUse: 0n,
    royaltyBps: opts.royaltyBps ?? 500,
    stake: 100n * USDC,
    status: opts.status ?? gen.AgentStatus.Active,
    totalSales: 0n,
    verifiedUses: 0n,
    ratingSum: 0n,
    ratingCount: 0,
    disputesLost: 0,
    bump: 255,
  };
  put(agentAddr, PROGRAM_ID, Uint8Array.from(gen.getAgentEncoder().encode(agentData)));
  put(
    await chain.configPda(),
    PROGRAM_ID,
    Uint8Array.from(
      gen.getConfigEncoder().encode({
        admin: creator!.address,
        verifier: creator!.address,
        usageAuthority: creator!.address,
        treasury: treasury!.address,
        usdcMint: mint!.address,
        feeBps: opts.feeBps ?? 1000,
        minStake: 10n * USDC,
        minPrice: MIN_PRICE,
        bump: 255,
        layoutVersion: 2,
        pauseFlags: 0,
        guardian: creator!.address,
        reserved: new Uint8Array(64),
      }),
    ),
  );
  const setAsset = (owner: Address, delegate: Plugin["authority"] | null) =>
    put(asset!.address, MPL_CORE_PROGRAM_ADDRESS, coreAsset(owner, collection!.address, delegate ? [{ type: TRANSFER_DELEGATE, authority: delegate }] : []));
  const setListing = async (over: Partial<gen.ListingArgs> = {}) =>
    put(
      await chain.listingPda(asset!.address),
      PROGRAM_ID,
      Uint8Array.from(
        gen.getListingEncoder().encode({
          seller: seller!.address,
          asset: asset!.address,
          agent: agentAddr,
          price: 50n * USDC,
          feeBps: 1000,
          royaltyBps: 500,
          listedAt: 1_700_000_000n,
          rentPayer: feePayer!.address,
          bump: 255,
          ...over,
        }),
      ),
    );
  let programScans = 0;
  (chain as unknown as { rpc: unknown }).rpc = {
    getAccountInfo: (a: Address) => ({
      send: async () => {
        const acc = accounts.get(a);
        return { value: acc ? { data: [b64(acc.data), "base64"], executable: false, lamports: 1n, owner: acc.owner, space: BigInt(acc.data.length) } : null };
      },
    }),
    getProgramAccounts: () => ({
      send: async () => {
        programScans++;
        return [{ pubkey: agentAddr, account: { data: [b64(accounts.get(agentAddr)!.data), "base64"] } }];
      },
    }),
  };
  return {
    chain,
    feePayer: feePayer!,
    seller: seller!.address,
    buyer: buyer!.address,
    creator: creator!.address,
    asset: asset!.address,
    market,
    agentAddr,
    setAsset,
    setListing,
    scans: () => programScans,
  };
}

const discriminator = (ix: { data?: ReadonlyUint8Array }) => Array.from(ix.data!.slice(0, 8));
type ReadonlyUint8Array = Uint8Array | readonly number[];
const LIST = Array.from(gen.LIST_LICENSE_DISCRIMINATOR);
const BUY = Array.from(gen.BUY_LISTING_DISCRIMINATOR);
const CANCEL = Array.from(gen.CANCEL_LISTING_DISCRIMINATOR);

const code = (c: string) => (e: unknown) => e instanceof ResaleError && e.code === c;

describe("listLicenseIxs", () => {
  it("anuncia: list_license, corte congelado do agente e da config, agente achado pela coleção", async () => {
    const w = await world();
    w.setAsset(w.seller, null);
    const res = await w.chain.listLicenseIxs(w.seller, w.asset, 50n * USDC);
    assert.equal(res.instructions.length, 1);
    assert.deepEqual(discriminator(res.instructions[0]!), LIST);
    assert.equal(res.feeBps, 1000);
    assert.equal(res.royaltyBps, 500);
    assert.equal(res.agent, w.agentAddr);
    assert.equal(res.listing, await w.chain.listingPda(w.asset));
    assert.equal(res.replacedStaleListing, false);
    assert.equal(w.scans(), 1);
    // Com o agent id, não varre as contas do programa.
    await w.chain.listLicenseIxs(w.seller, w.asset, 50n * USDC, { agentIdHex: AGENT_ID });
    assert.equal(w.scans(), 1);
  });

  it("erros de domínio antes da simulação", async () => {
    const w = await world();
    w.setAsset(w.seller, null);
    await assert.rejects(w.chain.listLicenseIxs(w.buyer, w.asset, 50n * USDC), code(RESALE_ERROR_CODES.notOwner));
    await assert.rejects(w.chain.listLicenseIxs(w.seller, w.asset, MIN_PRICE - 1n), code(RESALE_ERROR_CODES.priceTooLow));
    await assert.rejects(w.chain.listLicenseIxs(w.seller, w.asset, 0n), code(RESALE_ERROR_CODES.priceTooLow));
    await assert.rejects(w.chain.listLicenseIxs(w.feePayer.address, w.asset, 50n * USDC), /reservada/);
    const gone = await world();
    await assert.rejects(gone.chain.listLicenseIxs(gone.seller, gone.asset, 50n * USDC), code(RESALE_ERROR_CODES.licenseInvalid));
    const creator = await world();
    creator.setAsset(creator.creator, null);
    await assert.rejects(creator.chain.listLicenseIxs(creator.creator, creator.asset, 50n * USDC), code(RESALE_ERROR_CODES.creatorCannotResell));
    const cut = await world({ royaltyBps: 4500, feeBps: 1000 });
    cut.setAsset(cut.seller, null);
    await assert.rejects(cut.chain.listLicenseIxs(cut.seller, cut.asset, 50n * USDC), code(RESALE_ERROR_CODES.cutTooHigh));
    // O teto exato (50%) passa.
    const edge = await world({ royaltyBps: 4000, feeBps: 1000 });
    edge.setAsset(edge.seller, null);
    await edge.chain.listLicenseIxs(edge.seller, edge.asset, 50n * USDC);
  });

  it("anúncio ainda válido: already_listed", async () => {
    const w = await world();
    w.setAsset(w.seller, { tag: 3, address: w.market });
    await w.setListing();
    await assert.rejects(w.chain.listLicenseIxs(w.seller, w.asset, 60n * USDC), code(RESALE_ERROR_CODES.alreadyListed));
  });

  it("anúncio velho (dono mudou, delegate resetado): prefixa cancel_listing e depois list_license", async () => {
    const w = await world();
    // O dono antigo anunciou; a licença foi transferida por fora e o novo dono (buyer) quer anunciar.
    w.setAsset(w.buyer, { tag: 1 });
    await w.setListing();
    const res = await w.chain.listLicenseIxs(w.buyer, w.asset, 60n * USDC);
    assert.deepEqual(res.instructions.map(discriminator), [CANCEL, LIST]);
    assert.equal(res.replacedStaleListing, true);
    // Mesmo vendedor com o delegate revogado por fora: também é velho.
    const same = await world();
    same.setAsset(same.seller, { tag: 1 });
    await same.setListing();
    assert.deepEqual((await same.chain.listLicenseIxs(same.seller, same.asset, 60n * USDC)).instructions.map(discriminator), [CANCEL, LIST]);
  });
});

describe("buyListingIxs", () => {
  it("compra: ATA do vendedor idempotente e buy_listing; partes iguais ao programa", async () => {
    const w = await world();
    w.setAsset(w.seller, { tag: 3, address: w.market });
    await w.setListing({ price: 5_000_009n });
    const res = await w.chain.buyListingIxs(w.buyer, w.asset, 5_000_009n);
    assert.equal(res.instructions.length, 2);
    assert.deepEqual(discriminator(res.instructions[1]!), BUY);
    assert.deepEqual([res.royaltyUnits, res.feeUnits, res.sellerUnits], [250_000n, 500_000n, 4_250_009n]);
    assert.equal(res.royaltyUnits + res.feeUnits + res.sellerUnits, res.priceUnits);
    assert.deepEqual({ r: res.royaltyUnits, f: res.feeUnits, s: res.sellerUnits }, (({ royalty, fee, seller }) => ({ r: royalty, f: fee, s: seller }))(resaleSplit(5_000_009n, 500, 1000)));
    assert.equal(res.seller, w.seller);
    // A primeira instrução é a criação idempotente da ATA do vendedor (o rent é do fee payer).
    const ata = await w.chain.ata(w.seller);
    assert.ok(res.instructions[0]!.accounts!.some((a) => a.address === ata));
  });

  it("congela o corte do anúncio, não o atual da config", async () => {
    const w = await world({ feeBps: 2000 });
    w.setAsset(w.seller, { tag: 3, address: w.market });
    await w.setListing({ price: 100n * USDC, feeBps: 1000, royaltyBps: 500 });
    const res = await w.chain.buyListingIxs(w.buyer, w.asset, 100n * USDC);
    assert.equal(res.feeUnits, 10n * USDC);
    assert.equal(res.royaltyUnits, 5n * USDC);
  });

  it("erros de domínio", async () => {
    const w = await world();
    await assert.rejects(w.chain.buyListingIxs(w.buyer, w.asset, 50n * USDC), code(RESALE_ERROR_CODES.listingNotFound));
    w.setAsset(w.seller, { tag: 3, address: w.market });
    await w.setListing();
    await assert.rejects(w.chain.buyListingIxs(w.seller, w.asset, 50n * USDC), code(RESALE_ERROR_CODES.ownListing));
    await assert.rejects(w.chain.buyListingIxs(w.buyer, w.asset, 49n * USDC), (e) => {
      return e instanceof ResaleError && e.code === RESALE_ERROR_CODES.listingChanged && e.details.priceUnits === 50n * USDC;
    });
    // Delegate resetado (dono revogou ou transferiu): o anúncio não vale mais.
    w.setAsset(w.seller, { tag: 1 });
    await assert.rejects(w.chain.buyListingIxs(w.buyer, w.asset, 50n * USDC), code(RESALE_ERROR_CODES.listingNotFound));
    // Solver suspenso.
    const sus = await world({ status: gen.AgentStatus.Suspended });
    sus.setAsset(sus.seller, { tag: 3, address: sus.market });
    await sus.setListing();
    await assert.rejects(sus.chain.buyListingIxs(sus.buyer, sus.asset, 50n * USDC), code(RESALE_ERROR_CODES.agentUnavailable));
  });
});

describe("cancelListingIxs", () => {
  it("vendedor com anúncio vivo e rent_payer = fee payer: cancel_listing", async () => {
    const w = await world();
    w.setAsset(w.seller, { tag: 3, address: w.market });
    await w.setListing();
    const res = await w.chain.cancelListingIxs(w.seller, w.asset);
    assert.deepEqual(res.instructions.map(discriminator), [CANCEL]);
    assert.equal(res.stale, false);
    assert.equal(res.seller, w.seller);
  });

  it("vendedor com anúncio vivo e rent_payer de outra conta: cancel_via_wallet", async () => {
    const w = await world();
    w.setAsset(w.seller, { tag: 3, address: w.market });
    await w.setListing({ rentPayer: w.creator });
    await assert.rejects(w.chain.cancelListingIxs(w.seller, w.asset), code(RESALE_ERROR_CODES.cancelViaWallet));
    // Anúncio velho do mesmo vendedor: não faz CPI, o payer não importa e o cancelamento passa.
    w.setAsset(w.seller, { tag: 1 });
    assert.equal((await w.chain.cancelListingIxs(w.seller, w.asset)).stale, true);
  });

  it("terceiro: só fecha anúncio velho; vivo é not_owner; sem anúncio é listing_not_found", async () => {
    const w = await world();
    await assert.rejects(w.chain.cancelListingIxs(w.buyer, w.asset), code(RESALE_ERROR_CODES.listingNotFound));
    w.setAsset(w.seller, { tag: 3, address: w.market });
    await w.setListing();
    await assert.rejects(w.chain.cancelListingIxs(w.buyer, w.asset), code(RESALE_ERROR_CODES.notOwner));
    w.setAsset(w.buyer, { tag: 1 }); // transferida por fora
    const res = await w.chain.cancelListingIxs(w.buyer, w.asset);
    assert.deepEqual(res.instructions.map(discriminator), [CANCEL]);
    assert.equal(res.stale, true);
  });

  it("asset queimado (conta inexistente): anúncio velho, qualquer um fecha", async () => {
    const w = await world();
    await w.setListing();
    const res = await w.chain.cancelListingIxs(w.buyer, w.asset);
    assert.equal(res.stale, true);
  });
});
