import { revealHidden } from "@/lib/submissions-ui";

/**
 * Texto escrito por um criador (nome, bio, frase curta, categoria, mensagens do validador, notas do revisor) mostrado nas telas
 * de envio e de revisão: caracteres invisíveis e de direção viram `[U+XXXX]` visíveis, para ninguém esconder instruções ou
 * trocar a ordem de leitura. Sempre texto, nunca HTML.
 */
export function Untrusted({ children }: { children: string | null | undefined }) {
  return <>{revealHidden(children ?? "").text}</>;
}

/** Mesma regra para atributos e rótulos (string pura). */
export const untrusted = (text: string | null | undefined): string => revealHidden(text ?? "").text;
