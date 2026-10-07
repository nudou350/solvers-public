import type { Metadata } from "next";
import { AgentMissing } from "@/components/checkout/AgentMissing";
import { InstallView } from "@/components/checkout/InstallView";
import { loadAgent } from "@/components/checkout/loadAgent";
import { param } from "@/components/checkout/util";

export const metadata: Metadata = { title: "Instalação guiada" };

// `agent` é opcional: sem ele, a instalação é genérica (o conector é o mesmo para todos).
export default async function InstallPage({ searchParams }: PageProps<"/[locale]/install">) {
  const slug = param((await searchParams).agent);
  if (!slug) return <InstallView detail={null} />;
  const { detail, error } = await loadAgent(slug);
  if (!detail) return <AgentMissing error={error} />;
  return <InstallView key={detail.agent.id} detail={detail} />;
}
