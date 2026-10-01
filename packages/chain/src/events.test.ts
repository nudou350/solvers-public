import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { getAddressEncoder, getBase58Decoder, getBase64Decoder, type Address } from "@solana/kit";
import * as gen from "@solvers/client";
import { PROGRAM_ID, decodeCoreAsset, parseEvents, parseEventsDetailed, truncateUtf8 } from "./index.js";

// Funções puras: sem rede, sem validador local e sem o .so do programa.

const OTHER = "11111111111111111111111111111111";
const AGENT = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d" as Address;

function eventLine(status: number): string {
  const bytes = gen.getAgentStatusChangedEventEncoder().encode({ agent: AGENT, status });
  return `Program data: ${getBase64Decoder().decode(bytes)}`;
}

describe("parseEvents: logs do programa", () => {
  it("decodifica um evento emitido pelo nosso programa", () => {
    const logs = [`Program ${PROGRAM_ID} invoke [1]`, eventLine(2), `Program ${PROGRAM_ID} success`];
    const events = parseEvents(logs, PROGRAM_ID);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.name, "AgentStatusChanged");
    assert.deepEqual(events[0]!.data, { agent: AGENT, status: 2 });
  });

  it("ignora 'Program data' de outro programa chamado por CPI", () => {
    const logs = [
      `Program ${PROGRAM_ID} invoke [1]`,
      `Program ${OTHER} invoke [2]`,
      eventLine(1),
      `Program ${OTHER} success`,
      eventLine(3),
      `Program ${PROGRAM_ID} success`,
    ];
    const events = parseEvents(logs, PROGRAM_ID);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0]!.data, { agent: AGENT, status: 3 });
  });

  it("ignora dados que não batem com nenhum discriminador ou não são base64", () => {
    const logs = [`Program ${PROGRAM_ID} invoke [1]`, "Program data: AAAAAAAAAAAAAAAA", "Program data: ###", `Program ${PROGRAM_ID} success`];
    assert.deepEqual(parseEvents(logs, PROGRAM_ID), []);
  });

  it("avisa quando os logs vieram truncados", () => {
    const logs = [`Program ${PROGRAM_ID} invoke [1]`, eventLine(1), "Log truncated", eventLine(2)];
    const res = parseEventsDetailed(logs, PROGRAM_ID);
    assert.equal(res.truncated, true);
    assert.equal(res.events.length, 1);
  });
});

describe("parseEvents: eventos de governança (rotação de admin, tesouraria, reposição de stake, pausa e guardian)", () => {
  const A = AGENT;
  const B = OTHER as Address;
  const HASH = new Uint8Array(32).fill(7);
  const line = (bytes: Uint8Array) => `Program data: ${getBase64Decoder().decode(bytes)}`;
  const wrap = (...lines: string[]) => [`Program ${PROGRAM_ID} invoke [1]`, ...lines, `Program ${PROGRAM_ID} success`];

  it("decodifica os 15 eventos novos com nome e campos", () => {
    const cases: Array<[string, Uint8Array, unknown]> = [
      ["AdminTransferProposed", gen.getAdminTransferProposedEventEncoder().encode({ admin: A, newAdmin: B }), { admin: A, newAdmin: B }],
      ["AdminTransferCancelled", gen.getAdminTransferCancelledEventEncoder().encode({ admin: A, newAdmin: B }), { admin: A, newAdmin: B }],
      ["AdminTransferred", gen.getAdminTransferredEventEncoder().encode({ oldAdmin: A, newAdmin: B }), { oldAdmin: A, newAdmin: B }],
      ["TreasuryUpdated", gen.getTreasuryUpdatedEventEncoder().encode({ oldTreasury: A, newTreasury: B }), { oldTreasury: A, newTreasury: B }],
      [
        "StakeToppedUp",
        gen.getStakeToppedUpEventEncoder().encode({ agent: A, creator: B, amount: 5_000_000n, stake: 15_000_000n }),
        { agent: A, creator: B, amount: 5_000_000n, stake: 15_000_000n },
      ],
      ["PauseChanged", gen.getPauseChangedEventEncoder().encode({ by: A, oldFlags: 0, newFlags: 3 }), { by: A, oldFlags: 0, newFlags: 3 }],
      [
        "GuardianChanged",
        gen.getGuardianChangedEventEncoder().encode({ admin: A, oldGuardian: B, newGuardian: A }),
        { admin: A, oldGuardian: B, newGuardian: A },
      ],
      ["StakeExitRequested", gen.getStakeExitRequestedEventEncoder().encode({ agent: A, creator: B, exitAt: 1_700_000_000n }), { agent: A, creator: B, exitAt: 1_700_000_000n }],
      [
        "StakeExitExtended",
        gen.getStakeExitExtendedEventEncoder().encode({ agent: A, exitAt: 1_702_592_000n, extensions: 1, reasonHash: HASH }),
        { agent: A, exitAt: 1_702_592_000n, extensions: 1, reasonHash: HASH },
      ],
      ["StakeExitCancelled", gen.getStakeExitCancelledEventEncoder().encode({ agent: A, creator: B }), { agent: A, creator: B }],
      ["StakeWithdrawn", gen.getStakeWithdrawnEventEncoder().encode({ agent: A, creator: B, amount: 10_000_000n }), { agent: A, creator: B, amount: 10_000_000n }],
      [
        "SlashProposed",
        gen.getSlashProposedEventEncoder().encode({ agent: A, amount: 3_000_000n, reasonHash: HASH, executableAt: 1_700_259_200n }),
        { agent: A, amount: 3_000_000n, reasonHash: HASH, executableAt: 1_700_259_200n },
      ],
      ["SlashContested", gen.getSlashContestedEventEncoder().encode({ agent: A, contestHash: HASH }), { agent: A, contestHash: HASH }],
      ["SlashCancelled", gen.getSlashCancelledEventEncoder().encode({ agent: A, amount: 3_000_000n }), { agent: A, amount: 3_000_000n }],
      ["SlashExecuted", gen.getSlashExecutedEventEncoder().encode({ agent: A, amount: 3_000_000n, treasury: B }), { agent: A, amount: 3_000_000n, treasury: B }],
    ];
    for (const [name, bytes, data] of cases) {
      const events = parseEvents(wrap(line(bytes)), PROGRAM_ID);
      assert.equal(events.length, 1, name);
      assert.equal(events[0]!.name, name);
      assert.deepEqual(events[0]!.data, data, name);
    }
  });

  it("evento de discriminador desconhecido (versão futura do programa) é ignorado e os vizinhos continuam", () => {
    const unknown = Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9, 1, 2, 3, 4]);
    const stake = gen.getStakeToppedUpEventEncoder().encode({ agent: A, creator: B, amount: 1n, stake: 2n });
    const events = parseEvents(wrap(eventLine(1), line(unknown), line(stake)), PROGRAM_ID);
    assert.deepEqual(events.map((e) => e.name), ["AgentStatusChanged", "StakeToppedUp"]);
  });
});

describe("parseEvents: eventos de revenda de licenças", () => {
  const AGENT_A = AGENT;
  const SELLER = OTHER as Address;
  const BUYER = "SysvarRent111111111111111111111111111111111" as Address;
  const ASSET = "SysvarC1ock11111111111111111111111111111111" as Address;
  const line = (bytes: Uint8Array) => `Program data: ${getBase64Decoder().decode(bytes)}`;
  const wrap = (...lines: string[]) => [`Program ${PROGRAM_ID} invoke [1]`, ...lines, `Program ${PROGRAM_ID} success`];

  it("decodifica LicenseListed, LicenseResold e ListingCancelled com nome e campos", () => {
    const listed = { agent: AGENT_A, seller: SELLER, asset: ASSET, price: 25_000_000n, feeBps: 1_000, royaltyBps: 500 };
    const resold = {
      agent: AGENT_A,
      asset: ASSET,
      seller: SELLER,
      buyer: BUYER,
      price: 25_000_000n,
      royalty: 1_250_000n,
      fee: 2_500_000n,
      sellerAmount: 21_250_000n,
    };
    const cancelled = { agent: AGENT_A, asset: ASSET, seller: SELLER, canceller: BUYER };
    const cases: Array<[string, Uint8Array, unknown]> = [
      ["LicenseListed", gen.getLicenseListedEventEncoder().encode(listed), listed],
      ["LicenseResold", gen.getLicenseResoldEventEncoder().encode(resold), resold],
      ["ListingCancelled", gen.getListingCancelledEventEncoder().encode(cancelled), cancelled],
    ];
    for (const [name, bytes, data] of cases) {
      const events = parseEvents(wrap(line(bytes)), PROGRAM_ID);
      assert.equal(events.length, 1, name);
      assert.equal(events[0]!.name, name);
      assert.deepEqual(events[0]!.data, data, name);
    }
  });

  it("uma venda num log só: o evento do mpl-core (CPI) é ignorado e royalty + taxa + vendedor fecham o preço", () => {
    const resold = gen.getLicenseResoldEventEncoder().encode({
      agent: AGENT_A,
      asset: ASSET,
      seller: SELLER,
      buyer: BUYER,
      price: 5_000_009n,
      royalty: 250_000n,
      fee: 500_000n,
      sellerAmount: 4_250_009n,
    });
    const logs = [
      `Program ${PROGRAM_ID} invoke [1]`,
      `Program ${AGENT_A} invoke [2]`,
      `Program ${AGENT_A} success`,
      line(resold),
      `Program ${PROGRAM_ID} success`,
    ];
    const events = parseEvents(logs, PROGRAM_ID);
    assert.equal(events.length, 1);
    const e = events[0]!;
    assert.equal(e.name, "LicenseResold");
    if (e.name !== "LicenseResold") return;
    assert.equal(e.data.royalty + e.data.fee + e.data.sellerAmount, e.data.price);
  });
});

describe("endereços derivados (PDA)", () => {
  it("o PDA de Config é estável e diferente por comprador", async () => {
    const [a] = await gen.findConfigPda();
    const [b] = await gen.findConfigPda();
    assert.equal(a, b);
    const [r1] = await gen.findReputationPda({ buyer: AGENT });
    const [r2] = await gen.findReputationPda({ buyer: OTHER as Address });
    assert.notEqual(r1, r2);
  });
});

describe("truncateUtf8", () => {
  it("corta por bytes sem quebrar caracteres multibyte", () => {
    assert.equal(truncateUtf8("abc", 10), "abc");
    assert.equal(truncateUtf8("ação", 3), "aç");
    assert.equal(new TextEncoder().encode(truncateUtf8("ééééé", 5)).length, 4);
  });
});

describe("decodeCoreAsset", () => {
  const str = (s: string) => {
    const b = new TextEncoder().encode(s);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, b.length, true);
    return [...len, ...b];
  };
  it("lê dono, nome e uri de um AssetV1 sem coleção", () => {
    const owner = getAddressEncoder().encode(AGENT);
    const data = Uint8Array.from([1, ...owner, 0, ...str("Licença"), ...str("https://x.test/a.json")]);
    const asset = decodeCoreAsset(data);
    assert.ok(asset);
    assert.equal(asset.owner, getBase58Decoder().decode(owner));
    assert.equal(asset.collection, null);
    assert.equal(asset.name, "Licença");
    assert.equal(asset.uri, "https://x.test/a.json");
  });
  it("devolve null quando não é AssetV1", () => {
    assert.equal(decodeCoreAsset(Uint8Array.from([2, 0, 0])), null);
  });
});
