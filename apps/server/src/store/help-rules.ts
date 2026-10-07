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
  .pipe(z.string().max(HELP_CONTACT_MAX_CHARS, `The contact field accepts up to ${HELP_CONTACT_MAX_CHARS} characters.`));

export const HelpRequest = z.object({
  message: z
    .string()
    .transform((v) => v.trim())
    .pipe(
      z
        .string()
        .min(HELP_MIN_CHARS, `Tell us a bit more (at least ${HELP_MIN_CHARS} characters).`)
        .max(HELP_MAX_CHARS, `The message accepts up to ${HELP_MAX_CHARS} characters.`),
    ),
  contact: contactField.optional(),
});

/** Texto do chamado: a mensagem do cliente e, se houver, como ele quer ser respondido. */
export function buildHelpSummary(message: string, contact?: string): string {
  const head = `Help request from the site.${contact ? `\nContact for reply: ${contact}` : "\nNo contact provided."}`;
  return `${head}\n\n${message}`;
}
