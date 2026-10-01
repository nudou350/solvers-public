import { writeFileSync } from "node:fs";
import { manifestJsonSchema } from "../runtime/validate/json-schema.js";

// Gera o JSON Schema do manifesto v1 (PACKAGE_SPEC.md 13).
//   npm run cli:schema                      # imprime no terminal
//   npm run cli:schema -- manifest.schema.json   # grava no arquivo

const out = process.argv[2];
const json = `${JSON.stringify(manifestJsonSchema(), null, 2)}\n`;
if (out) {
  writeFileSync(out, json);
  console.log(`schema gravado em ${out}`);
} else {
  process.stdout.write(json);
}
