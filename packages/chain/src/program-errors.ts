import * as gen from "@solvers/client";

/**
 * Mensagens (para quem usa a plataforma, sem jargão) de CADA erro do programa. A lista de erros vem do
 * cliente gerado (`SOLVERS_ERROR__*`); `satisfies Record<SolversError, string>` quebra o typecheck e o teste
 * `program-errors.test.ts` falha se um erro novo do programa ficar sem texto.
 */
export const PROGRAM_ERROR_MESSAGES = {
  [gen.SOLVERS_ERROR__NOT_ADMIN]: "Só a administração da plataforma pode fazer isso.",
  [gen.SOLVERS_ERROR__NOT_VERIFIER]: "Só o verificador da plataforma pode fazer isso.",
  [gen.SOLVERS_ERROR__NOT_USAGE_AUTHORITY]: "Esta ação só pode ser feita pelo sistema da plataforma.",
  [gen.SOLVERS_ERROR__NOT_CREATOR]: "Só o criador deste especialista pode fazer isso.",
  [gen.SOLVERS_ERROR__AGENT_NOT_ACTIVE]: "Este especialista ainda não está disponível para compra.",
  [gen.SOLVERS_ERROR__AGENT_NOT_PENDING]: "Este especialista não está aguardando aprovação.",
  [gen.SOLVERS_ERROR__STRING_TOO_LONG]: "Algum texto passou do tamanho permitido. Encurte e tente de novo.",
  [gen.SOLVERS_ERROR__INVALID_BPS]: "Uma porcentagem informada é inválida. Confira os valores e tente de novo.",
  [gen.SOLVERS_ERROR__PRICE_TOO_LOW]: "O preço está abaixo do mínimo da plataforma.",
  [gen.SOLVERS_ERROR__PAY_PER_USE_DISABLED]: "Este especialista não aceita pagamento por uso. Compre a licença para usá-lo.",
  [gen.SOLVERS_ERROR__INVALID_AMOUNT]: "A quantidade ou o valor informado é inválido. Confira e tente de novo.",
  [gen.SOLVERS_ERROR__NO_CREDITS]: "Seus créditos acabaram.",
  [gen.SOLVERS_ERROR__INVALID_RATING]: "A nota deve ser de 1 a 5.",
  [gen.SOLVERS_ERROR__NO_LICENSE]: "Você precisa ter a licença deste especialista para avaliar.",
  [gen.SOLVERS_ERROR__INVALID_TOKEN_ACCOUNT]:
    "A conta de saldo em USDC não é válida para esta operação. Atualize a página e tente de novo; se continuar, fale com o suporte.",
  [gen.SOLVERS_ERROR__INVALID_LICENSE_ACCOUNT]: "A licença informada não é válida para este especialista. Atualize a página e tente de novo.",
  [gen.SOLVERS_ERROR__INVALID_MILESTONES]: "O número de etapas é inválido: use de 1 a 5 etapas.",
  [gen.SOLVERS_ERROR__INVALID_MILESTONE_INDEX]: "Esta etapa não existe nesta garantia.",
  [gen.SOLVERS_ERROR__INVALID_MILESTONE_STATUS]: "Esta etapa não está no estado certo para esta ação.",
  [gen.SOLVERS_ERROR__AUTO_RELEASE_NOT_REACHED]: "Ainda não chegou o prazo de liberação automática.",
  [gen.SOLVERS_ERROR__DISPUTE_WINDOW_CLOSED]: "O prazo para contestar esta etapa já passou.",
  [gen.SOLVERS_ERROR__NOT_BUYER]: "Só quem criou esta garantia pode fazer isso.",
  [gen.SOLVERS_ERROR__BUYER_NOT_ELIGIBLE]: "Sua conta não pode abrir novas garantias no momento.",
  [gen.SOLVERS_ERROR__INSUFFICIENT_STAKE]: "O depósito de segurança do criador é insuficiente para esta operação.",
  [gen.SOLVERS_ERROR__MATH_OVERFLOW]: "O valor informado é grande demais. Use um valor menor.",
  [gen.SOLVERS_ERROR__INVALID_REVIEW_WINDOW]: "O prazo de revisão informado é inválido.",
  [gen.SOLVERS_ERROR__PRICE_CHANGED]: "O preço mudou. Atualize a página para ver o novo valor e tente de novo.",
  [gen.SOLVERS_ERROR__LICENSE_ALREADY_REVIEWED]: "Você já avaliou este especialista com esta licença.",
  [gen.SOLVERS_ERROR__INVALID_DELIVERY_DAYS]: "O prazo de entrega é inválido: escolha até 60 dias.",
  [gen.SOLVERS_ERROR__DELIVERY_DEADLINE_NOT_REACHED]: "O prazo de entrega ainda não terminou.",
  [gen.SOLVERS_ERROR__DISPUTE_SLA_NOT_REACHED]: "O prazo para julgar esta contestação ainda não terminou.",
  [gen.SOLVERS_ERROR__FEE_TOO_HIGH]: "A taxa informada passa do limite permitido pela plataforma.",
  [gen.SOLVERS_ERROR__NOT_RENT_PAYER]: "Só quem pagou a abertura desta garantia pode encerrá-la.",
  [gen.SOLVERS_ERROR__STALE_DISPUTE_NEEDS_JUDGMENT]: "Esta etapa já foi entregue e contestada: só a administração da plataforma pode julgar.",
  // Operação do admin (rotação de administrador): o texto é para quem opera a plataforma.
  [gen.SOLVERS_ERROR__NOT_PENDING_ADMIN]:
    "Só a conta indicada na proposta pode aceitar a troca de administrador. Assine com a chave do novo administrador, ou peça ao administrador atual para propor de novo com a conta certa.",
  [gen.SOLVERS_ERROR__INVALID_NEW_ADMIN]:
    "O novo administrador é inválido: não pode ser o endereço vazio nem o próprio administrador atual. Confira o endereço e tente de novo.",
  // Pausa de emergência. `Paused` pode chegar a qualquer pessoa que compre ou pague: texto para leigo, sem prometer prazo.
  [gen.SOLVERS_ERROR__PAUSED]:
    "Esta operação está temporariamente pausada por segurança. Tente de novo mais tarde; o que você já contratou continua valendo.",
  // Saída de stake e confisco. `AgentRetired` pode chegar a quem usa a plataforma: texto para leigo; os demais são de operação.
  [gen.SOLVERS_ERROR__AGENT_RETIRED]: "Este especialista foi aposentado pelo criador e não está mais à venda.",
  [gen.SOLVERS_ERROR__AGENT_NOT_RETIRED]: "Este especialista não pediu saída do depósito de segurança: só quem está aposentado pode sacar ou estender a espera.",
  [gen.SOLVERS_ERROR__STAKE_EXIT_NOT_REACHED]: "A espera de 30 dias para sacar o depósito de segurança ainda não terminou.",
  [gen.SOLVERS_ERROR__STAKE_EXIT_EXTENSIONS_EXHAUSTED]: "A espera do saque já foi estendida duas vezes, o máximo permitido.",
  [gen.SOLVERS_ERROR__SLASH_PENDING]: "Há uma proposta de confisco em andamento para este especialista: o saque do depósito fica travado até ela ser cancelada ou executada.",
  [gen.SOLVERS_ERROR__SLASH_DELAY_NOT_REACHED]: "A espera de 72 horas do confisco ainda não terminou.",
  [gen.SOLVERS_ERROR__SLASH_ALREADY_CONTESTED]: "Esta proposta de confisco já foi contestada pelo criador.",
  [gen.SOLVERS_ERROR__STAKE_EXIT_EXTENDED]: "O admin estendeu a espera da saída; não dá para cancelar agora.",
  [gen.SOLVERS_ERROR__SLASH_EXPIRED]: "A proposta de confisco venceu (72 horas mais 14 dias) e não pode mais ser executada; ela só pode ser cancelada.",
  [gen.SOLVERS_ERROR__SLASH_NOT_EXPIRED]: "A proposta de confisco ainda não venceu: antes disso só o admin pode cancelá-la.",
  // Operações de admin (migração da configuração, pausa e guardian): o texto é para quem opera a plataforma.
  [gen.SOLVERS_ERROR__CONFIG_ALREADY_MIGRATED]: "A configuração da plataforma já está no formato atual: não há nada a migrar.",
  [gen.SOLVERS_ERROR__INVALID_PAUSE_FLAGS]: "Valor de pausa inválido: use apenas os bits 1 (entradas) e 2 (pagamentos), ou 0 para liberar tudo.",
  [gen.SOLVERS_ERROR__NOT_PAUSE_AUTHORITY]: "Só a administração ou o guardian da plataforma pode alterar a pausa.",
  [gen.SOLVERS_ERROR__GUARDIAN_CANNOT_UNPAUSE]: "O guardian só pode ligar a pausa; liberar de novo é da administração da plataforma.",
  // Revenda de licenças. Os textos chegam a quem compra ou anuncia: linguagem simples, sem jargão.
  [gen.SOLVERS_ERROR__SELF_PURCHASE]: "Você não pode comprar a sua própria licença anunciada.",
  [gen.SOLVERS_ERROR__LISTING_MISMATCH]: "Este anúncio não é desta licença ou deste especialista. Atualize a página e tente de novo.",
  [gen.SOLVERS_ERROR__RESALE_CUT_TOO_HIGH]:
    "O royalty do criador somado à taxa da plataforma passa de 50% do preço, então esta licença não pode ser anunciada agora. Fale com o suporte.",
  [gen.SOLVERS_ERROR__NOT_ASSET_OWNER]: "Esta licença não está mais na sua carteira.",
  [gen.SOLVERS_ERROR__ASSET_NOT_IN_COLLECTION]: "Esta licença não pertence a este especialista.",
  [gen.SOLVERS_ERROR__LISTING_STILL_VALID]: "Este anúncio ainda está valendo: só quem o publicou pode cancelá-lo.",
  [gen.SOLVERS_ERROR__CREATOR_CANNOT_RESELL]: "O criador não pode revender licenças do próprio especialista.",
  [gen.SOLVERS_ERROR__LISTING_NOT_AUTHORIZED]:
    "Este anúncio não vale mais: a licença mudou de carteira ou a venda foi desautorizada. Atualize a página.",
  [gen.SOLVERS_ERROR__CANCEL_PAYER_MISMATCH]:
    "Não foi possível cancelar por esta via: a taxa da transação precisa ser paga pela plataforma. Atualize a página e tente de novo.",
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
  return `A operação foi recusada (código ${code}). Atualize a página e tente de novo; se continuar, fale com o suporte.`;
}


const FAILED_LINE = /Program (\w{32,44}) failed: custom program error: 0x([0-9a-f]+)/i;
const ANCHOR_NAME = /Error Code: (\w+)\. Error Number: \d+/;
const TOKEN_PROGRAMS: ReadonlySet<string> = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
/** Erro `InsufficientFunds` do token program (Custom 1): o saldo de USDC não cobre o valor. */
const TOKEN_INSUFFICIENT_FUNDS = 1;
const INSUFFICIENT_FUNDS_MESSAGE = "Saldo de USDC insuficiente.";

const ANCHOR_GENERIC = "Uma das contas desta operação não está como esperada. Atualize a página e tente de novo; se continuar, fale com o suporte.";
/** Erros do framework Anchor (constraints, contas) por nome, em linguagem simples. Nome fora da lista usa o texto genérico. */
const ANCHOR_MESSAGES: Readonly<Record<string, string>> = {
  AccountNotInitialized: "Uma conta necessária ainda não existe (por exemplo, a de saldo em USDC). Atualize a página e tente de novo.",
  ConstraintTokenOwner: "A conta de saldo em USDC não pertence a esta carteira. Atualize a página e tente de novo.",
  ConstraintTokenMint: "A conta de saldo informada não é de USDC. Atualize a página e tente de novo.",
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
