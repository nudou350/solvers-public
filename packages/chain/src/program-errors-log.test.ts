import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { address, generateKeyPairSigner } from "@solana/kit";
import { PROGRAM_ID, SolversChain, friendlyError } from "./chain.js";
import { describeFailure, extractProgramErrorCode, programErrorName } from "./program-errors.js";

// Classificação do erro pelo log e simulação antes da assinatura (RPC simulado, sem rede).
// Os logs seguem o formato real do runtime Solana (ComputeBudget, invoke [n], CPI, consumed, failed).

const PROGRAM = PROGRAM_ID;
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const BUDGET = "ComputeBudget111111111111111111111111111111";
const opening = [`Program ${BUDGET} invoke [1]`, `Program ${BUDGET} success`, `Program ${PROGRAM} invoke [1]`];

/** Erro direto do programa (AgentNotActive = 6004 = 0x1774). */
const directError = [
  ...opening,
  "Program log: Instruction: PurchaseLicense",
  "Program log: AnchorError thrown in programs/solvers/src/instructions/license.rs:41. Error Code: AgentNotActive. Error Number: 6004. Error Message: Solver não está ativo.",
  `Program ${PROGRAM} consumed 14210 of 400000 compute units`,
  `Program ${PROGRAM} failed: custom program error: 0x1774`,
];

/** CPI de token sem saldo: o token falha primeiro (0x1) e a linha EXTERNA do Solvers repete o mesmo código. */
const tokenCpiInsufficient = [
  ...opening,
  "Program log: Instruction: PurchaseLicense",
  `Program ${TOKEN} invoke [2]`,
  "Program log: Instruction: TransferChecked",
  "Program log: Error: insufficient funds",
  `Program ${TOKEN} consumed 6199 of 372100 compute units`,
  `Program ${TOKEN} failed: custom program error: 0x1`,
  `Program ${PROGRAM} consumed 31000 of 400000 compute units`,
  `Program ${PROGRAM} failed: custom program error: 0x1`,
];

/** Constraint do Anchor (ConstraintTokenOwner = 2015 = 0x7df). */
const anchorConstraint = [
  ...opening,
  "Program log: Instruction: PurchaseLicense",
  "Program log: AnchorError caused by account: buyer_usdc. Error Code: ConstraintTokenOwner. Error Number: 2015. Error Message: A token owner constraint was violated.",
  "Program log: Left:",
  "Program log: 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  `Program ${PROGRAM} consumed 9100 of 400000 compute units`,
  `Program ${PROGRAM} failed: custom program error: 0x7df`,
];

describe("classificação do erro pelo log", () => {
  it("erro direto do programa: código do enum, nome e mensagem", () => {
    assert.equal(extractProgramErrorCode(null, directError), 6004);
    assert.equal(programErrorName(6004), "AgentNotActive");
    assert.deepEqual(describeFailure(null, directError), { code: 6004, name: "AgentNotActive", message: "Este especialista ainda não está disponível para compra." });
  });

  it("CPI de token sem saldo: vale o PRIMEIRO failed (token 0x1), não o código repetido pelo Solvers", () => {
    assert.equal(extractProgramErrorCode(null, tokenCpiInsufficient), null);
    assert.deepEqual(describeFailure(null, tokenCpiInsufficient), { code: null, name: null, message: "Saldo de USDC insuficiente." });
    assert.equal(friendlyError(new Error("x"), tokenCpiInsufficient), "Saldo de USDC insuficiente.");
  });

  it("constraint do Anchor: mensagem amigável por nome, sem código do programa", () => {
    assert.equal(extractProgramErrorCode(null, anchorConstraint), null);
    const r = describeFailure(null, anchorConstraint);
    assert.equal(r?.code, null);
    assert.match(r!.message, /saldo em USDC não pertence a esta carteira/);
    assert.match(friendlyError(new Error("x"), anchorConstraint), /não pertence a esta carteira/);
  });

  it("nome do Anchor desconhecido, outro programa ou erro sem código: sem classificação (cai no motivo bruto)", () => {
    const unknownAnchor = anchorConstraint.map((l) => l.replace("ConstraintTokenOwner", "ConstraintNovoDesconhecido"));
    assert.equal(describeFailure(null, unknownAnchor), null);
    const core = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
    const otherProgram = [...opening, `Program ${core} invoke [2]`, `Program ${core} failed: custom program error: 0x7`, `Program ${PROGRAM} failed: custom program error: 0x7`];
    assert.equal(describeFailure(null, otherProgram), null);
    const noCode = [...opening, "Program log: algo deu errado", `Program ${PROGRAM} failed: Program failed to complete`];
    assert.equal(describeFailure(null, noCode), null);
    assert.equal(friendlyError(new Error("Transaction simulation failed"), noCode), "Transaction simulation failed");
    assert.equal(describeFailure(null, []), null);
  });

  it("token com outro código que não saldo (0x3): sem classificação", () => {
    const logs = [...opening, `Program ${TOKEN} invoke [2]`, `Program ${TOKEN} failed: custom program error: 0x3`, `Program ${PROGRAM} failed: custom program error: 0x3`];
    assert.equal(describeFailure(null, logs), null);
  });

  it("sem linha 'failed' (log cortado): usa o erro estruturado só se o número é código do programa", () => {
    assert.equal(extractProgramErrorCode({ InstructionError: [1, { Custom: 6011 }] }), 6011);
    assert.equal(extractProgramErrorCode({ InstructionError: [1, { Custom: 1 }] }), null);
    assert.equal(extractProgramErrorCode(Object.assign(new Error("x"), { cause: { context: { code: 6026, index: 1 } } })), 6026);
  });
});

describe("friendlyError com o mapa completo", () => {
  it("erro do programa fora dos 8 antigos agora tem mensagem amigável", () => {
    const logs = [...opening, "Program log: AnchorError thrown in programs/solvers/src/lib.rs:1. Error Code: PriceChanged. Error Number: 6026. Error Message: O preço mudou.", `Program ${PROGRAM} failed: custom program error: 0x178a`];
    assert.match(friendlyError(new Error("x"), logs), /preço mudou/i);
  });

  it("logs só com o nome (sem a linha failed): continua achando o erro; nome longo não é mascarado pelo curto", () => {
    assert.match(friendlyError(new Error("x"), ["Program log: Error Code: NotRentPayer"]), /pagou a abertura/);
    assert.match(friendlyError(new Error("x"), ["Error Code: InvalidMilestoneIndex"]), /não existe/);
    assert.match(friendlyError(new Error("x"), ["Error Code: InvalidMilestones"]), /número de etapas/);
    assert.equal(friendlyError(new Error("x"), ["Program log: Error: insufficient funds"]), "Saldo de USDC insuficiente.");
    assert.equal(friendlyError(new Error("x"), ["Program log: AnchorError ... NoCredits ..."]), "Seus créditos acabaram.");
  });

  it("erro desconhecido: mantém o motivo bruto", () => {
    assert.equal(friendlyError(new Error("fetch failed"), []), "fetch failed");
  });
});

// ---------- simulate ----------

type Sim = { err: unknown; logs?: readonly string[] | null; unitsConsumed?: bigint };

async function chainSimulating(run: (config: unknown) => Promise<{ value: Sim }>) {
  const c = new SolversChain({ rpcUrl: "http://127.0.0.1:1", usdcMint: address("11111111111111111111111111111111"), feePayer: await generateKeyPairSigner() });
  const calls: unknown[] = [];
  (c as unknown as { rpc: unknown }).rpc = {
    simulateTransaction: (_wire: unknown, config: unknown) => ({
      send: async (o?: { abortSignal?: AbortSignal }) => {
        calls.push({ config, hasAbort: !!o?.abortSignal });
        return run(config);
      },
    }),
  };
  return { c, calls };
}

const WIRE = "wire" as never;

describe("simulate (antes da assinatura)", () => {
  it("sem assinaturas e com blockhash novo: sigVerify false, replaceRecentBlockhash true, confirmed, com timeout", async () => {
    const { c, calls } = await chainSimulating(async () => ({ value: { err: null, logs: [], unitsConsumed: 1234n } }));
    assert.deepEqual(await c.simulate(WIRE), { ok: true, unitsConsumed: 1234n });
    assert.deepEqual(calls, [{ config: { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }, hasAbort: true }]);
  });

  it("erro direto do programa: rejected com mensagem amigável e nome", async () => {
    const { c } = await chainSimulating(async () => ({ value: { err: { InstructionError: [1, { Custom: 6004 }] }, logs: directError } }));
    const r = await c.simulate(WIRE);
    assert.deepEqual(r.ok === false && r.kind === "rejected" && { code: r.code, name: r.name, message: r.message }, {
      code: 6004,
      name: "AgentNotActive",
      message: "Este especialista ainda não está disponível para compra.",
    });
  });

  it("código do programa ainda sem texto: rejected com mensagem genérica (nunca vazia)", async () => {
    const logs = [...opening, `Program ${PROGRAM} failed: custom program error: 0x1b57`];
    const { c } = await chainSimulating(async () => ({ value: { err: { InstructionError: [1, { Custom: 6999 }] }, logs } }));
    const r = await c.simulate(WIRE);
    assert.ok(!r.ok && r.kind === "rejected" && r.code === 6999 && /6999/.test(r.message));
  });

  it("CPI de token sem saldo (log externo do Solvers repete 0x1): rejected como saldo insuficiente, não 'código 1'", async () => {
    const { c } = await chainSimulating(async () => ({ value: { err: { InstructionError: [1, { Custom: 1 }] }, logs: tokenCpiInsufficient } }));
    const r = await c.simulate(WIRE);
    assert.ok(!r.ok && r.kind === "rejected" && r.code === null && r.message === "Saldo de USDC insuficiente.");
  });

  it("constraint do Anchor: rejected com mensagem amigável; nome desconhecido: failed (não bloqueia)", async () => {
    const { c } = await chainSimulating(async () => ({ value: { err: { InstructionError: [1, { Custom: 2015 }] }, logs: anchorConstraint } }));
    const r = await c.simulate(WIRE);
    assert.ok(!r.ok && r.kind === "rejected" && /não pertence a esta carteira/.test(r.message));
    const unknown = anchorConstraint.map((l) => l.replace("ConstraintTokenOwner", "ConstraintNovoDesconhecido"));
    const { c: c2 } = await chainSimulating(async () => ({ value: { err: { InstructionError: [1, { Custom: 2015 }] }, logs: unknown } }));
    const r2 = await c2.simulate(WIRE);
    assert.ok(!r2.ok && r2.kind === "failed");
  });

  it("log sem código e outros erros da simulação (blockhash, orçamento): failed, não rejected", async () => {
    const { c } = await chainSimulating(async () => ({ value: { err: "BlockhashNotFound", logs: null } }));
    const r = await c.simulate(WIRE);
    assert.ok(!r.ok && r.kind === "failed" && /BlockhashNotFound/.test(r.message));
    const logs = [...opening, `Program ${PROGRAM} consumed 400000 of 400000 compute units`, `Program ${PROGRAM} failed: exceeded CUs meter at BPF instruction`];
    const { c: c2 } = await chainSimulating(async () => ({ value: { err: { InstructionError: [1, "ComputationalBudgetExceeded"] }, logs } }));
    const r2 = await c2.simulate(WIRE);
    assert.ok(!r2.ok && r2.kind === "failed");
  });

  it("RPC fora do ar ou timeout: infra, sem lançar", async () => {
    const { c } = await chainSimulating(async () => {
      throw new Error("fetch failed (https://rpc.exemplo.com/?api-key=SEGREDO)");
    });
    const r = await c.simulate(WIRE);
    assert.ok(!r.ok && r.kind === "infra");
    assert.doesNotMatch(r.message, /SEGREDO|https?:/);
  });
});
