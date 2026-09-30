// Gera o cliente TS a partir do IDL do Anchor. Rodar sempre que o programa mudar:
//   pnpm --filter @solvers/client generate
import { readFileSync, rmSync } from "node:fs";
import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";

const idl = JSON.parse(readFileSync(new URL("./idl/solvers.json", import.meta.url), "utf8"));
const codama = createFromRoot(rootNodeFromAnchor(idl));
const out = new URL("./src/generated", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
rmSync(out, { recursive: true, force: true });
codama.accept(renderVisitor(out, { formatCode: false, deleteFolderBeforeRendering: true, generatedFolder: ".", syncPackageJson: false, importExtension: "js" }));
console.log("cliente gerado em", out);
