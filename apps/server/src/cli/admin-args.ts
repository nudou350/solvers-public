// Leitura (pura, sem rede e sem env) dos argumentos de `cli:admin`. Separada de admin.ts para ser testável.

import { isAddress, type Address } from "@solana/kit";

export type AdminCommand =
  | { cmd: "propose"; newAdmin: Address }
  | { cmd: "accept" }
  | { cmd: "cancel" }
  | { cmd: "set-treasury"; treasury: Address }
  | { cmd: "top-up-stake"; slug: string; amount: bigint };

export type AdminArgs = {
  command: AdminCommand;
  /** Sem --yes é dry-run: nada é enviado. */
  yes: boolean;
  /** Arquivo da chave de quem assina (accept: novo admin; top-up-stake: criador; demais: substitui ADMIN_KEYPAIR). */
  keypair: string | null;
  /** Libera, de propósito, uma rede que não é a devnet (precisa ser o nome da rede detectada). */
  allowNetwork: string | null;
};

export class UsageError extends Error {}

export const USAGE = `uso: pnpm --filter @solvers/server cli:admin <comando> [--yes] [--keypair <arquivo>]

  propose <novo-admin>         admin atual indica o novo administrador (passo 1; assina ADMIN_KEYPAIR)
  accept                       o novo administrador aceita (passo 2; assina a chave dele: use --keypair)
  cancel                       admin atual desiste da proposta pendente
  set-treasury <conta-usdc>    troca a conta de USDC da tesouraria (endereço da conta de token, não da carteira)
  top-up-stake <slug> <usdc>   o criador repõe stake do solver (assina a chave do criador; reativar exige approve_agent)

Sem --yes é dry-run: imprime contas, quem assina, saldo/taxa e o resultado da simulação, sem enviar nada.
--keypair <arquivo> aponta o arquivo da chave de quem assina (nunca é impressa).
O comando só roda na devnet (confere o genesis hash do RPC e aborta, até no dry-run). Para outra rede, de propósito:
--allow-network <nome>, onde nome = rede detectada (mainnet-beta ou desconhecida).`;

/** Valor em USDC como texto decimal ("5", "12.5", "0.000001"): até 6 casas, maior que zero, sem float. */
export function parseUsdcAmount(text: string): bigint {
  const m = /^(\d+)(?:[.,](\d{1,6}))?$/.exec(text.trim());
  if (!m) throw new UsageError(`valor em USDC inválido: "${text}" (use números como 5 ou 12.5, até 6 casas)`);
  const units = BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
  if (units <= 0n) throw new UsageError("o valor em USDC deve ser maior que zero");
  return units;
}

function addressArg(value: string | undefined, what: string): Address {
  if (!value) throw new UsageError(`falta ${what}`);
  if (!isAddress(value)) throw new UsageError(`${what} inválido: "${value}" não é um endereço`);
  return value;
}

export function parseAdminArgs(argv: readonly string[]): AdminArgs {
  let yes = false;
  let keypair: string | null = null;
  let allowNetwork: string | null = null;
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--yes") yes = true;
    else if (a === "--keypair") {
      keypair = argv[++i] ?? null;
      if (!keypair || keypair.startsWith("--")) throw new UsageError("--keypair precisa do caminho de um arquivo");
    } else if (a === "--allow-network") {
      allowNetwork = argv[++i] ?? null;
      if (!allowNetwork || allowNetwork.startsWith("--")) throw new UsageError("--allow-network precisa do nome da rede (mainnet-beta ou desconhecida)");
    } else if (a.startsWith("--")) throw new UsageError(`opção desconhecida: ${a}`);
    else pos.push(a);
  }
  const [name, ...rest] = pos;
  const expect = (n: number, shape: string) => {
    if (rest.length !== n) throw new UsageError(`uso: ${name} ${shape}`.trim());
  };
  switch (name) {
    case "propose":
      expect(1, "<novo-admin>");
      return { command: { cmd: "propose", newAdmin: addressArg(rest[0], "o novo admin") }, yes, keypair, allowNetwork };
    case "accept":
      expect(0, "");
      return { command: { cmd: "accept" }, yes, keypair, allowNetwork };
    case "cancel":
      expect(0, "");
      return { command: { cmd: "cancel" }, yes, keypair, allowNetwork };
    case "set-treasury":
      expect(1, "<conta-usdc>");
      return { command: { cmd: "set-treasury", treasury: addressArg(rest[0], "a conta de USDC") }, yes, keypair, allowNetwork };
    case "top-up-stake":
      expect(2, "<slug> <usdc>");
      return { command: { cmd: "top-up-stake", slug: rest[0]!, amount: parseUsdcAmount(rest[1]!) }, yes, keypair, allowNetwork };
    default:
      throw new UsageError(name ? `comando desconhecido: ${name}` : "falta o comando");
  }
}
