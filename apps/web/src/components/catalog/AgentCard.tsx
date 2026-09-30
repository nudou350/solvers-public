import type { Agent } from "@solvers/api-client";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Stars } from "@/components/ui/Stars";
import { Tile } from "@/components/ui/Tile";
import { brl0, usdc } from "@/lib/format";
import { gap } from "@/lib/style";
import { agentHref } from "./data";
import { TrialTag } from "./TrialTag";

/** Cartão de especialista da home ("Mais bem avaliados"). */
export function AgentCard({ agent: a, creatorName, rate }: { agent: Agent; creatorName?: string; rate: number }) {
  return (
    <Link className="card pad-s" href={agentHref(a.slug)} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="row start" style={gap("14px")}>
        <Tile category={a.category} />
        <div className="grow" style={{ minWidth: 0 }}>
          <h3 className="h4 clamp2">{a.name}</h3>
          {creatorName ? <div className="small muted trunc">por {creatorName}</div> : null}
        </div>
      </div>
      <p className="small muted clamp3" style={{ minHeight: 40 }}>
        {a.tagline}
      </p>
      <div className="row wrapx" style={gap("6px 14px")}>
        {a.reviewsCount > 0 ? <Stars rating={a.userRating} showValue count={a.reviewsCount} /> : <span className="tiny faint">Ainda sem avaliações</span>}
        <span className="verified" title="Casos de teste resolvidos">
          <Icon name="shield-check" size="s" />
          {a.evalScore}% nos testes
        </span>
        {a.trialAvailable ? <TrialTag agentId={a.id} /> : null}
      </div>
      <div className="row between wrapx" style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid var(--line)" }}>
        <div>
          <div className="bold num" style={{ fontSize: 20 }}>
            {brl0(a.priceUsdc, rate)}
          </div>
          <div className="tiny faint">ou {usdc(a.priceUsdc)}</div>
        </div>
        <span className="btn btn-secondary" style={{ minHeight: 44 }}>
          Ver detalhes
        </span>
      </div>
    </Link>
  );
}
