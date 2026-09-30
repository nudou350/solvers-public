import type { TokenDelta } from "@solvers/chain";

// Valores efetivamente executados por uma transação, lidos das variações de saldo de token
// (funções puras). O programa não emite o valor pago nem a taxa em todos os eventos, e a taxa
// pode mudar com update_config: o que vale é o que de fato saiu do pagador e chegou na tesouraria.

export type Split = {
  /** Total que saiu do pagador. */
  gross: bigint;
  /** Parte da plataforma (tesouraria). */
  fee: bigint;
  /** O resto, que foi para o criador. */
  creatorAmount: bigint;
};

const TOTAL_BPS = 10_000n;

/** Mesma conta do programa (state.rs fee_split): taxa arredondada para baixo. */
export function splitByBps(amount: bigint, feeBps: number): Split {
  const fee = (amount * BigInt(feeBps)) / TOTAL_BPS;
  return { gross: amount, fee, creatorAmount: amount - fee };
}

/**
 * Split real da transação. `payerOwner` é quem paga em USDC (o comprador ou o PDA do escrow) e
 * `treasuryAccount` é a conta de token da tesouraria. Devolve null se os saldos não mostram um
 * pagamento (ex.: transação sem dados de saldo) ou se a tesouraria é desconhecida, para o chamador usar o plano B.
 */
export function splitFromDeltas(deltas: readonly TokenDelta[], usdcMint: string, payerOwner: string, treasuryAccount: string | null): Split | null {
  // Sem a conta da tesouraria não dá para separar a taxa: fee=0 faria o criador parecer receber o bruto.
  if (!treasuryAccount) return null;
  const usdc = deltas.filter((d) => d.mint === usdcMint);
  const paid = usdc.filter((d) => d.owner === payerOwner && d.delta < 0n).reduce((s, d) => s - d.delta, 0n);
  if (paid <= 0n) return null;
  const fee = usdc.filter((d) => d.account === treasuryAccount && d.delta > 0n).reduce((s, d) => s + d.delta, 0n);
  if (fee > paid) return null;
  return { gross: paid, fee, creatorAmount: paid - fee };
}

/** Taxa em bps que explica o split (a configurada, se bater com a taxa paga; senão a implícita). */
export function effectiveFeeBps(split: Split, configuredBps: number | null): number | null {
  if (split.gross <= 0n) return configuredBps;
  if (configuredBps != null && splitByBps(split.gross, configuredBps).fee === split.fee) return configuredBps;
  return Number((split.fee * TOTAL_BPS + split.gross / 2n) / split.gross);
}
