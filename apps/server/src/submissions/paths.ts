import { join, resolve } from "node:path";
import { env } from "../env.js";

// Onde ficam o ZIP original e a pasta extraída de cada submissão (PACKAGE_SPEC.md 15.1):
//   SUBMISSIONS_DIR/<id>/package.zip   e   SUBMISSIONS_DIR/<id>/extracted/
// O id vem do servidor (24 hex) e é conferido antes de virar caminho; nada que o cliente escreve entra num caminho de disco.

export const SUBMISSION_ID_RE = /^[0-9a-f]{24}$/;

export const submissionsRoot = (): string => resolve(process.cwd(), env.SUBMISSIONS_DIR);

export function submissionDir(id: string): string {
  if (!SUBMISSION_ID_RE.test(id)) throw new Error("id de submissão inválido");
  return join(submissionsRoot(), id);
}

/** Caminho do ZIP relativo a SUBMISSIONS_DIR (é o que vai em `zip_path`: sobrevive a mover a pasta). */
export const zipRelPath = (id: string): string => `${id}/package.zip`;
export const zipPathOf = (id: string): string => join(submissionDir(id), "package.zip");
export const extractedDirOf = (id: string): string => join(submissionDir(id), "extracted");

/** Versão de conhecimento da ingestão de teste da revisão (PACKAGE_SPEC.md 6.4); na aprovação vira a versão real. */
export const stagingVersion = (submissionId: string): string => `staging:${submissionId}`;
