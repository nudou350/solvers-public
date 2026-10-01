import type { Metadata, Viewport } from "next";
import { Figtree, Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { Footer } from "@/components/layout/Footer";
import { Header, TabBar } from "@/components/layout/Header";
import { themeScript } from "@/components/layout/ThemeToggle";
import { ToastProvider } from "@/components/ui/Toast";
import { SessionProvider } from "@/lib/session";
import "@/styles/sv.css";
import "@/styles/app.css";

const figtree = Figtree({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700", "800"], variable: "--font-figtree", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin", "latin-ext"], weight: "400", variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Solvers: especialistas de IA", template: "%s · Solvers" },
  description: "Especialistas de IA para usar com o Claude e o ChatGPT que você já tem. Compre uma vez e use onde quiser.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F5F0" },
    { media: "(prefers-color-scheme: dark)", color: "#121116" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${figtree.variable} ${serif.variable}`}>
      {/* O tema é aplicado no <body> por um script antes da pintura; por isso o aviso de hidratação é suprimido aqui. */}
      <body className="sv" data-theme="light" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <a className="skip-link" href="#conteudo">
          Pular para o conteúdo
        </a>
        <SessionProvider>
          <ToastProvider>
            <Header />
            <main id="conteudo" className="app-main">
              {children}
            </main>
            <Footer />
            <TabBar />
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
