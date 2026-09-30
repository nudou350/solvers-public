import { zodToJsonSchema } from "zod-to-json-schema";
import { ManifestV1Base } from "./schema-v1.js";

// JSON Schema do manifesto v1 (PACKAGE_SPEC.md 13), gerado do zod: editores e o Criador de Solvers usam este
// arquivo só para autocompletar/explicar; quem decide se um pacote é válido é sempre o validador.
// Servido em GET /api/spec/manifest.schema.json (rota na P4) e gravado por `npm run cli:schema`.

export function manifestJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(ManifestV1Base, { name: "SolverManifestV1", $refStrategy: "none" }) as Record<string, unknown>;
  return { $schema: "http://json-schema.org/draft-07/schema#", title: "Manifesto do pacote Solver (specVersion 1)", ...schema };
}
