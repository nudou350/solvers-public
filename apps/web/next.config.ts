import type { NextConfig } from "next";

// Mesma origem: o front chama /api/... com caminhos relativos.
// Em dev, o Next encaminha as rotas do servidor para a API local; em produção quem faz isso é o nginx.
const API_DEV = process.env.API_DEV_URL ?? "http://localhost:3017";
const PROXIED = ["/api", "/mcp", "/oauth", "/preview", "/.well-known", "/health"];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@solvers/api-client", "@solvers/shared"],
  poweredByHeader: false,
  async headers() {
    // A tela de consentimento do conector nunca pode ser embutida (clickjacking).
    // O mesmo vale para a revisão de pacotes (/admin) e o acompanhamento do criador (/criador): mostram conteúdo
    // enviado por terceiros e ações com poder (aprovar, co-assinar). Só se ACRESCENTAM travas: nada aqui afrouxa
    // um cabeçalho que a aplicação já mande. A CSP completa (script-src com nonce) fica fora porque o Next injeta scripts
    // inline; o conteúdo do criador é sempre texto escapado, nunca HTML (ver components/admin/ReviewDetail.tsx).
    const guarded = [
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ];
    return [
      {
        source: "/conectar",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      { source: "/admin/:path*", headers: [...guarded, { key: "Cache-Control", value: "no-store" }] },
      { source: "/criador/:path*", headers: guarded },
    ];
  },
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return PROXIED.flatMap((p) => [
      { source: p, destination: `${API_DEV}${p}` },
      { source: `${p}/:path*`, destination: `${API_DEV}${p}/:path*` },
    ]);
  },
};

export default nextConfig;
