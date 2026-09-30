import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { SolanaError, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE, address, generateKeyPairSigner } from "@solana/kit";
import { SolversChain, TxError, isDefinitelyNotLanded, parseTokenDeltas, type SignedTx } from "./chain.js";

// Envio idempotente: a fase do erro diz se a transação pode ter entrado na rede (RPC simulado, sem rede).

type Status = { err: unknown; confirmationStatus: string } | null;
const SIG = "sig" as never;
const tx: SignedTx = { signature: SIG, wire: "wire" as never, lastValidBlockHeight: 1000 };

async function chainWith(rpc: {
  send?: () => Promise<unknown>;
  status?: () => Promise<Status>;
  height?: number;
}) {
  const c = new SolversChain({ rpcUrl: "http://127.0.0.1:1", usdcMint: address("11111111111111111111111111111111"), feePayer: await generateKeyPairSigner() });
  const fake = {
    sendTransaction: () => ({ send: rpc.send ?? (async () => "ok") }),
    getSignatureStatuses: () => ({ send: async () => ({ value: [rpc.status ? await rpc.status() : null] }) }),
    getBlockHeight: () => ({ send: async () => BigInt(rpc.height ?? 10) }),
  };
  (c as unknown as { rpc: unknown }).rpc = fake;
  return c;
}

describe("fase do erro de envio", () => {
  it("recusa do preflight: rejected (nada foi transmitido)", async () => {
    const preflight = new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE, { accounts: null, innerInstructions: null, logs: [], replacementBlockhash: null, returnData: null, unitsConsumed: 0n } as never);
    const c = await chainWith({ send: async () => { throw preflight; } });
    await assert.rejects(c.sendSigned(tx, { events: false }), (e: unknown) => e instanceof TxError && e.phase === "rejected" && isDefinitelyNotLanded(e));
  });

  it("erro de rede no envio: unconfirmed (pode ter chegado ao RPC)", async () => {
    const c = await chainWith({ send: async () => { throw new Error("fetch failed"); } });
    await assert.rejects(c.sendSigned(tx, { events: false }), (e: unknown) => e instanceof TxError && e.phase === "unconfirmed" && !isDefinitelyNotLanded(e));
  });

  it("entrou e falhou na rede: failed (sem efeito)", async () => {
    const c = await chainWith({ status: async () => ({ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }) });
    await assert.rejects(c.sendSigned(tx, { events: false }), (e: unknown) => e instanceof TxError && e.phase === "failed" && isDefinitelyNotLanded(e));
  });

  it("falha ao consultar o RPC depois do envio: unconfirmed", async () => {
    const c = await chainWith({ status: async () => { throw new Error("fetch failed"); } });
    await assert.rejects(c.sendSigned(tx, { events: false }), (e: unknown) => e instanceof TxError && e.phase === "unconfirmed" && e.signature === SIG);
  });

  it("confirmada: não lê logs quando events:false", async () => {
    const c = await chainWith({ status: async () => ({ err: null, confirmationStatus: "confirmed" }) });
    assert.deepEqual(await c.sendSigned(tx, { events: false }), { signature: SIG, events: [] });
  });

  it("resume não roda o preflight (a transação pode já ter sido processada)", async () => {
    let sends = 0;
    const c = await chainWith({
      send: async () => { sends++; throw new Error("AlreadyProcessed"); },
      status: async () => ({ err: null, confirmationStatus: "finalized" }),
    });
    assert.deepEqual(await c.sendSigned(tx, { events: false, resume: true }), { signature: SIG, events: [] });
    assert.equal(sends, 1); // só a retransmissão sem preflight, cujo erro é ignorado
  });
});

describe("signatureOutcome", () => {
  it("confirmada, falhou, expirada e em aberto", async () => {
    assert.equal(await (await chainWith({ status: async () => ({ err: null, confirmationStatus: "finalized" }) })).signatureOutcome(SIG, 1000), "confirmed");
    assert.equal(await (await chainWith({ status: async () => ({ err: "x", confirmationStatus: "confirmed" }) })).signatureOutcome(SIG, 1000), "failed");
    assert.equal(await (await chainWith({ height: 1500 })).signatureOutcome(SIG, 1000), "expired");
    // blockhash recém vencido: dentro da folga ainda conta como em aberto
    assert.equal(await (await chainWith({ height: 1005 })).signatureOutcome(SIG, 1000), "pending");
    assert.equal(await (await chainWith({ height: 900 })).signatureOutcome(SIG, 1000), "pending");
    // "processed" ainda não é confirmada
    assert.equal(await (await chainWith({ status: async () => ({ err: null, confirmationStatus: "processed" }), height: 900 })).signatureOutcome(SIG, 1000), "pending");
  });
});

describe("parseTokenDeltas", () => {
  const accounts = ["a0", "buyerAta", "treasuryAta"] as never[];
  const bal = (accountIndex: number, owner: string, amount: string) => ({ accountIndex, mint: "m", owner, uiTokenAmount: { amount } });

  it("diferença entre depois e antes; ignora quem não mudou", () => {
    const deltas = parseTokenDeltas(accounts, [bal(1, "buyer", "10000000"), bal(2, "treasury", "500")], [bal(1, "buyer", "0"), bal(2, "treasury", "1000500")]);
    assert.deepEqual(
      deltas.map((x) => [x.account, x.owner, x.delta]),
      [["buyerAta", "buyer", -10_000_000n], ["treasuryAta", "treasury", 1_000_000n]],
    );
    assert.deepEqual(parseTokenDeltas(accounts, [bal(1, "buyer", "5")], [bal(1, "buyer", "5")]), []);
  });

  it("conta criada na transação (só existe depois) e conta fechada (só antes)", () => {
    const created = parseTokenDeltas(accounts, [], [bal(2, "treasury", "7")]);
    assert.equal(created[0]!.delta, 7n);
    const closed = parseTokenDeltas(accounts, [bal(1, "buyer", "9")], []);
    assert.equal(closed[0]!.delta, -9n);
    assert.deepEqual(parseTokenDeltas(accounts, null, undefined), []);
  });
});
