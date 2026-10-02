// Varreduras de texto do conteúdo do criador (PACKAGE_SPEC.md 5.1 e 14.5). São AVISOS para o revisor:
// heurísticas simples, contornáveis; o revisor humano decide. Puro, sem env/banco.

/** Caracteres invisíveis, de direção e "tags" Unicode (usados para esconder instruções). */
const HIDDEN = /[­​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u;

export function hiddenCharsAt(text: string): { index: number; codePoint: string } | null {
  const m = HIDDEN.exec(text);
  if (!m) return null;
  return { index: m.index, codePoint: `U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}` };
}

// A mesma classe de caracteres de `HIDDEN`, em versão global, para varrer TODAS as ocorrências (revisor).
const HIDDEN_G = new RegExp(HIDDEN.source, "gu");

/** Todas as ocorrências (até `max`) de caractere invisível ou de direção: posição, ponto de código e número. */
export function hiddenCharsAll(text: string, max = 500): { index: number; codePoint: string; cp: number }[] {
  const out: { index: number; codePoint: string; cp: number }[] = [];
  HIDDEN_G.lastIndex = 0;
  for (let m = HIDDEN_G.exec(text); m && out.length < max; m = HIDDEN_G.exec(text)) {
    const cp = m[0].codePointAt(0)!;
    out.push({ index: m.index, codePoint: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`, cp });
  }
  return out;
}

/** Troca os caracteres invisíveis por `[U+XXXX]` visíveis (para mostrar trechos ao revisor sem esconder nada). */
export function revealHiddenChars(text: string): string {
  return text.replace(HIDDEN_G, (c) => `[U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`);
}

/** Frases típicas de injeção de prompt (PT e EN). */
const INJECTION: RegExp[] = [
  /ignor[ea]\s+(?:todas?\s+)?(?:as\s+)?(?:instru(?:ç|c)(?:õ|o)es|regras)\s+(?:anteriores|acima|do\s+sistema)/i,
  /desconsidere\s+(?:todas?\s+)?(?:as\s+)?(?:instru(?:ç|c)(?:õ|o)es|regras)/i,
  /esque(?:ç|c)a\s+(?:todas?\s+)?(?:as\s+)?(?:instru(?:ç|c)(?:õ|o)es|regras)/i,
  /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+(?:instructions|rules)/i,
  /disregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)/i,
  /(?:n(?:ã|a)o|nunca)\s+(?:conte|diga|revele|mostre|avise)\s+(?:isso\s+)?(?:ao|para\s+o)\s+usu(?:á|a)rio/i,
  /do\s+not\s+(?:tell|reveal|show)\s+(?:this\s+)?(?:to\s+)?the\s+user/i,
  /(?:envie|copie|encaminhe|exfiltre)\s+(?:todo\s+)?(?:o\s+)?(?:conte(?:ú|u)do|hist(?:ó|o)rico|dados|mem(?:ó|o)ria|arquivos?)\s+(?:do\s+usu(?:á|a)rio\s+)?para\s+(?:https?:\/\/|um\s+(?:site|servidor|endere(?:ç|c)o))/i,
  /(?:act|aja)\s+(?:as|como)\s+(?:the\s+)?(?:system|sistema|administrador)/i,
  /<\s{0,20}\/?\s{0,20}(?:system|instructions?)\s{0,20}>/i,
];

export function injectionMatch(text: string): string | null {
  for (const re of INJECTION) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

/** Teto de tamanho do trecho que recebe regex: linhas e URLs maiores são cortadas (defesa contra backtracking). */
const MAX_SEGMENT = 2000;

/** Linhas do texto, com as maiores que `MAX_SEGMENT` partidas em pedaços (nenhuma regex roda em trecho gigante). */
function* segments(text: string): Generator<string> {
  for (const line of text.split("\n")) {
    if (line.length <= MAX_SEGMENT) yield line;
    else for (let i = 0; i < line.length; i += MAX_SEGMENT) yield line.slice(i, i + MAX_SEGMENT);
  }
}

const ASK_VERBS = /\b(?:pe(?:ç|c)a|solicite|pergunte|informe|envie|forne(?:ç|c)a|cole|digite|ask|request|provide|send)\b/i;
const SENSITIVE = /\b(?:senha|password|cpf|cnpj|n(?:ú|u)mero\s+do\s+cart(?:ã|a)o|cart(?:ã|a)o\s+de\s+cr(?:é|e)dito|cvv|c(?:ó|o)digo\s+de\s+seguran(?:ç|c)a|token\s+de\s+acesso|chave\s+privada|frase\s+secreta|seed\s+phrase|login\s+do\s+gov\.?br)\b/i;
const NEGATION = /\b(?:nunca|jamais|n(?:ã|a)o|sem|evite|never|don'?t|do\s+not)\b/i;

/** Linha que manda pedir dado sensível ao usuário (ignora as que dizem "nunca peça ..."). */
export function sensitiveAsk(text: string): string | null {
  for (const line of segments(text)) {
    if (ASK_VERBS.test(line) && SENSITIVE.test(line) && !NEGATION.test(line)) return line.trim().slice(0, 160);
  }
  return null;
}

const URL_RE = /https?:\/\/[^\s)>\]"'`]{1,2000}/gi;
const SEND_WORDS = /\b(?:envie|enviar|poste|post|upload|webhook|encaminhe|submeta|submit|send|grave\s+em)\b/i;

/** Tem `?` seguido (antes de qualquer `#`) de `=`: parâmetros na consulta. Linear (a regex `\?[^#\s]*=` era quadrática). */
function hasQueryParams(u: string): boolean {
  const q = u.indexOf("?");
  if (q === -1) return false;
  const eq = u.indexOf("=", q + 1);
  if (eq === -1) return false;
  const hash = u.indexOf("#", q + 1);
  return hash === -1 || eq < hash;
}

/** Tira a pontuação do fim da URL (linear). */
function trimTrailingPunct(u: string): string {
  let end = u.length;
  while (end > 0 && ".,;:!?".includes(u[end - 1]!)) end -= 1;
  return u.slice(0, end);
}

/** URL de envio de dados: na mesma linha de um verbo de envio, ou com parâmetros na consulta (?a=b). */
export function sendingUrl(text: string): string | null {
  for (const line of segments(text)) {
    const urls = line.match(URL_RE);
    if (!urls) continue;
    for (const u of urls) {
      if (SEND_WORDS.test(line) || hasQueryParams(u)) return u;
    }
  }
  return null;
}

/** Todas as URLs http(s) do texto, sem pontuação final, marcando as de envio de dados (mesmo critério de `sendingUrl`). */
export function urlsIn(text: string): { url: string; sending: boolean; line: string }[] {
  const out: { url: string; sending: boolean; line: string }[] = [];
  for (const line of segments(text)) {
    const urls = line.match(URL_RE);
    if (!urls) continue;
    for (const raw of urls) {
      const url = trimTrailingPunct(raw);
      out.push({ url, sending: SEND_WORDS.test(line) || hasQueryParams(url), line: line.trim() });
    }
  }
  return out;
}

const SENSITIVE_QUESTION = /\b(?:senha|password|cpf|cnpj|cart(?:ã|a)o|cvv|token|chave\s+privada|seed|frase\s+secreta|gov\.?br)\b/i;

export function sensitiveQuestion(text: string): boolean {
  return SENSITIVE_QUESTION.test(text);
}
