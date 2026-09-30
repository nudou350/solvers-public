import type { Metadata } from "next";
import { ConnectView } from "@/components/connect/ConnectView";

export const metadata: Metadata = { title: "Conectar ao Claude ou ChatGPT", robots: { index: false } };

// Destino do /oauth/authorize do servidor: tela de consentimento do conector.
export default async function ConnectPage({ searchParams }: PageProps<"/conectar">) {
  const req = (await searchParams).req;
  const id = typeof req === "string" && /^ar_[0-9a-f]+$/.test(req) ? req : null;
  return <ConnectView req={id} />;
}
