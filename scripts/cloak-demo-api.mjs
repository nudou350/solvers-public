// API de mentira SO para a demo/teste da tela do saque privado (Cloak): login + config, sem banco nem servidor real. Porta 3018.
// Sobe junto com o site por `bash scripts/cloak-demo.sh`. Nao serve para mais nada: qualquer outra rota responde 404.
import http from "node:http";
const config = { cluster: "devnet", rpcUrl: "https://api.devnet.solana.com", programId: "11111111111111111111111111111111", usdcMint: "11111111111111111111111111111111", feePayer: "11111111111111111111111111111111", feeBps: 500, minPurchaseUsdc: 5, faucetEnabled: false, faucetAmountUsdc: 0, brlPerUsd: 5.5, connectorUrl: "http://localhost/mcp", freeTrialUses: 3, reviewWindowSecs: 60, guaranteeLimitsUsdc: { none: 0, limited: 50, full: 500 }, guaranteeMinSales: 0, guaranteeMinRating: 0, pix: { enabled: false, simulate: false, provider: null, minBrl: 10, maxBrl: 1000 } };
const json = (res, code, body, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const cookie = /sess=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  if (url.pathname === "/api/config") return json(res, 200, config);
  if (url.pathname === "/api/auth/nonce") return json(res, 200, { message: `Solvers mock sign-in for ${url.searchParams.get("wallet")} at ${Date.now()}` });
  if (url.pathname === "/api/auth/verify" && req.method === "POST") {
    let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { const { wallet } = JSON.parse(b || "{}"); json(res, 200, { wallet }, { "set-cookie": `sess=${wallet}; Path=/; HttpOnly; SameSite=Lax` }); });
    return;
  }
  if (url.pathname === "/api/auth/me") return cookie ? json(res, 200, { wallet: cookie }) : json(res, 401, { error: "no session", code: "unauthorized" });
  if (url.pathname === "/api/auth/logout") return json(res, 200, { ok: true }, { "set-cookie": "sess=; Path=/; Max-Age=0" });
  json(res, 404, { error: `mock: ${url.pathname}`, code: "not_found" });
}).listen(3018, () => console.log("mock api on 3018"));
