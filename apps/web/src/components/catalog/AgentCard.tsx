import type { Agent } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Icon } from "@/components/ui/Icon";
import { Stars } from "@/components/ui/Stars";
import { Tile } from "@/components/ui/Tile";
import { hasEvalScore } from "@/lib/eval-label";
import { useFormat } from "@/lib/format";
import { gap } from "@/lib/style";
import { agentHref } from "./data";
import { useEvalText } from "./eval-text";
import { DifferentiatorBadges, FreeTag } from "./PlatformBits";
import { SupplyTag } from "./SupplyTag";
import { TrialTag } from "./TrialTag";

/** Cartão de especialista da home ("Mais bem avaliados"). */
export function AgentCard({ agent: a, creatorName, rate }: { agent: Agent; creatorName?: string; rate: number }) {
  const t = useTranslations("catalog.card");
  const f = useFormat();
  const ev = useEvalText();
  return (
    <Link className="card pad-s" href={agentHref(a.slug)} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="row start" style={gap("14px")}>
        <Tile category={a.category} />
        <div className="grow" style={{ minWidth: 0 }}>
          <h3 className="h4 clamp2">{a.name}</h3>
          {creatorName ? <div className="small muted trunc">{t("by", { name: creatorName })}</div> : null}
        </div>
      </div>
      <p className="small muted clamp3" style={{ minHeight: 40 }}>
        {a.tagline}
      </p>
      <div className="row wrapx" style={gap("6px 14px")}>
        {a.reviewsCount > 0 ? <Stars rating={a.userRating} showValue count={a.reviewsCount} /> : <span className="tiny faint">{t("noReviews")}</span>}
        {hasEvalScore(a.evalScore) ? (
          <span className="verified" title={ev.note}>
            <Icon name="shield-check" size="s" />
            {ev.short(a.evalScore)}
          </span>
        ) : (
          <span className="tiny faint">{ev.short(a.evalScore)}</span>
        )}
        {a.trialAvailable ? <TrialTag agentId={a.id} /> : null}
        <SupplyTag supply={a.supply} />
      </div>
      <DifferentiatorBadges keys={a.differentiators} max={3} />
      <div className="row between wrapx" style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid var(--line)" }}>
        {a.platform ? (
          <FreeTag />
        ) : (
          <div>
            <div className="bold num" style={{ fontSize: 20 }}>
              {f.brl0(a.priceUsdc, rate)}
            </div>
            <div className="tiny faint">{t("orUsdc", { usdc: f.usdc(a.priceUsdc) })}</div>
          </div>
        )}
        <span className="btn btn-secondary" style={{ minHeight: 44 }}>
          {t("details")}
        </span>
      </div>
    </Link>
  );
}
