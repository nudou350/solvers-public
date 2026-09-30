import type { CSSProperties } from "react";

/**
 * style com a variável --gap do design (.row/.col), mais outras propriedades opcionais.
 * Número = pixels (`gap(12)`); texto vai como está (`gap("6px 10px")`).
 */
export const gap = (g: number | string, extra?: CSSProperties): CSSProperties =>
  ({ "--gap": typeof g === "number" ? `${g}px` : g, ...extra }) as CSSProperties;
