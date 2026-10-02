import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { SYNC_OK, SYNC_UNAPPROVED, chainMatchesApproved, syncFlagFor, withApprovalFlag, type ApprovedVersion, type ChainVersion } from "../src/indexer/approved-version.js";
import { CREATOR_SIGNING_STEPS } from "@solvers/shared";
import { isAdminIn, parseAdminWallets } from "../src/publish/admin-rules.js";
import {
  nextPublicationStep,
  parseApproved,
  statusAfterChain,
  stepMismatch,
  type ApprovedRecord,
  type ChainAgentState,
} from "../src/publish/approval-rules.js";
import { CliUsageError, parseApproveArgs, parseSuspendArgs } from "../src/publish/cli-args.js";

// Regras puras da publicação on-chain (PACKAGE_SPEC.md 15): versão aprovada x cadeia, passo seguinte, estado da submissão e
// argumentos dos CLIs. Sem env, banco nem rede.

const H1 = "a1".repeat(32);
const H2 = "b2".repeat(32);
const H3 = "c3".repeat(32);
const approvedRows: ApprovedVersion[] = [
  { version: "1.0.0", versionHash: H1, priceUsdc: 10_000_000n },
  { version: "1.1.0", versionHash: H2, priceUsdc: 12_000_000n },
];
const onchain = (over: Partial<ChainVersion> = {}): ChainVersion => ({ version: "1.1.0", versionHash: H2, price: 12_000_000n, ...over });

describe("cadeia x versão aprovada (indexador, PACKAGE_SPEC.md 15.4)", () => {
  it("versão, hash e preço batendo com uma aprovada: ok", () => {
    assert.equal(syncFlagFor(onchain(), approvedRows), SYNC_OK);
    assert.equal(chainMatchesApproved(onchain({ versionHash: H2.toUpperCase() }), approvedRows), true, "hex em maiúsculas não diverge");
  });

  it("o criador pode reverter para uma versão que já foi aprovada", () => {
    assert.equal(syncFlagFor(onchain({ version: "1.0.0", versionHash: H1, price: 10_000_000n }), approvedRows), SYNC_OK);
  });

  it("hash novo (update_version direto na cadeia) diverge", () => {
    assert.equal(syncFlagFor(onchain({ versionHash: H3 }), approvedRows), SYNC_UNAPPROVED);
  });

  it("só o preço mudado (update_pricing direto) diverge", () => {
    assert.equal(syncFlagFor(onchain({ price: 1_000_000n }), approvedRows), SYNC_UNAPPROVED);
  });

  it("versão aprovada com o hash de OUTRA versão diverge (não mistura as linhas)", () => {
    assert.equal(syncFlagFor(onchain({ version: "1.0.0", versionHash: H2 }), approvedRows), SYNC_UNAPPROVED);
  });

  it("sem nenhuma versão aprovada (registrado fora da plataforma): diverge", () => {
    assert.equal(syncFlagFor(onchain(), []), SYNC_UNAPPROVED);
  });

  it("uma nova aprovação cobrindo o hash volta a ok", () => {
    const chain = onchain({ versionHash: H3, version: "1.2.0", price: 9_000_000n });
    assert.equal(syncFlagFor(chain, approvedRows), SYNC_UNAPPROVED);
    assert.equal(syncFlagFor(chain, [...approvedRows, { version: "1.2.0", versionHash: H3, priceUsdc: 9_000_000n }]), SYNC_OK);
  });

  it("withApprovalFlag: aprovado copia tudo; divergente REMOVE versão, hash e preço do que seria gravado", () => {
    const base = { version: "1.1.0", versionHash: H2, price: 12_000_000n, status: "active", totalSales: 3n };
    assert.deepEqual(withApprovalFlag(base, approvedRows), { ...base, syncFlag: SYNC_OK });
    const diverged = withApprovalFlag({ ...base, versionHash: H3, price: 1n }, approvedRows);
    assert.equal(diverged.syncFlag, SYNC_UNAPPROVED);
    assert.equal("version" in diverged, false);
    assert.equal("versionHash" in diverged, false);
    assert.equal("price" in diverged, false);
    // o resto do espelho (status, vendas...) continua sendo o da cadeia
    assert.equal((diverged as unknown as { status: string }).status, "active");
    assert.equal((diverged as unknown as { totalSales: bigint }).totalSales, 3n);
  });
});

const approved = (over: Partial<ApprovedRecord> = {}): ApprovedRecord => ({ versionHash: H2, priceUsdc: "12000000", royaltyBps: 500, name: "Meu Solver", version: "1.1.0", ...over });
const state = (over: Partial<Extract<ChainAgentState, { exists: true }>> = {}): ChainAgentState => ({
  exists: true,
  address: "AgentPda",
  creator: "Criador",
  version: "1.1.0",
  versionHash: H2,
  price: 12_000_000n,
  status: "active",
  ...over,
});

describe("nextPublicationStep: o que falta, lido da cadeia", () => {
  it("conta inexistente: o criador registra", () => {
    assert.equal(nextPublicationStep(approved(), { exists: false }), "register-agent");
  });

  it("Solver novo registrado (Pending): falta o admin; Active: pronto", () => {
    assert.equal(nextPublicationStep(approved(), state({ status: "pending" })), "await-admin-approval");
    assert.equal(nextPublicationStep(approved(), state({ status: "active" })), "ready");
  });

  it("atualização: versão/hash diferentes pedem update_version; depois, preço diferente pede update_pricing", () => {
    assert.equal(nextPublicationStep(approved(), state({ version: "1.0.0", versionHash: H1 })), "update-version");
    assert.equal(nextPublicationStep(approved(), state({ versionHash: H1 })), "update-version", "mesma versão, hash diferente");
    assert.equal(nextPublicationStep(approved(), state({ price: 10_000_000n })), "update-pricing");
  });

  it("suspenso ou aposentado na cadeia: bloqueado (nada a assinar)", () => {
    assert.equal(nextPublicationStep(approved(), state({ status: "suspended" })), "blocked");
    assert.equal(nextPublicationStep(approved(), state({ status: "retired" })), "blocked");
  });

  it("conta de OUTRO criador bloqueia quem pergunta (has_one = creator recusaria a transação)", () => {
    assert.equal(nextPublicationStep(approved(), state({ creator: "Outro" }), "Criador"), "blocked");
    assert.equal(nextPublicationStep(approved(), state({ creator: "Criador" }), "Criador"), "ready");
  });

  it("os passos do criador e o passo pedido errado", () => {
    assert.deepEqual([...CREATOR_SIGNING_STEPS].sort(), ["register-agent", "update-pricing", "update-version"]);
    assert.equal(stepMismatch("update-version", "update-version"), null);
    assert.equal(stepMismatch("register-agent", "update-version"), "update-version");
  });
});

describe("statusAfterChain: a submissão nunca regride", () => {
  it("pronto: finaliza; aguardando admin: avança; senão fica", () => {
    assert.equal(statusAfterChain("awaiting_creator_signature", "ready"), "finalize");
    assert.equal(statusAfterChain("awaiting_onchain_approval", "ready"), "finalize");
    assert.equal(statusAfterChain("awaiting_creator_signature", "await-admin-approval"), "awaiting_onchain_approval");
    assert.equal(statusAfterChain("awaiting_onchain_approval", "register-agent"), "awaiting_onchain_approval");
    assert.equal(statusAfterChain("awaiting_creator_signature", "update-version"), "awaiting_creator_signature");
  });

  it("estados fora da publicação não mexem", () => {
    assert.equal(statusAfterChain("published", "ready"), "published");
    assert.equal(statusAfterChain("pending_review", "ready"), "pending_review");
    assert.equal(statusAfterChain("suspended", "ready"), "suspended");
  });
});

describe("parseApproved: o registro aprovado é confiado só com o formato certo", () => {
  it("aceita o registro da aprovação", () => {
    assert.deepEqual(parseApproved(approved()), approved());
  });
  it("recusa hash curto, preço não numérico, royalty fora da faixa e campos faltando", () => {
    assert.equal(parseApproved(null), null);
    assert.equal(parseApproved({ ...approved(), versionHash: "abc" }), null);
    assert.equal(parseApproved({ ...approved(), priceUsdc: "12.5" }), null);
    assert.equal(parseApproved({ ...approved(), priceUsdc: 12 }), null);
    assert.equal(parseApproved({ ...approved(), royaltyBps: 10_001 }), null);
    assert.equal(parseApproved({ ...approved(), name: "" }), null);
    assert.equal(parseApproved({ versionHash: H1 }), null);
  });
});

describe("admin do site (ADMIN_WALLETS)", () => {
  it("lista separada por vírgula, com espaços e vazios", () => {
    assert.deepEqual([...parseAdminWallets(" A , B,, C ,")], ["A", "B", "C"]);
    assert.equal(isAdminIn("B", "A,B"), true);
    assert.equal(isAdminIn("X", "A,B"), false);
    assert.equal(isAdminIn("A", ""), false, "sem lista, ninguém é admin");
  });
});

describe("argumentos de cli:approve e cli:suspend", () => {
  it("approve: slug ou id, --dry-run, --allow-network", () => {
    assert.deepEqual(parseApproveArgs(["meu-solver"]), { ref: "meu-solver", dryRun: false, allowNetwork: null });
    assert.deepEqual(parseApproveArgs(["--dry-run", "sub123", "--allow-network", "mainnet-beta"]), { ref: "sub123", dryRun: true, allowNetwork: "mainnet-beta" });
    assert.throws(() => parseApproveArgs([]), CliUsageError);
    assert.throws(() => parseApproveArgs(["a", "b"]), CliUsageError);
    assert.throws(() => parseApproveArgs(["a", "--yes"]), CliUsageError);
    assert.throws(() => parseApproveArgs(["a", "--allow-network"]), CliUsageError);
  });

  it("suspend: slug, --resume, --reason", () => {
    assert.deepEqual(parseSuspendArgs(["meu-solver"]), { ref: "meu-solver", resume: false, reason: null, allowNetwork: null });
    assert.deepEqual(parseSuspendArgs(["meu-solver", "--resume"]), { ref: "meu-solver", resume: true, reason: null, allowNetwork: null });
    assert.deepEqual(parseSuspendArgs(["x", "--reason", "conteúdo copiado"]), { ref: "x", resume: false, reason: "conteúdo copiado", allowNetwork: null });
    assert.throws(() => parseSuspendArgs([]), CliUsageError);
    assert.throws(() => parseSuspendArgs(["x", "--reason"]), CliUsageError);
  });
});
