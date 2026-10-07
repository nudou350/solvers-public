import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ConnectView } from "@/components/connect/ConnectView";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("connect.meta");
  return { title: t("title"), robots: { index: false } };
}

// Destino do /oauth/authorize do servidor: tela de consentimento do conector.
export default async function ConnectPage({ searchParams }: PageProps<"/[locale]/connect">) {
  const req = (await searchParams).req;
  const id = typeof req === "string" && /^ar_[0-9a-f]+$/.test(req) ? req : null;
  return <ConnectView req={id} />;
}
