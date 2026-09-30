// `next start` na porta 4017 (PM2 solvers-web), respeitando PORT e HOSTNAME.
// Roda o CLI do Next no mesmo processo, para o PM2 acompanhar o processo certo.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const port = process.env.PORT || "4017";
const host = process.env.HOSTNAME || "127.0.0.1";
process.argv = [process.argv[0], "next", "start", "-p", port, "-H", host];
require("next/dist/bin/next");
