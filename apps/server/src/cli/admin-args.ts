// Leitura (pura, sem rede e sem env) dos argumentos de `cli:admin`. Separada de admin.ts para ser testável.

import { createHash } from "node:crypto";
import { isAddress, type Address } from "@solana/kit";
import { PAUSE_ENTRIES, PAUSE_MASK, PAUSE_PAYMENTS } from "@solvers/chain";

/** Endereço do programa de sistema (`Pubkey::default()`): é como o programa representa "sem guardian". */
export const NO_GUARDIAN = "11111111111111111111111111111111" as Address;

export type AdminCommand =
  | { cmd: "propose"; newAdmin: Address }
  | { cmd: "accept" }
  | { cmd: "cancel" }
  | { cmd: "set-treasury"; treasury: Address }
  | { cmd: "top-up-stake"; slug: string; amount: bigint }
  | { cmd: "propose-slash"; slug: string; amount: bigint; reason: string }
  | { cmd: "execute-slash"; slug: string }
  | { cmd: "cancel-slash"; slug: string }
  | { cmd: "extend-stake-exit"; slug: string; reason: string }
  | { cmd: "migrate-config" }
  | { cmd: "set-pause"; flags: number }
  | { cmd: "set-guardian"; guardian: Address | null };

export type AdminArgs = {
  command: AdminCommand;
  /** Sem --yes é dry-run: nada é enviado. */
  yes: boolean;
  /**
   * Arquivo da chave de quem assina (accept: novo admin; top-up-stake: criador; migrate-config: upgrade authority;
   * set-pause: admin ou guardian; demais: substitui ADMIN_KEYPAIR).
   */
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
  propose-slash <slug> <usdc> <motivo>   admin propõe confiscar stake (suspende o solver; só executável após 72 h). reason_hash = sha256 do motivo
  execute-slash <slug>         admin executa o confisco depois das 72 h (o dry-run mostra quanto falta)
  cancel-slash <slug>          admin desiste da proposta (o solver segue suspenso até approve_agent)
  extend-stake-exit <slug> <motivo>   admin estende em 30 dias a espera da saída de stake (máximo 2 vezes)
  migrate-config               migra a Config v1 (187 bytes) para a v2 (285); assina a UPGRADE AUTHORITY (--keypair); o fee payer paga o rent
  set-pause <flags>            pausa de emergência: none | entradas | pagamentos | tudo (ou 0 a 3); admin liga e desliga, guardian só liga
  set-guardian <endereço|none> define (ou remove, com none) o guardian da pausa; só o admin

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

/** `none` (0) | `entradas` (bit 1) | `pagamentos` (bit 2) | `tudo` (3) | número 0 a 3. Nunca aceita bit fora da máscara. */
export function parsePauseFlags(text: string | undefined): number {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) throw new UsageError("falta o valor da pausa: none | entradas | pagamentos | tudo");
  const named: Record<string, number> = { none: 0, entradas: PAUSE_ENTRIES, pagamentos: PAUSE_PAYMENTS, tudo: PAUSE_MASK };
  if (t in named) return named[t]!;
  if (/^\d+$/.test(t) && Number(t) <= PAUSE_MASK) return Number(t);
  throw new UsageError(`valor de pausa inválido: "${text}" (use none, entradas, pagamentos, tudo, ou um número de 0 a ${PAUSE_MASK})`);
}

/** reason_hash on-chain: sha256 do motivo (texto UTF-8, sem espaços nas pontas). Quem audita refaz a conta com o mesmo texto. */
export function reasonHashOf(reason: string): Uint8Array {
  const text = reason.trim();
  if (!text) throw new UsageError("falta o motivo (texto que vira o reason_hash, sha256)");
  return Uint8Array.from(createHash("sha256").update(text, "utf8").digest());
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
    case "propose-slash":
      expect(3, "<slug> <usdc> <motivo>");
      reasonHashOf(rest[2]!);
      return { command: { cmd: "propose-slash", slug: rest[0]!, amount: parseUsdcAmount(rest[1]!), reason: rest[2]!.trim() }, yes, keypair, allowNetwork };
    case "execute-slash":
      expect(1, "<slug>");
      return { command: { cmd: "execute-slash", slug: rest[0]! }, yes, keypair, allowNetwork };
    case "cancel-slash":
      expect(1, "<slug>");
      return { command: { cmd: "cancel-slash", slug: rest[0]! }, yes, keypair, allowNetwork };
    case "extend-stake-exit":
      expect(2, "<slug> <motivo>");
      reasonHashOf(rest[1]!);
      return { command: { cmd: "extend-stake-exit", slug: rest[0]!, reason: rest[1]!.trim() }, yes, keypair, allowNetwork };
    case "migrate-config":
      expect(0, "");
      return { command: { cmd: "migrate-config" }, yes, keypair, allowNetwork };
    case "set-pause":
      expect(1, "<none|entradas|pagamentos|tudo>");
      return { command: { cmd: "set-pause", flags: parsePauseFlags(rest[0]) }, yes, keypair, allowNetwork };
    case "set-guardian":
      expect(1, "<endereço|none>");
      return {
        command: { cmd: "set-guardian", guardian: rest[0]!.toLowerCase() === "none" ? null : addressArg(rest[0], "o guardian") },
        yes,
        keypair,
        allowNetwork,
      };
    default:
      throw new UsageError(name ? `comando desconhecido: ${name}` : "falta o comando");
  }
}
