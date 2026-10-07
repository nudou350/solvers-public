// `next start` na porta 4017 (PM2 solvers-web), respeitando PORT e HOSTNAME.
// Roda o CLI do Next no mesmo processo, para o PM2 acompanhar o processo certo.
import { setDefaultResultOrder } from "node:dns";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const port = process.env.PORT || "4017";
// Loopback vira "localhost": o proxy (next-intl) reescreve /library -> /en/library com a URL que o Next normaliza para
// "localhost"; se o servidor subir como 127.0.0.1, a origem difere e o Next trata o rewrite como externo (500 "Failed
// to proxy"). Com ipv4first, "localhost" continua escutando em 127.0.0.1 (o nginx aponta para lá), mesmo onde o
// /etc/hosts lista ::1 primeiro.
const envHost = process.env.HOSTNAME || "127.0.0.1";
const host = envHost === "127.0.0.1" || envHost === "::1" ? "localhost" : envHost;
setDefaultResultOrder("ipv4first");
process.argv = [process.argv[0], "next", "start", "-p", port, "-H", host];
require("next/dist/bin/next");
