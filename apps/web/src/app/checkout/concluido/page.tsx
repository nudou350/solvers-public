import type { Metadata } from "next";
import { AgentMissing } from "@/components/checkout/AgentMissing";
import { DoneView } from "@/components/checkout/DoneView";
import { loadAgent } from "@/components/checkout/loadAgent";
import { param, type DoneKind } from "@/components/checkout/util";

export const metadata: Metadata = { title: "Compra concluída", robots: { index: false } };

const num = (v: string | null) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

export default async function DonePage({ searchParams }: PageProps<"/checkout/concluido">) {
  const sp = await searchParams;
  const { detail, error } = await loadAgent(param(sp.agent));
  if (!detail) return <AgentMissing error={error} />;
  const k = param(sp.kind);
  const kind: DoneKind = k === "escrow" || k === "credits" ? k : "purchase";
  return (
    <DoneView
      detail={detail}
      kind={kind}
      sig={param(sp.sig)}
      escrow={param(sp.escrow)}
      asset={param(sp.asset)}
      paidUsdc={num(param(sp.usdc))}
      credits={num(param(sp.n))}
      explorer={param(sp.explorer)}
    />
  );
}
