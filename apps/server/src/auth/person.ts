import { createHash } from "node:crypto";

// Identidade de "pessoa" para o teste grátis: várias carteiras do mesmo e-mail contam como uma.
// Funções puras (sem env/banco), testadas em test/person.test.ts. Ainda não ligadas ao login:
// falta o servidor receber e validar o token do Privy (ver NEXT_STEPS.md, "Teste grátis por pessoa").

const GMAIL = new Set(["gmail.com", "googlemail.com"]);

/**
 * E-mail na forma canônica, ou null se não parecer um e-mail. Tira o "+etiqueta" do usuário em
 * qualquer domínio e, no Gmail, também os pontos (a.b@gmail.com e ab+x@googlemail.com são a mesma caixa).
 */
export function normalizeEmail(raw: string): string | null {
  const s = raw.normalize("NFKC").trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at < 1 || at === s.length - 1) return null;
  const domain = s.slice(at + 1).replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return null;
  const host = GMAIL.has(domain) ? "gmail.com" : domain;
  let local = s.slice(0, at);
  if (/[\s@]/.test(local)) return null;
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (host === "gmail.com") local = local.replaceAll(".", "");
  if (!local) return null;
  return `${local}@${host}`;
}

/** Chave estável da pessoa (o e-mail em si não vai para a tabela do teste). Null: e-mail inválido. */
export function personKey(email: string): string | null {
  const normalized = normalizeEmail(email);
  return normalized ? createHash("sha256").update(`solvers-person:v1:${normalized}`).digest("hex") : null;
}
