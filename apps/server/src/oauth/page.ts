// Página "Conectar sua carteira ao Solvers", servida pelo próprio servidor no /oauth/authorize.
// Autossuficiente (sem build): detecta Phantom/Solflare/Backpack, faz o login com carteira (SIWS)
// e pede a assinatura da chave de memória. A vitrine pode substituí-la por uma rota /connect.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function authorizePage(p: {
  requestId?: string;
  clientName?: string;
  redirectHost?: string;
  verified?: boolean;
  apiBase?: string;
  webUrl?: string;
  memoryMessage?: string;
  error?: string;
}) {
  const config = JSON.stringify({ req: p.requestId, api: p.apiBase, memoryMessage: p.memoryMessage }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conectar ao Solvers</title>
<style>
  :root { --bg:#f7f7f5; --card:#fff; --ink:#1b1b1f; --muted:#5b5b66; --line:#e6e6e0; --accent:#6b4ce6; --accent2:#14b8a6; --err:#b42318; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111114; --card:#1a1a1f; --ink:#f2f2f5; --muted:#a3a3ad; --line:#2a2a31; --err:#f97066; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--ink);
         font:16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding:16px; }
  .card { width:100%; max-width:440px; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:28px; }
  .brand { display:flex; align-items:center; gap:10px; font-weight:700; font-size:18px; margin-bottom:18px; }
  .dot { width:22px; height:22px; border-radius:7px; background:linear-gradient(135deg,var(--accent),var(--accent2)); }
  h1 { font-size:22px; margin:0 0 8px; }
  p { color:var(--muted); margin:0 0 16px; }
  ul { color:var(--muted); padding-left:20px; margin:0 0 20px; }
  button { width:100%; border:0; border-radius:10px; padding:13px 16px; font-size:16px; font-weight:600; cursor:pointer;
           background:var(--ink); color:var(--card); }
  button:disabled { opacity:.55; cursor:default; }
  button:focus-visible { outline:3px solid var(--accent); outline-offset:2px; }
  .status { margin-top:14px; font-size:14px; color:var(--muted); min-height:20px; }
  .error { color:var(--err); }
  .fine { font-size:13px; margin-top:18px; }
  .dest { font-size:14px; border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin:0 0 16px; }
  .warn { border-color:#f79009; color:var(--ink); }
  a { color:var(--accent); }
</style>
</head>
<body>
<main class="card">
  <div class="brand"><span class="dot" aria-hidden="true"></span>Solvers</div>
  ${
    p.error
      ? `<h1>Não foi possível continuar</h1><p class="error">${esc(p.error)}</p>`
      : `<h1>Conectar ${esc(p.clientName ?? "seu assistente")} ao Solvers</h1>
  <p>Assim seus especialistas passam a funcionar dentro do chat.</p>
  <p class="dest${p.verified ? "" : " warn"}">${
    p.verified
      ? `Destino verificado: <strong>${esc(p.redirectHost ?? "")}</strong>`
      : `⚠ Aplicativo não verificado. O acesso será enviado para <strong>${esc(p.redirectHost ?? "")}</strong>. Continue só se você mesmo iniciou esta conexão.`
  }</p>
  <ul>
    <li>Você confirma que a carteira é sua (sem custo e sem pagamento).</li>
    <li>Uma segunda assinatura protege suas memórias com criptografia.</li>
  </ul>
  <button id="go" type="button">Conectar carteira</button>
  <div id="status" class="status" role="status" aria-live="polite"></div>
  <p class="fine">Não tem carteira? Entre pela <a href="${esc(p.webUrl ?? "/")}" target="_blank" rel="noopener">loja do Solvers</a> com seu e-mail e volte aqui.</p>`
  }
</main>
${
  p.error
    ? ""
    : `<script>
const CFG = ${config};
const $ = (id) => document.getElementById(id);
const say = (t, err) => { const s = $("status"); s.textContent = t; s.className = "status" + (err ? " error" : ""); };
function provider() {
  const w = window;
  return w.phantom?.solana || w.solflare || w.backpack || w.solana || null;
}
function toB64(bytes) { let s = ""; bytes.forEach((b) => s += String.fromCharCode(b)); return btoa(s); }
async function sign(p, text) {
  const out = await p.signMessage(new TextEncoder().encode(text), "utf8");
  return toB64(out.signature || out);
}
$("go").addEventListener("click", async () => {
  const p = provider();
  if (!p) { say("Nenhuma carteira encontrada neste navegador. Instale a Phantom ou use a loja com e-mail.", true); return; }
  $("go").disabled = true;
  try {
    say("Abrindo a carteira…");
    const res = await p.connect();
    const wallet = (res?.publicKey || p.publicKey).toString();
    const n = await fetch(CFG.api + "/oauth/authorize/nonce?req=" + encodeURIComponent(CFG.req) + "&wallet=" + wallet).then((r) => r.json());
    if (!n.message) throw new Error(n.error || "Falha ao iniciar");
    say("Confirme a assinatura de login na carteira…");
    const signature = await sign(p, n.message);
    say("Agora a assinatura que protege suas memórias…");
    const memorySignature = await sign(p, CFG.memoryMessage);
    say("Conectando…");
    const done = await fetch(CFG.api + "/oauth/authorize/complete", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ req: CFG.req, wallet, message: n.message, signature, memorySignature }),
    }).then((r) => r.json());
    if (!done.redirectTo) throw new Error(done.error || "Falha ao conectar");
    say("Pronto! Voltando para o seu assistente…");
    location.href = done.redirectTo;
  } catch (e) {
    say(e?.message || "Algo deu errado. Tente de novo.", true);
    $("go").disabled = false;
  }
});
</script>`
}
</body>
</html>`;
}
