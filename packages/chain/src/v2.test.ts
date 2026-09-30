import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { address, generateKeyPairSigner, getBase64Decoder, type Address } from "@solana/kit";
import * as gen from "@solvers/client";
import { ESCROW_ACCOUNT_SIZE, PROGRAM_ID, SolversChain, friendlyError, parseEvents } from "./index.js";

// Programa v2: eventos novos e montagem das instruções novas (sem rede: RPC simulado).

const A = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d" as Address;
const B = "11111111111111111111111111111111" as Address;
const line = (bytes: Uint8Array) => `Program data: ${getBase64Decoder().decode(bytes)}`;
const logs = (...lines: string[]) => [`Program ${PROGRAM_ID} invoke [1]`, ...lines, `Program ${PROGRAM_ID} success`];

describe("eventos novos do programa v2", () => {
  it("ConfigUpdated, EscrowClosed e PricingUpdated", () => {
    const events = parseEvents(
      logs(
        line(gen.getConfigUpdatedEventEncoder().encode({ verifier: A, usageAuthority: B, feeBps: 1500, minStake: 5n, minPrice: 7n })),
        line(gen.getEscrowClosedEventEncoder().encode({ escrow: A, agent: B, buyer: A })),
        line(gen.getPricingUpdatedEventEncoder().encode({ agent: A, price: 12_000_000n, pricePerUse: 0n })),
      ),
      PROGRAM_ID,
    );
    assert.deepEqual(events.map((e) => e.name), ["ConfigUpdated", "EscrowClosed", "PricingUpdated"]);
    assert.equal((events[0]!.data as gen.ConfigUpdatedEvent).feeBps, 1500);
    assert.equal((events[1]!.data as gen.EscrowClosedEvent).escrow, A);
    assert.equal((events[2]!.data as gen.PricingUpdatedEvent).price, 12_000_000n);
  });
});

async function makeChain(escrowAccount?: Uint8Array) {
  const c = new SolversChain({ rpcUrl: "http://127.0.0.1:1", usdcMint: address("So11111111111111111111111111111111111111112"), feePayer: await generateKeyPairSigner() });
  (c as unknown as { rpc: unknown }).rpc = {
    getAccountInfo: () => ({
      send: async () => ({
        value: escrowAccount
          ? { data: [getBase64Decoder().decode(escrowAccount), "base64"], executable: false, lamports: 1n, owner: PROGRAM_ID, space: BigInt(escrowAccount.length) }
          : null,
      }),
    }),
  };
  return c;
}

describe("builders do programa v2", () => {
  it("create_escrow leva delivery_days (padrão 0)", async () => {
    const c = await makeChain();
    const buyer = (await generateKeyPairSigner()).address;
    const agent = "ab".repeat(16);
    const ms = [{ amount: 1_000_000n, criteriaHash: new Uint8Array(32) }];
    const dflt = await c.createEscrowIxs(buyer, agent, 1n, ms, 100n);
    const d0 = gen.getCreateEscrowInstructionDataDecoder().decode(dflt.instructions[0]!.data as Uint8Array);
    assert.equal(d0.deliveryDays, 0);
    const d30 = gen.getCreateEscrowInstructionDataDecoder().decode((await c.createEscrowIxs(buyer, agent, 1n, ms, 100n, 30)).instructions[0]!.data as Uint8Array);
    assert.equal(d30.deliveryDays, 30);
  });

  it("cancel_undelivered: o comprador assina; contas na ordem do programa", async () => {
    const c = await makeChain();
    const buyer = (await generateKeyPairSigner()).address;
    const escrow = (await generateKeyPairSigner()).address;
    const ixs = await c.cancelUndeliveredIxs(buyer, escrow, 2);
    assert.equal(ixs.length, 2); // recria a ATA do comprador (idempotente) + a instrução
    const ix = ixs[1]!;
    const accts = ix.accounts!;
    assert.equal(accts.length, 6);
    assert.equal(accts[0]!.address, buyer);
    assert.equal(accts[1]!.address, escrow);
    assert.equal(accts[3]!.address, await c.ata(buyer));
    assert.equal(gen.getCancelUndeliveredInstructionDataDecoder().decode(ix.data as Uint8Array).index, 2);
    await assert.rejects(c.cancelUndeliveredIxs(c.feePayer.address, escrow, 0), /reservada/);
  });

  it("resolve_stale_dispute: o servidor assina e devolve ao ATA do comprador", async () => {
    const buyer = (await generateKeyPairSigner()).address;
    const escrowAddr = (await generateKeyPairSigner()).address;
    const milestone = { amount: 1n, criteriaHash: new Uint8Array(32), status: gen.MilestoneStatus.Disputed, deliverableHash: new Uint8Array(32), passedAt: 0n, disputeReasonHash: new Uint8Array(32), disputedAt: 1000n };
    const data = gen.getEscrowEncoder().encode({
      buyer, agent: A, creator: B, rentPayer: A, nonce: 1n, total: 1n, milestones: [milestone], reviewWindowSecs: 100n, autoReleaseAt: 0n,
      status: gen.EscrowStatus.Disputed, bump: 1, vaultBump: 1, feeBps: 1000, deliveryDeadline: 5000n,
    });
    const c = await makeChain(new Uint8Array(data));
    const ixs = await c.resolveStaleDisputeIxs(c.feePayer, escrowAddr, 0);
    assert.equal(ixs.length, 2); // cria o ATA do comprador (idempotente) + a instrução
    const ix = ixs[1]!;
    assert.equal(ix.accounts![0]!.address, c.feePayer.address);
    assert.equal(ix.accounts![3]!.address, await c.ata(buyer));
    assert.equal(gen.getResolveStaleDisputeInstructionDataDecoder().decode(ix.data as Uint8Array).index, 0);
  });
});

describe("escrow do layout antigo (v1)", () => {
  // Conta v1 real: alocada para 5 etapas de 113 bytes, sem fee_bps, prazo nem disputed_at (740 bytes, com padding).
  const V1_SIZE = 8 + 32 * 4 + 8 + 8 + 4 + 5 * 113 + 8 + 8 + 1 + 1 + 1;

  function v1Account(): Uint8Array {
    const b = new Uint8Array(V1_SIZE);
    b.set(gen.ESCROW_DISCRIMINATOR, 0);
    const dv = new DataView(b.buffer);
    let o = 8 + 128;
    dv.setBigUint64(o, 1n, true); // nonce
    dv.setBigUint64(o + 8, 5_000_000n, true); // total
    o += 16;
    dv.setUint32(o, 1, true); // 1 etapa
    o += 4;
    dv.setBigUint64(o, 5_000_000n, true); // amount da etapa 0
    o += 113;
    dv.setBigInt64(o, 86_400n, true); // review_window_secs
    b[o + 16] = 0;
    b[o + 17] = 254; // bump
    b[o + 18] = 253; // vault_bump
    return b;
  }

  it("o decoder v2 ACEITA a conta v1 (e lê lixo): só o tamanho a denuncia", () => {
    const b = v1Account();
    assert.equal(b.length, 740);
    const d = gen.getEscrowDecoder().decode(b); // não lança
    assert.equal(d.feeBps, 0);
    assert.equal(d.deliveryDeadline, 0n);
    assert.equal(ESCROW_ACCOUNT_SIZE, 790);
    assert.notEqual(b.length, ESCROW_ACCOUNT_SIZE);
  });

  it("fetchEscrowLayout: v1 = legacy, v2 = ok, ausente = missing", async () => {
    const legacy = await makeChain(v1Account());
    const addr = (await generateKeyPairSigner()).address;
    assert.deepEqual(await legacy.fetchEscrowLayout(addr), { kind: "legacy", size: 740 });
    assert.deepEqual(await (await makeChain()).fetchEscrowLayout(addr), { kind: "missing" });

    const buyer = (await generateKeyPairSigner()).address;
    const ms = Array.from({ length: 5 }, () => ({ amount: 1n, criteriaHash: new Uint8Array(32), status: gen.MilestoneStatus.Pending, deliverableHash: new Uint8Array(32), passedAt: 0n, disputeReasonHash: new Uint8Array(32), disputedAt: 0n }));
    const v2 = gen.getEscrowEncoder().encode({
      buyer, agent: A, creator: B, rentPayer: A, nonce: 1n, total: 5n, milestones: ms, reviewWindowSecs: 100n, autoReleaseAt: 0n,
      status: gen.EscrowStatus.Active, bump: 1, vaultBump: 1, feeBps: 1000, deliveryDeadline: 5000n,
    });
    assert.equal(v2.length, ESCROW_ACCOUNT_SIZE);
    const r = await (await makeChain(new Uint8Array(v2))).fetchEscrowLayout(addr);
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") assert.equal(r.data.feeBps, 1000);
  });
});

describe("friendlyError", () => {
  it("simulação sem logs do programa: inclui o motivo bruto (causa), sem URLs nem chaves", () => {
    const e = Object.assign(new Error("Transaction simulation failed"), { cause: new Error("Blockhash not found (https://rpc.exemplo.com/?api-key=SEGREDO)") });
    const msg = friendlyError(e, []);
    assert.match(msg, /Transaction simulation failed/);
    assert.match(msg, /Blockhash not found/);
    assert.doesNotMatch(msg, /SEGREDO|https?:/);
    assert.ok(msg.length <= 300);
  });

  it("códigos do programa continuam virando mensagem amigável", () => {
    assert.equal(friendlyError(new Error("x"), ["Program log: AnchorError ... NoCredits ..."]), "Seus créditos acabaram.");
    assert.equal(friendlyError(new Error("fetch failed"), []), "fetch failed");
  });
});
