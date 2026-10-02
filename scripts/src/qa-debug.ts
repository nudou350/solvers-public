// Utilitário do QA (fora do roteiro): lista e, com SUSPEND=1, suspende on-chain os Solvers de teste das rodadas anteriores
// (deixa os resíduos da devnet inertes). Uso: AGENTS=id1,id2 [SUSPEND=1] npx tsx --env-file=../apps/server/.env.qa src/qa-debug.ts
const { chain, key } = await import("./env.js");
const c = await chain();
const admin = await key("admin");
const names = ["pending", "active", "suspended", "retired"];
for (const id of (process.env.AGENTS ?? "").split(",").filter(Boolean)) {
  const acc = await c.fetchMaybeAgent(id);
  if (!acc.exists) {
    console.log(id, "não existe");
    continue;
  }
  console.log(id, acc.address, `status=${names[acc.data.status]}`, `v${acc.data.version}`, `price=${acc.data.price}`, `vendas=${acc.data.totalSales}`);
  if (process.env.SUSPEND === "1" && acc.data.status === 1) {
    const { signature } = await c.sendAsServer([await c.suspendAgentIx(admin, id)]);
    console.log("  suspenso:", signature);
  }
}
