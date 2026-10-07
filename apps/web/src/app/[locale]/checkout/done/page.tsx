import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AgentMissing } from "@/components/checkout/AgentMissing";
import { DoneView } from "@/components/checkout/DoneView";
import { loadAgent } from "@/components/checkout/loadAgent";
import { isResale, param, type DoneKind } from "@/components/checkout/util";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("install");
  return { title: t("meta.doneTitle"), robots: { index: false } };
}

const num = (v: string | null) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

export default async function DonePage({ searchParams }: PageProps<"/[locale]/checkout/done">) {
  const sp = await searchParams;
  const { detail, error } = await loadAgent(param(sp.agent));
  if (!detail) return <AgentMissing error={error} />;
  const k = param(sp.kind);
  const kind: DoneKind = k === "escrow" ? k : "purchase";
  return (
    <DoneView
      detail={detail}
      kind={kind}
      resale={kind === "purchase" && isResale(sp.resale)}
      sig={param(sp.sig)}
      escrow={param(sp.escrow)}
      asset={param(sp.asset)}
      paidUsdc={num(param(sp.usdc))}
      explorer={param(sp.explorer)}
    />
  );
}
