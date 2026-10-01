import { z } from "zod";

// Regras puras do pedido de ajuda ao criador (sem env nem banco, para testar direto).

export const HELP_MIN_CHARS = 10;
export const HELP_MAX_CHARS = 2000;
export const HELP_CONTACT_MAX_CHARS = 200;
export const HELP_PER_HOUR = 3;

// Sem quebras de linha nem caracteres de controle: o contato vai numa linha só do aviso do Telegram.
const contactField = z
  .string()
  .transform((v) => v.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/g, " ").trim())
  .pipe(z.string().max(HELP_CONTACT_MAX_CHARS, `O contato aceita até ${HELP_CONTACT_MAX_CHARS} caracteres.`));

export const HelpRequest = z.object({
  message: z
    .string()
    .transform((v) => v.trim())
    .pipe(
      z
        .string()
        .min(HELP_MIN_CHARS, `Conte um pouco mais (pelo menos ${HELP_MIN_CHARS} caracteres).`)
        .max(HELP_MAX_CHARS, `A mensagem aceita até ${HELP_MAX_CHARS} caracteres.`),
    ),
  contact: contactField.optional(),
});

/** Texto do chamado: a mensagem do cliente e, se houver, como ele quer ser respondido. */
export function buildHelpSummary(message: string, contact?: string): string {
  const head = `Pedido de ajuda pelo site.${contact ? `\nContato para resposta: ${contact}` : "\nSem contato informado."}`;
  return `${head}\n\n${message}`;
}
