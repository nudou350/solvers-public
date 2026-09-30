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
