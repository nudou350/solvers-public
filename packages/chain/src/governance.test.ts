import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { address, generateKeyPairSigner, getProgramDerivedAddress, getAddressEncoder } from "@solana/kit";
import * as gen from "@solvers/client";
import { PROGRAM_ID, SolversChain } from "./chain.js";

// Montadores das instruções de governança (sem rede: só derivam PDAs e montam contas).

const USDC = address("11111111111111111111111111111111");
const AGENT_ID = "0123456789abcdef0123456789abcdef";

async function setup() {
  const feePayer = await generateKeyPairSigner();
  const admin = await generateKeyPairSigner();
  const other = await generateKeyPairSigner();
  const chain = new SolversChain({ rpcUrl: "http://127.0.0.1:1", usdcMint: USDC, feePayer });
  return { chain, feePayer, admin, other };
}

const addrs = (ix: { accounts?: readonly { address: string }[] }) => (ix.accounts ?? []).map((a) => a.address);
const signers = (ix: { accounts?: readonly { address: string; signer?: unknown }[] }) => (ix.accounts ?? []).filter((a) => a.signer).map((a) => a.address);

describe("montadores de governança", () => {
  it("PendingAdmin é a PDA [pending_admin, config]", async () => {
    const { chain } = await setup();
    const [expected] = await getProgramDerivedAddress({
      programAddress: PROGRAM_ID,
      seeds: [new TextEncoder().encode("pending_admin"), getAddressEncoder().encode(await chain.configPda())],
    });
    assert.equal(await chain.pendingAdminPda(), expected);
  });

  it("propose_admin: o fee payer paga o rent, o admin assina, args = novo admin", async () => {
    const { chain, feePayer, admin, other } = await setup();
    const ix = await chain.proposeAdminIx(admin, other.address);
    assert.deepEqual(addrs(ix), [feePayer.address, admin.address, await chain.configPda(), await chain.pendingAdminPda(), "11111111111111111111111111111111"]);
    assert.deepEqual(signers(ix), [feePayer.address, admin.address]);
    assert.equal(gen.getProposeAdminInstructionDataDecoder().decode(ix.data!).newAdmin, other.address);
  });

  it("accept_admin e cancel_admin_transfer: assinam o novo admin / o admin, e o rent volta a quem pagou", async () => {
    const { chain, feePayer, admin, other } = await setup();
    const accept = await chain.acceptAdminIx(other, feePayer.address);
    assert.deepEqual(addrs(accept), [other.address, await chain.configPda(), await chain.pendingAdminPda(), feePayer.address]);
    assert.deepEqual(signers(accept), [other.address]);
    const cancel = await chain.cancelAdminTransferIx(admin, feePayer.address);
    assert.deepEqual(addrs(cancel), [admin.address, await chain.configPda(), await chain.pendingAdminPda(), feePayer.address]);
    assert.deepEqual(signers(cancel), [admin.address]);
  });

  it("set_treasury: admin assina, usa o mint da plataforma e a conta de token informada", async () => {
    const { chain, admin, other } = await setup();
    const ix = await chain.setTreasuryIx(admin, other.address);
    assert.deepEqual(addrs(ix), [admin.address, await chain.configPda(), USDC, other.address]);
    assert.deepEqual(signers(ix), [admin.address]);
  });

  it("top_up_stake: o criador assina, paga da ATA dele e deposita no cofre do solver", async () => {
    const { chain, other } = await setup();
    const ix = await chain.topUpStakeIx(other, AGENT_ID, 5_000_000n);
    const a = addrs(ix);
    assert.equal(a[0], other.address);
    assert.equal(a[2], await chain.agentPda(AGENT_ID));
    assert.equal(a[4], await chain.ata(other.address));
    assert.deepEqual(signers(ix), [other.address]);
    assert.equal(gen.getTopUpStakeInstructionDataDecoder().decode(ix.data!).amount, 5_000_000n);
  });

  it("migrate_config: o fee payer paga o rent, a upgrade authority assina, e usa o ProgramData do programa", async () => {
    const { chain, feePayer, admin } = await setup();
    const ix = await chain.migrateConfigIx(admin);
    assert.deepEqual(addrs(ix), [feePayer.address, admin.address, await chain.configPda(), PROGRAM_ID, await chain.programDataAddress(), "11111111111111111111111111111111"]);
    assert.deepEqual(signers(ix), [feePayer.address, admin.address]);
    assert.deepEqual([...ix.data!], [...gen.MIGRATE_CONFIG_DISCRIMINATOR]);
  });

  it("set_pause: quem assina é o signer (admin ou guardian) e os bits vão nos args", async () => {
    const { chain, admin, other } = await setup();
    for (const [who, flags] of [[admin, 3], [other, 1], [admin, 0]] as const) {
      const ix = await chain.setPauseIx(who, flags);
      assert.deepEqual(addrs(ix), [who.address, await chain.configPda()]);
      assert.deepEqual(signers(ix), [who.address]);
      assert.equal(gen.getSetPauseInstructionDataDecoder().decode(ix.data!).flags, flags);
    }
  });

  it("set_guardian: só o admin assina; o endereço de sistema remove o guardian", async () => {
    const { chain, admin, other } = await setup();
    const ix = await chain.setGuardianIx(admin, other.address);
    assert.deepEqual(addrs(ix), [admin.address, await chain.configPda()]);
    assert.deepEqual(signers(ix), [admin.address]);
    assert.equal(gen.getSetGuardianInstructionDataDecoder().decode(ix.data!).newGuardian, other.address);
    assert.equal(gen.getSetGuardianInstructionDataDecoder().decode((await chain.setGuardianIx(admin, address("11111111111111111111111111111111"))).data!).newGuardian, "11111111111111111111111111111111");
  });

  it("propose_slash: o fee payer paga o rent da proposta, o admin assina, args = valor e hash", async () => {
    const { chain, feePayer, admin } = await setup();
    const hash = new Uint8Array(32).fill(9);
    const ix = await chain.proposeSlashIx(admin, AGENT_ID, 3_000_000n, hash);
    const a = addrs(ix);
    assert.deepEqual([a[0], a[1], a[2], a[3]], [feePayer.address, admin.address, await chain.configPda(), await chain.agentPda(AGENT_ID)]);
    assert.deepEqual(signers(ix), [feePayer.address, admin.address]);
    const data = gen.getProposeSlashInstructionDataDecoder().decode(ix.data!);
    assert.equal(data.amount, 3_000_000n);
    assert.deepEqual([...data.reasonHash], [...hash]);
  });

  it("execute_slash e cancel_slash: o admin assina e o rent volta a quem pagou a proposta; execute usa a tesouraria e o mint", async () => {
    const { chain, feePayer, admin, other } = await setup();
    const exec = await chain.executeSlashIx(admin, AGENT_ID, other.address, feePayer.address);
    assert.deepEqual(signers(exec), [admin.address]);
    assert.ok(addrs(exec).includes(other.address) && addrs(exec).includes(feePayer.address) && addrs(exec).includes(USDC));
    const cancel = await chain.cancelSlashIx(admin, AGENT_ID, feePayer.address);
    assert.deepEqual(signers(cancel), [admin.address]);
    // o criador também assina o cancelamento (proposta vencida): mesma instrução, outro signer
    const byCreator = await chain.cancelSlashIx(other, AGENT_ID, feePayer.address);
    assert.deepEqual(signers(byCreator), [other.address]);
    assert.ok(addrs(cancel).includes(feePayer.address));
  });

  it("extend_stake_exit: o admin assina e o hash do motivo vai nos args", async () => {
    const { chain, admin } = await setup();
    const hash = new Uint8Array(32).fill(4);
    const ix = await chain.extendStakeExitIx(admin, AGENT_ID, hash);
    assert.deepEqual(signers(ix), [admin.address]);
    assert.deepEqual([...gen.getExtendStakeExitInstructionDataDecoder().decode(ix.data!).reasonHash], [...hash]);
  });
});
