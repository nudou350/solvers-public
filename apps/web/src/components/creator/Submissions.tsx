"use client";
// Lista de envios do criador (/creator/submissions): cada pacote enviado, em que ponto está e o que falta.
import type { SubmissionView } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthGate } from "@/components/ui/AuthGate";
import { Ago } from "@/components/ui/Ago";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";
import { Loading } from "@/components/ui/Spinner";
import { Notice } from "@/components/ui/Toast";
import { Untrusted, untrusted } from "@/components/ui/Untrusted";
import { useErrorText } from "@/lib/error-text";
import { useFormat } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { loadErrorText, reviewSlaText, statusInfo } from "@/lib/submissions-ui";
import { CreatorHead } from "./CreatorHead";
import { StatusChip } from "./SubmissionParts";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; items: SubmissionView[] };

/** Estados que mudam sozinhos em poucos segundos: a lista se atualiza enquanto algum envio estiver neles. */
const MOVING = new Set(["submitted", "validating", "publishing"]);

/** Ações com botão de destaque (textos em action.<chave>). */
const ACTION_KEYS: ReadonlySet<SubmissionView["nextAction"]> = new Set(["fix_and_resubmit", "sign_register", "sign_update"]);

export function SubmissionsView() {
  const t = useTranslations("submissions");
  const errorText = useErrorText();
  const { api, status, me } = useSession();
  const [state, setState] = useState<State>({ kind: "loading" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setState({ kind: "loading" });
      try {
        const items = await api.listMySubmissions();
        setState({ kind: "ok", items });
      } catch (e) {
        if (!silent) setState({ kind: "error", message: loadErrorText(t, e, errorText) });
      }
    },
    [api, t, errorText],
  );

  useEffect(() => {
    if (status === "authed") void load();
  }, [status, me?.wallet, load]);

  const moving = state.kind === "ok" && state.items.some((i) => MOVING.has(i.status));
  useEffect(() => {
    if (!moving) return;
    timer.current = setTimeout(() => void load(true), 6000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [moving, state, load]);

  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <CreatorHead tab="submissions" />
      <AuthGate icon="pen" title={t("list.authTitle")} text={t("list.authText")}>
        {state.kind === "loading" ? <Loading text={t("list.loading")} /> : null}
        {state.kind === "error" ? (
          <Empty icon="warning" title={t("list.loadFailed")} action={<Button onClick={() => void load()}>{t("list.retry")}</Button>}>
            {state.message}
          </Empty>
        ) : null}
        {state.kind === "ok" ? <List items={state.items} /> : null}
      </AuthGate>
    </section>
  );
}

function List({ items }: { items: SubmissionView[] }) {
  const t = useTranslations("submissions");
  const f = useFormat();
  if (items.length === 0)
    return (
      <Empty icon="upload" title={t("list.emptyTitle")} action={<Button href="/creator/publish" iconRight="arrow-right">{t("list.publish")}</Button>}>
        {t("list.emptyText")}
      </Empty>
    );
  return (
    <div className="col" style={gap(20)}>
      <Notice tone="brand" icon="clock" role="note">
        {t("list.notice", { sla: reviewSlaText(t) })}
      </Notice>
      <div className="card pad-s" style={{ padding: "8px 24px" }}>
        <div className="row between wrapx" style={{ padding: "14px 0" }}>
          <h2 className="h3">{t("list.heading")}</h2>
          <Button variant="secondary" href="/creator/publish" icon="plus">
            {t("list.sendNew")}
          </Button>
        </div>
        <ul>
          {items.map((it) => {
            const info = statusInfo(t, it.status, it.nextAction);
            const act = ACTION_KEYS.has(it.nextAction) ? t(`action.${it.nextAction}`) : null;
            const errors = it.validation?.errors.length ?? 0;
            return (
              <li key={it.id} className="rowline start" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                <div className="grow col" style={gap(6, { minWidth: 220 })}>
                  <div className="row wrapx" style={gap(10)}>
                    <Link className="bold" href={`/creator/submissions/${encodeURIComponent(it.id)}`} style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                      <Untrusted>{it.name || it.slug}</Untrusted>
                    </Link>
                    <span className="tiny faint">v{it.version}</span>
                    <StatusChip status={it.status} nextAction={it.nextAction} />
                  </div>
                  <span className="small muted">{info.text}</span>
                  <span className="tiny faint">
                    {t.rich("list.meta", { sent: () => <Ago iso={it.createdAt} />, updated: () => <Ago iso={it.updatedAt} />, size: f.fileSize(it.sizeBytes) })}
                    {errors ? ` · ${t("errorCount", { n: errors })}` : ""}
                  </span>
                </div>
                <Button variant={act ? "primary" : "secondary"} size="sm" href={`/creator/submissions/${encodeURIComponent(it.id)}`} iconRight="arrow-right" aria-label={t("list.actionAria", { action: act ?? t("action.view"), name: untrusted(it.name || it.slug) })}>
                  {act ?? t("action.view")}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="small muted">
        <Icon name="info" size="s" /> {t("list.footer")}
      </p>
    </div>
  );
}
