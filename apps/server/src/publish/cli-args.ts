// Argumentos de `cli:approve` e `cli:suspend` (puro, sem rede nem env: testado em test/publish-rules.test.ts).

export class CliUsageError extends Error {}

export const APPROVE_USAGE = `uso: pnpm --filter @solvers/server cli:approve <slug|submissionId> [--dry-run] [--allow-network <nome>]

  Assina o approve_agent (admin on-chain, ADMIN_KEYPAIR) do Solver NOVO que o criador já registrou e finaliza a publicação.
  Só aprova se a conta on-chain bate com a versão aprovada no site (hash, versão, preço). --dry-run só mostra o que faria.
  Só roda na devnet (confere o genesis do RPC); outra rede, de propósito: --allow-network <nome>.`;

export type ApproveArgs = { ref: string; dryRun: boolean; allowNetwork: string | null };

export function parseApproveArgs(argv: readonly string[]): ApproveArgs {
  const rest: string[] = [];
  let dryRun = false;
  let allowNetwork: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") dryRun = true;
    else if (a === "--allow-network") {
      allowNetwork = argv[++i] ?? null;
      if (!allowNetwork) throw new CliUsageError("--allow-network precisa do nome da rede");
    } else if (a.startsWith("--")) throw new CliUsageError(`opção desconhecida: ${a}`);
    else rest.push(a);
  }
  if (rest.length !== 1) throw new CliUsageError("informe um slug ou o id da submissão");
  return { ref: rest[0]!, dryRun, allowNetwork };
}

export const SUSPEND_USAGE = `uso: pnpm --filter @solvers/server cli:suspend <slug> [--resume] [--reason "<motivo>"] [--allow-network <nome>]

  Suspende o Solver: platform_status = suspended (derruba sessões abertas, vitrine e venda na hora) e suspend_agent on-chain
  (ADMIN_KEYPAIR), com trilha em package_reviews. --resume faz o caminho inverso (approve_agent on-chain e platform_status = active).
  Só roda na devnet (confere o genesis do RPC); outra rede, de propósito: --allow-network <nome>.`;

export type SuspendArgs = { ref: string; resume: boolean; reason: string | null; allowNetwork: string | null };

export function parseSuspendArgs(argv: readonly string[]): SuspendArgs {
  const rest: string[] = [];
  let resume = false;
  let reason: string | null = null;
  let allowNetwork: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--resume") resume = true;
    else if (a === "--reason") {
      reason = argv[++i] ?? null;
      if (!reason) throw new CliUsageError("--reason precisa do motivo entre aspas");
    } else if (a === "--allow-network") {
      allowNetwork = argv[++i] ?? null;
      if (!allowNetwork) throw new CliUsageError("--allow-network precisa do nome da rede");
    } else if (a.startsWith("--")) throw new CliUsageError(`opção desconhecida: ${a}`);
    else rest.push(a);
  }
  if (rest.length !== 1) throw new CliUsageError("informe o slug (ou o id) do Solver");
  return { ref: rest[0]!, resume, reason, allowNetwork };
}
