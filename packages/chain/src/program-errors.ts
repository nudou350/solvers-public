import * as gen from "@solvers/client";

/**
 * Mensagens (para quem usa a plataforma, sem jargão) de CADA erro do programa, em inglês. A lista de erros vem do
 * cliente gerado (`SOLVERS_ERROR__*`); `satisfies Record<SolversError, string>` quebra o typecheck e o teste
 * `program-errors.test.ts` falha se um erro novo do programa ficar sem texto.
 */
export const PROGRAM_ERROR_MESSAGES = {
  [gen.SOLVERS_ERROR__NOT_ADMIN]: "Only the platform administrators can do this.",
  [gen.SOLVERS_ERROR__NOT_VERIFIER]: "Only the platform verifier can do this.",
  [gen.SOLVERS_ERROR__NOT_USAGE_AUTHORITY]: "This action can only be performed by the platform's system.",
  [gen.SOLVERS_ERROR__NOT_CREATOR]: "Only the creator of this solver can do this.",
  [gen.SOLVERS_ERROR__AGENT_NOT_ACTIVE]: "This solver isn't available for purchase yet.",
  [gen.SOLVERS_ERROR__AGENT_NOT_PENDING]: "This solver isn't waiting for approval.",
  [gen.SOLVERS_ERROR__STRING_TOO_LONG]: "Some text is longer than allowed. Shorten it and try again.",
  [gen.SOLVERS_ERROR__INVALID_BPS]: "A percentage you entered is invalid. Check the values and try again.",
  [gen.SOLVERS_ERROR__PRICE_TOO_LOW]: "The price is below the platform minimum.",
  [gen.SOLVERS_ERROR__PAY_PER_USE_DISABLED]: "This solver doesn't accept pay-per-use. Buy the license to use it.",
  [gen.SOLVERS_ERROR__INVALID_AMOUNT]: "The quantity or amount you entered is invalid. Check it and try again.",
  [gen.SOLVERS_ERROR__NO_CREDITS]: "You've run out of credits.",
  [gen.SOLVERS_ERROR__INVALID_RATING]: "The rating must be from 1 to 5.",
  [gen.SOLVERS_ERROR__NO_LICENSE]: "You need a license for this solver to review it.",
  [gen.SOLVERS_ERROR__INVALID_TOKEN_ACCOUNT]:
    "Your USDC balance account isn't valid for this operation. Refresh the page and try again; if it keeps happening, contact support.",
  [gen.SOLVERS_ERROR__INVALID_LICENSE_ACCOUNT]: "The license provided isn't valid for this solver. Refresh the page and try again.",
  [gen.SOLVERS_ERROR__INVALID_MILESTONES]: "The number of milestones is invalid: use 1 to 5 milestones.",
  [gen.SOLVERS_ERROR__INVALID_MILESTONE_INDEX]: "This milestone doesn't exist in this guarantee.",
  [gen.SOLVERS_ERROR__INVALID_MILESTONE_STATUS]: "This milestone isn't in the right state for this action.",
  [gen.SOLVERS_ERROR__AUTO_RELEASE_NOT_REACHED]: "The automatic release deadline hasn't arrived yet.",
  [gen.SOLVERS_ERROR__DISPUTE_WINDOW_CLOSED]: "The deadline to dispute this milestone has passed.",
  [gen.SOLVERS_ERROR__NOT_BUYER]: "Only the person who created this guarantee can do this.",
  [gen.SOLVERS_ERROR__BUYER_NOT_ELIGIBLE]: "Your account can't open new guarantees right now.",
  [gen.SOLVERS_ERROR__INSUFFICIENT_STAKE]: "The creator's security deposit isn't enough for this operation.",
  [gen.SOLVERS_ERROR__MATH_OVERFLOW]: "The amount you entered is too large. Use a smaller amount.",
  [gen.SOLVERS_ERROR__INVALID_REVIEW_WINDOW]: "The review period you entered is invalid.",
  [gen.SOLVERS_ERROR__PRICE_CHANGED]: "The price changed. Refresh the page to see the new price and try again.",
  [gen.SOLVERS_ERROR__LICENSE_ALREADY_REVIEWED]: "You've already reviewed this solver with this license.",
  [gen.SOLVERS_ERROR__INVALID_DELIVERY_DAYS]: "The delivery deadline is invalid: choose up to 60 days.",
  [gen.SOLVERS_ERROR__DELIVERY_DEADLINE_NOT_REACHED]: "The delivery deadline hasn't passed yet.",
  [gen.SOLVERS_ERROR__DISPUTE_SLA_NOT_REACHED]: "The time to rule on this dispute hasn't ended yet.",
  [gen.SOLVERS_ERROR__FEE_TOO_HIGH]: "The fee you entered is above the limit the platform allows.",
  [gen.SOLVERS_ERROR__NOT_RENT_PAYER]: "Only whoever paid to open this guarantee can close it.",
  [gen.SOLVERS_ERROR__STALE_DISPUTE_NEEDS_JUDGMENT]: "This milestone was already delivered and disputed: only the platform administrators can rule on it.",
  // Operação do admin (rotação de administrador): o texto é para quem opera a plataforma.
  [gen.SOLVERS_ERROR__NOT_PENDING_ADMIN]:
    "Only the account named in the proposal can accept the administrator change. Sign with the new administrator's key, or ask the current administrator to propose it again with the right account.",
  [gen.SOLVERS_ERROR__INVALID_NEW_ADMIN]:
    "The new administrator is invalid: it can't be the empty address or the current administrator. Check the address and try again.",
  // Pausa de emergência. `Paused` pode chegar a qualquer pessoa que compre ou pague: texto para leigo, sem prometer prazo.
  [gen.SOLVERS_ERROR__PAUSED]:
    "This operation is temporarily paused for safety. Try again later; what you've already purchased remains valid.",
  // Saída de stake e confisco. `AgentRetired` pode chegar a quem usa a plataforma: texto para leigo; os demais são de operação.
  [gen.SOLVERS_ERROR__AGENT_RETIRED]: "This solver was retired by its creator and is no longer for sale.",
  [gen.SOLVERS_ERROR__AGENT_NOT_RETIRED]: "This solver hasn't requested a security deposit withdrawal: only retired solvers can withdraw or extend the waiting period.",
  [gen.SOLVERS_ERROR__STAKE_EXIT_NOT_REACHED]: "The 30-day wait to withdraw the security deposit hasn't ended yet.",
  [gen.SOLVERS_ERROR__STAKE_EXIT_EXTENSIONS_EXHAUSTED]: "The withdrawal wait has already been extended twice, the maximum allowed.",
  [gen.SOLVERS_ERROR__SLASH_PENDING]: "There is a forfeiture proposal in progress for this solver: the deposit withdrawal is locked until it is canceled or carried out.",
  [gen.SOLVERS_ERROR__SLASH_DELAY_NOT_REACHED]: "The 72-hour wait for the forfeiture hasn't ended yet.",
  [gen.SOLVERS_ERROR__SLASH_ALREADY_CONTESTED]: "This forfeiture proposal has already been contested by the creator.",
  // Teto de licenças. `SoldOut` chega a quem compra: texto para leigo; os outros dois são do criador.
  [gen.SOLVERS_ERROR__SOLD_OUT]: "Sold out: all the licenses currently available for this solver have been sold.",
  [gen.SOLVERS_ERROR__SUPPLY_CAP_TOO_LOW]: "The license limit must be at least 1 and can't be below the number already sold.",
  [gen.SOLVERS_ERROR__SUPPLY_CAP_CANNOT_DECREASE]: "The license limit can only be increased, never decreased.",
  [gen.SOLVERS_ERROR__STAKE_EXIT_EXTENDED]: "The admin extended the exit wait; it can't be canceled now.",
  [gen.SOLVERS_ERROR__SLASH_EXPIRED]: "The forfeiture proposal expired (72 hours plus 14 days) and can no longer be carried out; it can only be canceled.",
  [gen.SOLVERS_ERROR__SLASH_NOT_EXPIRED]: "The forfeiture proposal hasn't expired yet: until then only the admin can cancel it.",
  // Operações de admin (migração da configuração, pausa e guardian): o texto é para quem opera a plataforma.
  [gen.SOLVERS_ERROR__CONFIG_ALREADY_MIGRATED]: "The platform configuration is already in the current format: there is nothing to migrate.",
  [gen.SOLVERS_ERROR__INVALID_PAUSE_FLAGS]: "Invalid pause value: use only bits 1 (new purchases) and 2 (payments), or 0 to release everything.",
  [gen.SOLVERS_ERROR__NOT_PAUSE_AUTHORITY]: "Only the platform administrators or the guardian can change the pause.",
  [gen.SOLVERS_ERROR__GUARDIAN_CANNOT_UNPAUSE]: "The guardian can only turn the pause on; releasing it again is up to the platform administrators.",
  // Revenda de licenças. Os textos chegam a quem compra ou anuncia: linguagem simples, sem jargão.
  [gen.SOLVERS_ERROR__SELF_PURCHASE]: "You can't buy your own listed license.",
  [gen.SOLVERS_ERROR__LISTING_MISMATCH]: "This listing isn't for this license or this solver. Refresh the page and try again.",
  [gen.SOLVERS_ERROR__RESALE_CUT_TOO_HIGH]:
    "The creator's royalty plus the platform fee is more than 50% of the price, so this license can't be listed right now. Contact support.",
  [gen.SOLVERS_ERROR__NOT_ASSET_OWNER]: "This license is no longer in your wallet.",
  [gen.SOLVERS_ERROR__ASSET_NOT_IN_COLLECTION]: "This license doesn't belong to this solver.",
  [gen.SOLVERS_ERROR__LISTING_STILL_VALID]: "This listing is still active: only the person who posted it can cancel it.",
  [gen.SOLVERS_ERROR__CREATOR_CANNOT_RESELL]: "Creators can't resell licenses of their own solver.",
  [gen.SOLVERS_ERROR__LISTING_NOT_AUTHORIZED]:
    "This listing is no longer valid: the license changed wallets or the sale was no longer authorized. Refresh the page.",
  [gen.SOLVERS_ERROR__CANCEL_PAYER_MISMATCH]:
    "This can't be canceled this way: the transaction fee must be paid by the platform. Refresh the page and try again.",
} satisfies Record<gen.SolversError, string>;

const MESSAGES: Readonly<Record<number, string>> = PROGRAM_ERROR_MESSAGES;

/** Nomes do programa (`AgentNotActive`...) pelo código, derivados das constantes geradas (`SOLVERS_ERROR__AGENT_NOT_ACTIVE`). */
const NAME_BY_CODE: ReadonlyMap<number, string> = new Map(
  Object.entries(gen)
    .filter(([k, v]) => k.startsWith("SOLVERS_ERROR__") && typeof v === "number")
    .map(([k, v]) => [
      v as number,
      k
        .slice("SOLVERS_ERROR__".length)
        .toLowerCase()
        .split("_")
        .map((w) => w[0]!.toUpperCase() + w.slice(1))
        .join(""),
    ]),
);

const CODE_BY_NAME: ReadonlyArray<readonly [string, number]> = [...NAME_BY_CODE]
  .map(([code, name]) => [name, code] as const)
  // O mais longo primeiro: nenhum nome mascara outro quando a busca é por trecho do log.
  .sort((a, b) => b[0].length - a[0].length);

/** Código custom (6000+) pertence ao programa Solvers? Erros de outros programas (token, sistema) usam números baixos. */
export function isProgramErrorCode(code: number): boolean {
  return NAME_BY_CODE.has(code);
}

export function programErrorName(code: number): string | null {
  return NAME_BY_CODE.get(code) ?? null;
}

/** Mensagem amigável do erro do programa, ou null se o código não é do programa. */
export function programErrorMessage(code: number): string | null {
  return MESSAGES[code] ?? null;
}

/** Texto para um código do programa sem mensagem (erro novo ainda sem texto): nunca devolve vazio. */
export function unknownProgramErrorMessage(code: number): string {
  return `The operation was refused (code ${code}). Refresh the page and try again; if it keeps happening, contact support.`;
}


const FAILED_LINE = /Program (\w{32,44}) failed: custom program error: 0x([0-9a-f]+)/i;
const ANCHOR_NAME = /Error Code: (\w+)\. Error Number: \d+/;
const TOKEN_PROGRAMS: ReadonlySet<string> = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
/** Erro `InsufficientFunds` do token program (Custom 1): o saldo de USDC não cobre o valor. */
const TOKEN_INSUFFICIENT_FUNDS = 1;
const INSUFFICIENT_FUNDS_MESSAGE = "Insufficient USDC balance.";

const ANCHOR_GENERIC = "One of the accounts for this operation isn't as expected. Refresh the page and try again; if it keeps happening, contact support.";
/** Erros do framework Anchor (constraints, contas) por nome, em linguagem simples. Nome fora da lista usa o texto genérico. */
const ANCHOR_MESSAGES: Readonly<Record<string, string>> = {
  AccountNotInitialized: "A required account doesn't exist yet (for example, the USDC balance account). Refresh the page and try again.",
  ConstraintTokenOwner: "The USDC balance account doesn't belong to this wallet. Refresh the page and try again.",
  ConstraintTokenMint: "The balance account provided isn't a USDC account. Refresh the page and try again.",
  ConstraintAddress: ANCHOR_GENERIC,
  ConstraintDuplicateMutableAccount: ANCHOR_GENERIC,
  ConstraintSeeds: ANCHOR_GENERIC,
  ConstraintHasOne: ANCHOR_GENERIC,
  ConstraintOwner: ANCHOR_GENERIC,
  ConstraintMut: ANCHOR_GENERIC,
  ConstraintRaw: ANCHOR_GENERIC,
  AccountOwnedByWrongProgram: ANCHOR_GENERIC,
};

/** Código do erro do Anchor (framework): faixa 100 a 5999; o programa começa em 6000. */
const isAnchorFrameworkCode = (code: number) => code >= 100 && code < 6000;

/**
 * Recusa DEFINITIVA da operação, com mensagem amigável. `code`/`name` só existem para erro do programa Solvers.
 * Não inclui infraestrutura (RPC, blockhash): isso nunca vira "recusa".
 */
export type Rejection = { code: number | null; name: string | null; message: string };

/**
 * Quem originou o erro, pelos logs: a PRIMEIRA linha `Program <X> failed: custom program error: 0x..` (a chamada mais
 * interna falha primeiro; as externas repetem o mesmo código, p.ex. o programa Solvers repete o 0x1 do token numa CPI).
 *  - Solvers + código do enum: erro do programa. Solvers + código do Anchor (2xxx/3xxx): constraint/conta, por nome.
 *  - Token (ou Token-2022) + 0x1: saldo de USDC insuficiente.
 *  - Qualquer outro programa/código: null (cai no motivo bruto).
 * Sem nenhuma linha "failed" (log truncado/ausente): usa o erro estruturado (só código do programa) e o nome nos logs.
 */
export function describeFailure(err: unknown, logs: readonly string[] = []): Rejection | null {
  const joined = logs.join("\n");
  const first = logs.map((l) => FAILED_LINE.exec(l)).find((m) => m != null);
  if (first) {
    const [, origin, hex] = first;
    const code = parseInt(hex!, 16);
    if (origin === gen.SOLVERS_PROGRAM_ADDRESS) {
      if (code >= 6000) return { code, name: programErrorName(code), message: programErrorMessage(code) ?? unknownProgramErrorMessage(code) };
      if (isAnchorFrameworkCode(code)) {
        const name = ANCHOR_NAME.exec(joined)?.[1] ?? null;
        // Nome desconhecido: não afirma nada sobre a causa.
        return name && name in ANCHOR_MESSAGES ? { code: null, name: null, message: ANCHOR_MESSAGES[name]! } : null;
      }
      return null;
    }
    if (TOKEN_PROGRAMS.has(origin!) && code === TOKEN_INSUFFICIENT_FUNDS) return { code: null, name: null, message: INSUFFICIENT_FUNDS_MESSAGE };
    return null;
  }
  for (const code of customCodes(err)) if (isProgramErrorCode(code)) return { code, name: programErrorName(code), message: programErrorMessage(code) ?? unknownProgramErrorMessage(code) };
  // Logs só com o texto (sem a linha "failed"): "Error Code: NoCredits" do Anchor ou "Error: insufficient funds" do token.
  for (const [name, c] of CODE_BY_NAME) if (joined.includes(name)) return { code: c, name, message: MESSAGES[c] ?? unknownProgramErrorMessage(c) };
  if (/insufficient funds/i.test(joined)) return { code: null, name: null, message: INSUFFICIENT_FUNDS_MESSAGE };
  return null;
}

/** Código do erro do programa Solvers (null se o erro não é do programa). */
export function extractProgramErrorCode(err: unknown, logs: readonly string[] = []): number | null {
  return describeFailure(err, logs)?.code ?? null;
}

/** Custom(n) do erro de transação do RPC e de erros do kit encadeados por `cause`/`context`. */
function customCodes(err: unknown, depth = 0): number[] {
  if (err == null || typeof err !== "object" || depth > 4) return [];
  const o = err as Record<string, unknown>;
  const out: number[] = [];
  const ie = o.InstructionError;
  if (Array.isArray(ie)) {
    const c = (ie[1] as { Custom?: unknown } | undefined)?.Custom;
    if (c != null) out.push(Number(c));
  }
  const ctxCode = (o.context as { code?: unknown } | undefined)?.code;
  if (typeof ctxCode === "number" || typeof ctxCode === "bigint") out.push(Number(ctxCode));
  for (const k of ["cause", "err", "context"]) out.push(...customCodes(o[k], depth + 1));
  return out;
}

/** Mensagem amigável da recusa presente nos logs/erro; null se não há. */
export function friendlyProgramError(err: unknown, logs: readonly string[] = []): string | null {
  return describeFailure(err, logs)?.message ?? null;
}
