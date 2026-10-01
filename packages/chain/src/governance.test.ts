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
});
