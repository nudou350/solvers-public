// Aprovação on-chain do admin de um Solver NOVO (PACKAGE_SPEC.md 15.2/15.3): assina `approve_agent` com a carteira do admin
// (ADMIN_KEYPAIR, a carteira fria do time, fora da VPS) e dispara a finalização da publicação.
//
//   pnpm --filter @solvers/server cli:approve <slug|submissionId> [--dry-run]
//   pnpm --filter @solvers/server cli:approve:devnet <slug|submissionId>      # usa .env.devnet
//
// "Aprovar" no site não assina nada on-chain; este comando é o passo 4 da sequência. Só aprova se a conta on-chain bate com a
// versão aprovada no site (nunca assina por cima do que a revisão não viu). Atualização de Solver já aprovado não passa
// aqui: o update_version mantém o status Active e a publicação termina sozinha.

import { friendlyError, TxError } from "@solvers/chain";
import { chain, explorerUrl, initChain } from "../chain/index.js";
import { pool } from "../db/index.js";
import { env } from "../env.js";
import { ApproveError, approveOnChain } from "../publish/approve.js";
import { APPROVE_USAGE, CliUsageError, parseApproveArgs } from "../publish/cli-args.js";
import { assertNetwork, NetworkError } from "./admin-guard.js";

async function main() {
  const args = parseApproveArgs(process.argv.slice(2));
  await initChain();
  // Barreira de rede: o RPC do .env pode ser de outra rede. Vale também no --dry-run.
  const net = assertNetwork(await chain().rpc.getGenesisHash().send(), args.allowNetwork);
  if (net.warning) console.warn(net.warning);
  console.log(`rede: ${net.network} (SOLANA_CLUSTER=${env.SOLANA_CLUSTER})${args.dryRun ? "  | DRY-RUN (nada será enviado)" : ""}`);

  const r = await approveOnChain(args.ref, { dryRun: args.dryRun });
  console.log(`Submissão ${r.submissionId}: ${r.slug} v${r.version}`);
  if (r.dryRun) {
    console.log(r.step === "await-admin-approval" ? "Faria: approve_agent on-chain e a finalização da publicação." : "A cadeia já está Active: faria só a finalização da publicação.");
    return;
  }
  if (r.approveTx) console.log(`approve_agent confirmado: ${r.approveTx}\n  ${explorerUrl("tx", r.approveTx)}`);
  else console.log("o Solver já estava aprovado na cadeia (nenhuma transação enviada)");
  const f = r.finalize;
  if (!f) return;
  switch (f.outcome) {
    case "published":
      console.log(`Publicado: ${r.slug} v${f.version} está no ar.`);
      break;
    case "already_published":
      console.log("A publicação já estava concluída.");
      break;
    case "busy":
      console.log("Outro processo está finalizando esta publicação agora (o servidor, pelo evento da cadeia). Confira o estado em /admin/revisoes.");
      break;
    case "not_ready":
      console.log(`Ainda não dá para publicar: ${f.reason}`);
      process.exitCode = 1;
      break;
    case "failed":
      console.error(`A finalização falhou (a submissão ficou em publish_failed): ${f.error}\nTente de novo em /admin/revisoes (Concluir) ou rodando este comando outra vez.`);
      process.exitCode = 1;
      break;
  }
}

try {
  await main();
} catch (e) {
  if (e instanceof CliUsageError) {
    console.error(`${e.message}\n\n${APPROVE_USAGE}`);
    process.exitCode = 2;
  } else {
    const msg = e instanceof TxError ? friendlyError(e, e.logs) : e instanceof ApproveError || e instanceof NetworkError ? e.message : ((e as Error)?.message ?? String(e));
    const cause = (e as { cause?: { message?: string } })?.cause?.message;
    console.error(`Falhou: ${msg}${cause ? ` (causa: ${cause})` : ""}`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
process.exit(process.exitCode ?? 0);
