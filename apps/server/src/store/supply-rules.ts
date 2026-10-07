import { MAX_LICENSES_CAP, SUPPLY_UNLIMITED, soldOutText, toAgentSupply, type AgentSupply } from "@solvers/shared";

// Regras puras do teto de licenças (sem env, banco nem RPC): testadas em test/supply-rules.test.ts.
// O programa é a autoridade (`purchase_license` falha com SoldOut); estas regras dão a resposta clara ANTES de montar a
// transação e decidem o que o `cli:publish` faz com o teto do manifest. O contador é `Agent.total_sales` (licenças emitidas na
// vida do solver): revender, transferir ou queimar uma licença não reabre vaga.

export type SupplyRow = { name: string; totalSales: bigint | number; maxLicenses: number | null };

/** O teto do banco já vem normalizado (`null` = ilimitado); `u32::MAX` nunca é gravado. */
export function supplyOfRow(row: Pick<SupplyRow, "totalSales" | "maxLicenses">): AgentSupply {
  return toAgentSupply(row.maxLicenses, Number(row.totalSales));
}

/** Verdadeiro quando o solver tem teto e todas as licenças já foram emitidas. */
export function isRowSoldOut(row: Pick<SupplyRow, "totalSales" | "maxLicenses">): boolean {
  return supplyOfRow(row).left === 0;
}

/** Texto para a tela e para a IA; `null` quando ilimitado. */
export function supplyLabel(s: AgentSupply): string | null {
  if (s.max == null || s.left == null) return null;
  return s.left === 0 ? "sold out" : `${s.left} of ${s.max} licenses left`;
}

export { soldOutText };

/** Teto pedido pelo manifest é inteiro de 1 a `MAX_LICENSES_CAP`. */
export function validManifestMax(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_LICENSES_CAP;
}

export type SupplyPlan =
  | { ok: true; action: "none" }
  | { ok: true; action: "create" | "raise"; max: number }
  | { ok: false; reason: "lower" | "below_sold" | "unlimited_not_implicit" | "invalid"; message: string };

/**
 * O que fazer com o teto on-chain dado o que o manifest pede (regra "só sobe").
 * - `current`: valor lido da cadeia SEM normalizar: `null` = a conta SupplyCap não existe; `SUPPLY_UNLIMITED` = ilimitado de fato.
 * - `requested`: `supply.maxLicenses` do manifest, ou `null` se o manifest não tem `supply`.
 * - `sold`: licenças já emitidas (`total_sales`); o programa recusa um teto inicial abaixo disso.
 * Manifest sem `supply` com teto finito já criado: mantém (nunca vira ilimitado implicitamente).
 */
export function nextMaxLicenses(current: number | null, requested: number | null, sold: number): SupplyPlan {
  if (requested == null) {
    if (current == null || current >= SUPPLY_UNLIMITED) return { ok: true, action: "none" };
    return {
      ok: false,
      reason: "unlimited_not_implicit",
      message: `o manifest não tem supply, mas o teto on-chain é ${current}: mantido (para mudar, aumente o maxLicenses no manifest)`,
    };
  }
  if (!validManifestMax(requested)) {
    return { ok: false, reason: "invalid", message: `supply.maxLicenses precisa ser inteiro de 1 a ${MAX_LICENSES_CAP}` };
  }
  if (current == null) {
    if (requested < sold) {
      return { ok: false, reason: "below_sold", message: `o manifest pede teto ${requested}, abaixo das ${sold} licenças já vendidas: teto não criado` };
    }
    return { ok: true, action: "create", max: requested };
  }
  if (requested === current) return { ok: true, action: "none" };
  if (requested > current && current < SUPPLY_UNLIMITED) return { ok: true, action: "raise", max: requested };
  return {
    ok: false,
    reason: "lower",
    message: current >= SUPPLY_UNLIMITED
      ? `o teto on-chain é ilimitado e não pode voltar a ser limitado: o manifest (${requested}) foi ignorado`
      : `o teto só pode aumentar: on-chain ${current}, manifest ${requested}; mantido ${current}`,
  };
}
