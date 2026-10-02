import { SUPPLY_ERROR_CODES, SUPPLY_ERROR_HTTP_STATUS } from "@solvers/shared";
import { HttpError } from "../lib/http.js";
import { isRowSoldOut, soldOutText, supplyOfRow, type SupplyRow } from "./supply-rules.js";

/**
 * Pré-check de compra de licença nova: barra com 409 `sold_out` quando o teto do solver já foi atingido. Lê só o espelho do
 * banco (`total_sales` e `max_licenses`), sem RPC. É conveniência e resposta clara: quem barra de verdade é o programa
 * (`purchase_license` falha com SoldOut e nenhum USDC se move), inclusive se o espelho estiver atrasado.
 */
export function assertSupplyOpen(row: SupplyRow, opts: { resaleEnabled?: boolean } = {}): void {
  if (!isRowSoldOut(row)) return;
  const supply = supplyOfRow(row);
  throw new HttpError(SUPPLY_ERROR_HTTP_STATUS[SUPPLY_ERROR_CODES.soldOut], soldOutText(row.name, opts.resaleEnabled), SUPPLY_ERROR_CODES.soldOut, {
    maxLicenses: supply.max,
    sold: supply.sold,
  });
}
