// Helpers da área de checkout e instalação (sem dependência de React).
// Formatação comum em lib/format; explorador e rede em lib/explorer; --gap em lib/style.

export type CheckoutType = "permanent" | "credits" | "guarantee";
export type DoneKind = "purchase" | "credits" | "escrow";

export const CHECKOUT_TYPES: CheckoutType[] = ["permanent", "credits", "guarantee"];

export function parseType(v: string | string[] | undefined): CheckoutType {
  const s = Array.isArray(v) ? v[0] : v;
  return CHECKOUT_TYPES.includes(s as CheckoutType) ? (s as CheckoutType) : "permanent";
}

export function param(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : null;
}

/** Pacote mínimo de créditos, como o servidor calcula: ceil(compra mínima / preço por uso). */
export function minCredits(minPurchaseUsdc: number, pricePerUseUsdc: number): { amount: number; totalUsdc: number } {
  const amount = Math.max(1, Math.ceil(Math.round((minPurchaseUsdc / pricePerUseUsdc) * 1e6) / 1e6));
  return { amount, totalUsdc: Math.round(amount * pricePerUseUsdc * 1e6) / 1e6 };
}
