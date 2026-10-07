import type { NextConfig } from "next";
import path from "node:path";

// next-intl acha a config do idioma pelo alias next-intl/config. Fazemos o alias aqui em vez de usar o plugin
// (next-intl/plugin), que carrega @swc/core e @parcel/watcher nativos só para o extrator de mensagens e quebra no Windows.
const I18N_REQUEST = "./src/i18n/request.ts";

// Mesma origem: o front chama /api/... com caminhos relativos.
// Em dev, o Next encaminha as rotas do servidor para a API local; em produção quem faz isso é o nginx.
const API_DEV = process.env.API_DEV_URL ?? "http://localhost:3017";
const PROXIED = ["/api", "/mcp", "/oauth", "/preview", "/.well-known", "/health"];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@solvers/api-client", "@solvers/shared"],
  poweredByHeader: false,
  turbopack: { resolveAlias: { "next-intl/config": I18N_REQUEST } },
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, "next-intl/config": path.resolve(import.meta.dirname, I18N_REQUEST) };
    return config;
  },
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
    // Cada área existe sem prefixo (inglês) e com /pt.
    const both = (path: string) => [path, `/pt${path}`];
    return [
      ...both("/connect").map((source) => ({
        source,
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      })),
      ...both("/admin/:path*").map((source) => ({ source, headers: [...guarded, { key: "Cache-Control", value: "no-store" }] })),
      ...both("/creator/:path*").map((source) => ({ source, headers: guarded })),
    ];
  },
  async redirects() {
    // Rotas antigas em português (links já divulgados): 301 para as novas, mantendo o idioma português.
    const OLD: [string, string][] = [
      ["/especialistas/:slug", "/solvers/:slug"],
      ["/biblioteca/memorias", "/library/memories"],
      ["/biblioteca", "/library"],
      ["/checkout/concluido", "/checkout/done"],
      ["/conectar", "/connect"],
      ["/criador/envios/:id", "/creator/submissions/:id"],
      ["/criador/envios", "/creator/submissions"],
      ["/criador/publicar", "/creator/publish"],
      ["/criador/saque-privado", "/creator/private-withdraw"],
      ["/criador", "/creator"],
      ["/criadores/:id", "/creators/:id"],
      ["/garantias", "/guarantees"],
      ["/instalar", "/install"],
      ["/perfil", "/profile"],
      ["/revenda", "/resale"],
      ["/admin/revisoes/:id", "/admin/reviews/:id"],
      ["/admin/revisoes", "/admin/reviews"],
    ];
    return OLD.flatMap(([from, to]) => [
      { source: from, destination: `/pt${to}`, permanent: true },
      { source: `/pt${from}`, destination: `/pt${to}`, permanent: true },
    ]);
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
