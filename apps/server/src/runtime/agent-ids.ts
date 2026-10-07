// Formato dos identificadores de pacote (PACKAGE_SPEC.md 4.1). Sem env/banco: usado pelo manifest,
// pelo carregador, pela busca no catálogo e pelos testes.

/** `id` do agente: 16 bytes em hex minúsculo (vira o agent_id on-chain). */
export const AGENT_ID_RE = /^[0-9a-f]{32}$/;

/** `slug`: minúsculas, dígitos e hífens entre blocos (sem hífen nas pontas nem hífen duplo). */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Versão `MAJOR.MINOR.PATCH` numérica (sem pré-lançamento). O programa on-chain aceita até 16 bytes. */
export const VERSION_RE = /^\d+\.\d+\.\d+$/;
export const MAX_VERSION_BYTES = 16;

export const isAgentId = (s: string) => AGENT_ID_RE.test(s);

/** Motivo pelo qual o slug não serve, ou null. Um slug com formato de `id` seria resolvido como o agente de outro. */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3 || slug.length > 40) return "slug must be 3 to 40 characters long";
  if (!SLUG_RE.test(slug)) return "slug only accepts lowercase letters, digits and hyphens between blocks";
  if (AGENT_ID_RE.test(slug)) return "slug can't have the format of an id (32 hexadecimal characters)";
  return null;
}

export function versionProblem(version: string): string | null {
  if (!VERSION_RE.test(version)) return "version must be numeric MAJOR.MINOR.PATCH (e.g. 1.0.0)";
  if (Buffer.byteLength(version) > MAX_VERSION_BYTES) return `version is over ${MAX_VERSION_BYTES} bytes (on-chain limit)`;
  return null;
}
