// Saque privado do criador (docs/cloak-privacidade.md): regras puras, sem rede e sem SDK, para a vitrine e os testes.
// O Cloak roda só na MAINNET e cobra no saque 0,45 USDC fixos + 0,3% (README do @cloak.dev/sdk, "Fees and limits");
// o valor real vem do PoolConfig on-chain, então a taxa daqui é uma ESTIMATIVA para a tela.

const USDC_DECIMALS = 6;
/** USDC da mainnet (o do Solvers na devnet é outro mint, sem valor). */
export const CLOAK_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Depósito mínimo do pool de USDC: 1,00. */
export const CLOAK_MIN_DEPOSIT_USDC = 1_000_000n;
/** Taxa fixa do saque em USDC: 0,45. */
export const CLOAK_FIXED_FEE_USDC = 450_000n;
/** Taxa variável do saque: 0,3% (3/1000). */
export const CLOAK_FEE_RATE_NUM = 3n;
export const CLOAK_FEE_RATE_DEN = 1000n;
/** Trava do cliente: acima disso a tela recusa (o saque é para valores pequenos enquanto o Cloak é alfa). */
export const CLOAK_MAX_WITHDRAW_USDC = 1_000_000_000n;
/** SOL mínimo na carteira para as taxas de rede do depósito (0,005 SOL; o saque é pago pelo relay do Cloak). */
export const CLOAK_MIN_SOL_LAMPORTS = 5_000_000n;

/** Taxa estimada do saque: 0,45 + 0,3% do valor (arredonda para baixo, como o programa). */
export function cloakWithdrawFee(amount: bigint): bigint {
  return CLOAK_FIXED_FEE_USDC + (amount * CLOAK_FEE_RATE_NUM) / CLOAK_FEE_RATE_DEN;
}

/** "2", "2.5", "2,50" → unidades base (6 casas). null se inválido (vazio, negativo, mais de 6 casas, notação científica). */
export function parseUsdcInput(input: string): bigint | null {
  const s = input.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  return BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(frac.padEnd(USDC_DECIMALS, "0"));
}

/** Unidades base → "1,544" (pt-BR, sem zeros à direita além de 2 casas). */
export function formatUsdcBase(amount: bigint): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const whole = abs / 10n ** BigInt(USDC_DECIMALS);
  const frac = (abs % 10n ** BigInt(USDC_DECIMALS)).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${neg ? "-" : ""}${whole.toString()},${frac}`;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Forma de um endereço Solana (a tela confere de novo com o `isAddress` do kit). */
export function looksLikeSolanaAddress(value: string): boolean {
  return BASE58.test(value.trim());
}

export type PrivateWithdrawProblem =
  | "amount_invalid"
  | "amount_too_small"
  | "amount_too_large"
  | "destination_invalid"
  | "destination_same_as_wallet"
  | "usdc_insufficient"
  | "sol_insufficient";

export const PRIVATE_WITHDRAW_PROBLEM_TEXT: Record<PrivateWithdrawProblem, string> = {
  amount_invalid: "Digite um valor em USDC, por exemplo 2 ou 2,50.",
  amount_too_small: "O valor mínimo é 1 USDC.",
  amount_too_large: "Por segurança, o saque privado está limitado a 1.000 USDC por vez enquanto o recurso é novo.",
  destination_invalid: "Esse endereço de destino não parece válido.",
  destination_same_as_wallet: "Use um endereço diferente do da sua carteira, senão não há o que esconder.",
  usdc_insufficient: "Você não tem esse saldo em USDC na rede real.",
  sol_insufficient: "Falta um pouco de SOL (0,005) na rede real para as taxas de rede.",
};

export type PrivateWithdrawPlan =
  | { ok: true; amount: bigint; fee: bigint; net: bigint; destination: string }
  | { ok: false; problem: PrivateWithdrawProblem };

/**
 * Confere o pedido de saque antes de gastar qualquer coisa. `balances` são os da MAINNET (null = ainda não carregou:
 * só valida o formato). O que o usuário recebe é `valor - taxa`.
 */
export function planPrivateWithdraw(input: {
  amount: string;
  destination: string;
  ownAddress: string;
  balances: { usdc: bigint; sol: bigint } | null;
}): PrivateWithdrawPlan {
  const amount = parseUsdcInput(input.amount);
  if (amount === null) return { ok: false, problem: "amount_invalid" };
  if (amount < CLOAK_MIN_DEPOSIT_USDC) return { ok: false, problem: "amount_too_small" };
  if (amount > CLOAK_MAX_WITHDRAW_USDC) return { ok: false, problem: "amount_too_large" };
  const destination = input.destination.trim();
  if (!looksLikeSolanaAddress(destination)) return { ok: false, problem: "destination_invalid" };
  if (destination === input.ownAddress) return { ok: false, problem: "destination_same_as_wallet" };
  if (input.balances) {
    if (input.balances.usdc < amount) return { ok: false, problem: "usdc_insufficient" };
    if (input.balances.sol < CLOAK_MIN_SOL_LAMPORTS) return { ok: false, problem: "sol_insufficient" };
  }
  const fee = cloakWithdrawFee(amount);
  return { ok: true, amount, fee, net: amount - fee, destination };
}
