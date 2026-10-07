import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Fora: rotas do servidor (API, MCP, OAuth, .well-known), arquivos do Next e caminhos com extensão (favicon, imagens).
  matcher: ["/((?!api|mcp|oauth|preview|health|\\.well-known|_next|_vercel|.*\\..*).*)"],
};
