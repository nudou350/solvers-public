// Helpers da área de checkout e instalação (sem dependência de React).
// Formatação comum em lib/format; explorador e rede em lib/explorer; --gap em lib/style.

export type CheckoutType = "permanent" | "guarantee";
export type DoneKind = "purchase" | "escrow";

export const CHECKOUT_TYPES: CheckoutType[] = ["permanent", "guarantee"];

export function parseType(v: string | string[] | undefined): CheckoutType {
  const s = Array.isArray(v) ? v[0] : v;
  return CHECKOUT_TYPES.includes(s as CheckoutType) ? (s as CheckoutType) : "permanent";
}

export function param(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : null;
}
