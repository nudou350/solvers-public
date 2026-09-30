// Abastece carteiras de teste com USDC de teste (sem o cooldown do faucet da API).
//   npx tsx src/topup.ts buyer1 buyer2 [valor]
import { usdcToUnits } from "@solvers/shared";
import { chain, key, log } from "./env.js";

const args = process.argv.slice(2);
const amount = Number(args.find((a) => /^\d+$/.test(a)) ?? 100);
const names = args.filter((a) => !/^\d+$/.test(a));
const c = await chain();
for (const n of names.length ? names : ["buyer1", "buyer2"]) {
  const k = await key(n);
  await c.faucet(k.address, usdcToUnits(amount));
  log(`${n} recebeu ${amount} USDC de teste`, k.address);
}
