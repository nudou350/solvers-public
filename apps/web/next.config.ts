import type { NextConfig } from "next";

// Mesma origem: o front chama /api/... com caminhos relativos.
// Em dev, o Next encaminha as rotas do servidor para a API local; em produção quem faz isso é o nginx.
const API_DEV = process.env.API_DEV_URL ?? "http://localhost:3017";
const PROXIED = ["/api", "/mcp", "/oauth", "/preview", "/.well-known", "/health"];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@solvers/api-client", "@solvers/shared"],
  poweredByHeader: false,
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return PROXIED.flatMap((p) => [
      { source: p, destination: `${API_DEV}${p}` },
      { source: `${p}/:path*`, destination: `${API_DEV}${p}/:path*` },
    ]);
  },
};

export default nextConfig;
