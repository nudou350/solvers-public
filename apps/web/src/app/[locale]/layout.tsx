import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Figtree, Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { Footer } from "@/components/layout/Footer";
import { Header, TabBar } from "@/components/layout/Header";
import { themeScript } from "@/components/layout/ThemeToggle";
import { ToastProvider } from "@/components/ui/Toast";
import { routing } from "@/i18n/routing";
import { SessionProvider } from "@/lib/session";
import "@/styles/sv.css";
import "@/styles/app.css";

const figtree = Figtree({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700", "800"], variable: "--font-figtree", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin", "latin-ext"], weight: "400", variable: "--font-serif", display: "swap" });

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common.meta" });
  return { title: { default: t("title"), template: "%s · Solvers" }, description: t("description") };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F5F0" },
    { media: "(prefers-color-scheme: dark)", color: "#121116" },
  ],
};

export default async function RootLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("common");
  return (
    <html lang={locale === "pt" ? "pt-BR" : "en"} className={`${figtree.variable} ${serif.variable}`}>
      {/* O tema é aplicado no <body> por um script antes da pintura; por isso o aviso de hidratação é suprimido aqui. */}
      <body className="sv" data-theme="light" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <a className="skip-link" href="#conteudo">
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>
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
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
