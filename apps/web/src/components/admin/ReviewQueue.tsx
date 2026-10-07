"use client";
// Fila de revisão (/admin/reviews). Todo texto que vem do criador (nome, slug) entra como texto escapado, sem links.
import type { AdminSubmissionRow, SubmissionStatus } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useCallback, useEffect, useState } from "react";
import { StatusChip } from "@/components/creator/SubmissionParts";
import creator from "@/components/creator/creator.module.css";
import { Ago } from "@/components/ui/Ago";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Empty } from "@/components/ui/Empty";
import { Untrusted, untrusted } from "@/components/ui/Untrusted";
import { Loading } from "@/components/ui/Spinner";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { useErrorText } from "@/lib/error-text";
import { AdminGate } from "./AdminGate";

const FILTERS: (SubmissionStatus | "all")[] = [
  "pending_review",
  "awaiting_onchain_approval",
  "publish_failed",
  "awaiting_creator_signature",
  "changes_requested",
  "published",
  "all",
];

/** Dias úteis (seg a sex) desde `iso`, para o prazo de 5 dias úteis da PACKAGE_SPEC.md 14.5. */
export function businessDaysSince(iso: string, now = Date.now()): number {
  const start = new Date(iso);
  let n = 0;
  for (const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1); d.getTime() <= now; d.setDate(d.getDate() + 1)) {
    const w = d.getDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

type State = { kind: "loading" } | { kind: "error"; error: unknown } | { kind: "ok"; items: AdminSubmissionRow[] };

export function ReviewQueueView() {
  return (
    <AdminGate>
      <Queue />
    </AdminGate>
  );
}

function Queue() {
  const t = useTranslations("admin.queue");
  const errorText = useErrorText();
  const { api } = useSession();
  const [filter, setFilter] = useState<SubmissionStatus | "all">("pending_review");
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const items = await api.adminListSubmissions(filter === "all" ? undefined : filter);
      setState({ kind: "ok", items });
    } catch (e) {
      setState({ kind: "error", error: e });
    }
  }, [api, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="col" style={gap(24)}>
      <div className="col" style={gap(8)}>
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className="display h1s">{t("title")}</h1>
        <p className="muted" style={{ maxWidth: 640 }}>
          {t("intro")}
        </p>
      </div>

      <div className="row wrapx" style={gap(8)} role="group" aria-label={t("filterLabel")}>
        {FILTERS.map((f) => (
          <button key={f} type="button" className={["chip", filter === f ? "on" : ""].join(" ")} style={{ minHeight: 44 }} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {t(`filters.${f}`)}
          </button>
        ))}
      </div>

      {state.kind === "loading" ? <Loading text={t("loading")} /> : null}
      {state.kind === "error" ? (
        <Empty icon="warning" title={t("errorTitle")} action={<Button onClick={() => void load()}>{t("retry")}</Button>}>
          {errorText(state.error)}
        </Empty>
      ) : null}
      {state.kind === "ok" && state.items.length === 0 ? (
        <Empty icon="check-circle" title={t("emptyTitle")}>
          {t("emptyText")}
        </Empty>
      ) : null}
      {state.kind === "ok" && state.items.length > 0 ? (
        <div className="card pad-s" style={{ padding: "8px 24px" }}>
          <ul>
            {state.items.map((r) => {
              const days = r.status === "pending_review" ? businessDaysSince(r.createdAt) : null;
              return (
                <li key={r.id} className={creator.queueRow}>
                  <div className="col" style={gap(4, { minWidth: 0 })}>
                    <Link href={`/admin/reviews/${encodeURIComponent(r.id)}`} style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                      <Untrusted>{r.name || r.slug}</Untrusted>
                    </Link>
                    <span className="tiny faint" style={{ overflowWrap: "anywhere" }}>
                      <Untrusted>{r.slug}</Untrusted> · v{r.version}
                    </span>
                    <span className="row wrapx" style={gap(6)}>
                      <Chip tone={r.isNewAgent ? "brand" : "default"}>{r.isNewAgent ? t("newSolver") : t("newVersion")}</Chip>
                      {r.errors ? <Chip tone="red">{t("errors", { n: r.errors })}</Chip> : null}
                      {r.warnings ? <Chip tone="warn">{t("warnings", { n: r.warnings })}</Chip> : null}
                    </span>
                  </div>
                  <div className="col" style={gap(2, { minWidth: 0 })}>
                    <span className="small" style={{ overflowWrap: "anywhere" }}>
                      <Untrusted>{r.creatorName || t("noName")}</Untrusted>
                    </span>
                    <span className="tiny faint mono" style={{ overflowWrap: "anywhere" }}>
                      {r.creatorWallet}
                    </span>
                  </div>
                  <div className="col" style={gap(4)}>
                    <span>
                      <StatusChip status={r.status} />
                    </span>
                    <span className="tiny faint">
                      {t.rich("sent", { ago: () => <Ago iso={r.createdAt} /> })}
                    </span>
                    {days !== null ? (
                      <span className={days >= 5 ? "tiny warn" : "tiny faint"}>
                        {days >= 5 ? t("overdue") : t("businessDays", { days })}
                      </span>
                    ) : null}
                  </div>
                  <Button variant="secondary" size="sm" href={`/admin/reviews/${encodeURIComponent(r.id)}`} iconRight="arrow-right" aria-label={t("reviewAria", { name: untrusted(r.name || r.slug) })}>
                    {t("review")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
