// Kill switch do admin (PACKAGE_SPEC.md 15.4): suspende (ou reativa com --resume) um Solver na plataforma E na cadeia.
//
//   pnpm --filter @solvers/server cli:suspend <slug> [--reason "<motivo>"]
//   pnpm --filter @solvers/server cli:suspend <slug> --resume
//   pnpm --filter @solvers/server cli:suspend:devnet <slug>                  # usa .env.devnet
//
// 1) agents.platform_status (coluna que o indexador nunca escreve): derruba sessões abertas, vitrine e venda na hora;
// 2) suspend_agent on-chain com ADMIN_KEYPAIR (sem isso a compra direta pela cadeia continuaria possível; fecha DEF-22);
// 3) trilha em package_reviews (suspend/resume) e a submissão published <-> suspended.

import { friendlyError, TxError } from "@solvers/chain";
import { chain, explorerUrl, initChain } from "../chain/index.js";
import { pool } from "../db/index.js";
import { env } from "../env.js";
import { CliUsageError, parseSuspendArgs, SUSPEND_USAGE } from "../publish/cli-args.js";
import { suspendSolver, SuspendError } from "../publish/suspend.js";
import { assertNetwork, NetworkError } from "./admin-guard.js";

async function main() {
  const args = parseSuspendArgs(process.argv.slice(2));
  await initChain();
  const net = assertNetwork(await chain().rpc.getGenesisHash().send(), args.allowNetwork);
  if (net.warning) console.warn(net.warning);
  console.log(`rede: ${net.network} (SOLANA_CLUSTER=${env.SOLANA_CLUSTER})`);

  const r = await suspendSolver(args.ref, { resume: args.resume, reason: args.reason ?? undefined });
  console.log(`${r.action === "suspend" ? "Suspenso" : "Reativado"}: ${r.slug} (${r.agentId})`);
  console.log(`  plataforma: ${r.platformChanged ? "platform_status alterado" : "já estava assim"}`);
  console.log(`  cadeia: ${r.chainTx ? `${r.chainTx}\n    ${explorerUrl("tx", r.chainTx)}` : "nada a fazer (conta já no estado pedido, ou Solver só do banco)"}`);
  if (r.submissionId) console.log(`  submissão: ${r.submissionId}`);
}

try {
  await main();
} catch (e) {
  if (e instanceof CliUsageError) {
    console.error(`${e.message}\n\n${SUSPEND_USAGE}`);
    process.exitCode = 2;
  } else {
    const msg = e instanceof TxError ? friendlyError(e, e.logs) : e instanceof SuspendError || e instanceof NetworkError ? e.message : ((e as Error)?.message ?? String(e));
    console.error(`Falhou: ${msg}`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
process.exit(process.exitCode ?? 0);
