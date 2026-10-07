"use client";
// Uma garantia em andamento (garantias-em-andamento.html): etapas, prévia, contagem regressiva,
// aprovar (buildRelease) e contestar com critério e motivo (buildDispute).
import type { Agent, Escrow, EscrowDetail, MilestoneStatus } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Tile } from "@/components/ui/Tile";
import { Notice, useToast } from "@/components/ui/Toast";
import { saveTextFile, useFormat } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { useTx, useTxErrorMessage } from "@/lib/tx";

type Ms = Escrow["milestones"][number] & { extra: EscrowDetail["milestones"][number] | null };

// O texto de cada estado vem de account.escrow.status.<chave>.
const STATUS: Record<MilestoneStatus, { tone: string; dot: string }> = {
  pending: { tone: "faint", dot: "" },
  submitted: { tone: "brand", dot: "dot-now" },
  passed: { tone: "brand", dot: "dot-now" },
  approved: { tone: "ok", dot: "dot-ok" },
  disputed: { tone: "bad", dot: "dot-bad" },
  refunded: { tone: "faint", dot: "" },
};

/** Chave do rótulo (account.escrow.chip.<status>) e tom do selo de cada estado da garantia. */
export const ESCROW_CHIP: Record<Escrow["status"], [string, ChipTone]> = {
  active: ["chip.active", "brand"],
  disputed: ["chip.disputed", "red"],
  approved: ["chip.approved", "ok"],
  refunded: ["chip.refunded", "default"],
};

/** Critérios de uma etapa a partir do texto do escrow, como o servidor divide (quebra de linha ou ";"). */
const splitCriteria = (text: string) =>
  text
    .split(/\n|;/)
    .map((c) => c.trim())
    .filter(Boolean);

function mark(s: MilestoneStatus, i: number) {
  if (s === "approved") return <Icon name="check" size="s" />;
  if (s === "disputed") return "!";
  if (s === "refunded") return "↩";
  return String(i + 1);
}

/** Baixa os arquivos de uma etapa aprovada: um botão por arquivo (Blob). */
export function Deliverable({ escrowId, index, label }: { escrowId: string; index: number; label?: string }) {
  const { api } = useSession();
  const t = useTranslations("account.escrow");
  const errorInfo = useTxErrorMessage();
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (files) {
    const names = Object.keys(files);
    return (
      <div className="row wrapx" style={{ "--gap": "6px" } as React.CSSProperties} aria-label={t("filesLabel")}>
        {names.map((n) => (
          <button key={n} type="button" className="chip" style={{ minHeight: 36, maxWidth: "100%" }} onClick={() => saveTextFile(n, files[n] ?? "")}>
            <Icon name="download" size="s" />
            <span className="trunc">{n}</span>
          </button>
        ))}
        {!names.length ? <span className="small faint">{t("noFiles")}</span> : null}
      </div>
    );
  }
  return (
    <span className="row wrapx" style={{ "--gap": "8px" } as React.CSSProperties}>
      <Button
        variant="secondary"
        size="sm"
        icon="download"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const r = await api.downloadDeliverable(escrowId, index);
            const names = Object.keys(r.files);
            // Um arquivo só: já baixa. Mais de um: mostra um botão para cada.
            if (names.length === 1 && names[0]) saveTextFile(names[0], r.files[names[0]] ?? "");
            setFiles(r.files);
          } catch (e) {
            setErr(errorInfo(e).text);
          } finally {
            setBusy(false);
          }
        }}
      >
        {label ?? t("downloadFiles")}
      </Button>
      {err ? (
        <span className="small bad" role="alert">
          {err}
        </span>
      ) : null}
    </span>
  );
}

/** Cancelar uma etapa não entregue (prazo vencido) com confirmação simples. */
function CancelUndelivered({ amount, pending, onConfirm }: { amount: string; pending: boolean; onConfirm: () => void }) {
  const t = useTranslations("account.escrow");
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <div>
        <Button variant="secondary" size="sm" icon="refresh" onClick={() => setAsking(true)} disabled={pending}>
          {t("cancelUndelivered")}
        </Button>
      </div>
    );
  return (
    <div className="card-flat pad-s col" style={{ "--gap": "10px", background: "var(--surface)" } as React.CSSProperties} role="group" aria-label={t("cancelConfirmLabel")}>
      <span className="small">
        {t("cancelConfirmText", { amount })}
      </span>
      <div className="row wrapx" style={{ "--gap": "8px" } as React.CSSProperties}>
        <Button variant="primary" size="sm" loading={pending} onClick={onConfirm}>
          {t("cancelYes")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAsking(false)} disabled={pending}>
          {t("back")}
        </Button>
      </div>
    </div>
  );
}

function DisputeForm({ criteria, onCancel, onSend, pending }: { criteria: string[]; onCancel: () => void; onSend: (c: string, reason: string) => void; pending: boolean }) {
  const t = useTranslations("account.escrow");
  const [crit, setCrit] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const len = reason.trim().length;
  const valid = !!crit && len >= 5 && len <= 2000;
  return (
    <form
      className="card pad-s col"
      style={{ "--gap": "12px", borderColor: "var(--red)" } as React.CSSProperties}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && crit) onSend(crit, reason.trim());
      }}
    >
      <fieldset className="col" style={{ "--gap": "10px", border: 0, padding: 0, margin: 0 } as React.CSSProperties}>
        <legend className="col" style={{ "--gap": "4px", padding: 0, marginBottom: 10 } as React.CSSProperties}>
          <b>{t("disputeLegend")}</b>
          <span className="small muted">{t("disputeLegendHelp")}</span>
        </legend>
        {criteria.map((c) => (
          <button key={c} type="button" className={`opt${crit === c ? " on" : ""}`} style={{ padding: "12px 14px" }} aria-pressed={crit === c} onClick={() => setCrit(c)}>
            <span className="dot-r" />
            <span className="small">{c}</span>
          </button>
        ))}
      </fieldset>
      <div className="field">
        <label className="label" htmlFor={reasonId}>
          {t("disputeReason")}
        </label>
        <textarea
          id={reasonId}
          className="textarea"
          value={reason}
          maxLength={2000}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("disputePlaceholder")}
        />
        <span className="hint" aria-live="polite">
          {len < 5 ? t("disputeMin", { len }) : `${len}/2000`}
        </span>
      </div>
      <div className="row wrapx" style={{ "--gap": "10px" } as React.CSSProperties}>
        <Button type="submit" variant="primary" disabled={!valid} loading={pending}>
          {t("disputeSend")}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

export function EscrowCard({
  escrow: e,
  detail,
  detailFailed = false,
  onRetryDetail,
  agent,
  onChanged,
}: {
  escrow: Escrow;
  detail: EscrowDetail | null;
  /** O detalhe (critérios, prazos, prévia) não carregou: o cartão avisa e oferece "Tentar de novo". */
  detailFailed?: boolean;
  onRetryDetail?: () => Promise<boolean>;
  agent: Agent | undefined;
  onChanged: () => void;
}) {
  const { api, config } = useSession();
  const t = useTranslations("account.escrow");
  const ts = useTranslations("account.shared");
  const f = useFormat();
  const rate = config?.brlPerUsd ?? null;
  const toast = useToast();
  const tx = useTx();
  const [disputing, setDisputing] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [retrying, setRetrying] = useState(false);

  const ms: Ms[] = e.milestones.map((m, i) => ({ ...m, extra: detail?.milestones.find((x) => x.index === i) ?? null }));
  const done = ms.filter((m) => m.status === "approved").length;
  const focusIdx = ms.findIndex((m) => m.status === "passed");
  const focus = focusIdx >= 0 ? ms[focusIdx] : undefined;
  const now = useNow(focus?.extra?.autoReleaseAt ? 1000 : 60_000);
  const cd = focus?.extra?.autoReleaseAt ? f.countdown(focus.extra.autoReleaseAt, now) : null;
  const submitted = ms.find((m) => m.status === "submitted");
  const disputed = ms.find((m) => m.status === "disputed");
  const [chipKey, chipTone] = ESCROW_CHIP[e.status];
  const money = (n: number) => (rate ? f.brl(n, rate) : f.usdc(n));
  // Prazo de entrega: só tarefas novas têm; nas antigas (nulo) não aparece nada.
  const deadline = e.deliveryDeadline;
  const overdue = deadline ? new Date(deadline).getTime() < now : false;
  const firstPending = ms.findIndex((m) => m.status === "pending");
  const isDesign = agent?.category === "Design";
  // Sem o detalhe, os critérios saem do texto da garantia, dividido como o servidor divide (mesma regra da validação).
  const focusCriteria = focus ? (focus.extra?.criteria ?? splitCriteria(focus.criteria)) : [];

  const approve = async () => {
    if (focusIdx < 0) return;
    const r = await tx.run(() => api.buildRelease(e.id, focusIdx));
    if (!r) return;
    setMsg({ tone: "ok", text: t("approvedMsg") });
    toast({ tone: "ok", title: t("approvedTitle"), text: t("approvedText") });
    onChanged();
  };

  const cancelUndelivered = async (idx: number) => {
    const r = await tx.run(() => api.buildCancelUndelivered(e.id, idx));
    // Com ou sem sucesso, relê: o prazo ou o estado da etapa pode ter mudado.
    onChanged();
    if (!r) return;
    setMsg({ tone: "ok", text: t("cancelledMsg") });
    toast({ tone: "ok", title: t("cancelledTitle"), text: t("cancelledText") });
  };

  const sendDispute = async (criterion: string, reason: string) => {
    if (focusIdx < 0) return;
    const r = await tx.run(() => api.buildDispute(e.id, focusIdx, criterion, reason));
    if (!r) return;
    setDisputing(false);
    setMsg({ tone: "warn", text: t("disputeSentMsg") });
    toast({ tone: "ok", title: t("disputeSentTitle") });
    onChanged();
  };

  return (
    <article className="card" style={{ padding: 0, overflow: "hidden" }} aria-labelledby={`esc-${e.id}`}>
      <div className="row wrapx" style={{ "--gap": "16px", padding: "22px 26px", borderBottom: "1px solid var(--line)" } as React.CSSProperties}>
        {agent ? <Tile category={agent.category} /> : <span className="tile" aria-hidden />}
        <div className="grow" style={{ minWidth: 220 }}>
          <h2 className="h3" id={`esc-${e.id}`}>
            {e.title}
          </h2>
          <div className="small muted">
            {t("summary", { name: detail?.agent.name ?? agent?.name ?? t("unnamedAgent"), done, total: ms.length })}
          </div>
        </div>
        <div className="col" style={{ "--gap": "2px", textAlign: "right", alignItems: "flex-end" } as React.CSSProperties}>
          <b className="num" style={{ fontSize: 20 }}>
            {money(e.amountUsdc)}
          </b>
          <span className="tiny faint">{t("held", { amount: f.usdc(e.amountUsdc) })}</span>
        </div>
        <Chip tone={chipTone}>{t(chipKey)}</Chip>
      </div>
      <div className="g2 gsp" style={{ "--gap": "0" } as React.CSSProperties}>
        <div style={{ padding: "24px 26px" }}>
          <span className="eyebrow">{t("steps")}</span>
          <div className="steps" style={{ marginTop: 16 }}>
            {ms.map((m, i) => {
              const st = STATUS[m.status];
              const x = m.extra;
              const manual = x?.verify === "manual";
              const criteria = x?.criteria ?? splitCriteria(m.criteria);
              const label = m.status === "passed" && manual ? t("status.passedManual") : t(`status.${m.status}`);
              return (
                <div className="step" key={i}>
                  <span className={`dot ${st.dot}`}>{mark(m.status, i)}</span>
                  <div className="col grow" style={{ "--gap": "4px" } as React.CSSProperties}>
                    <div className="row wrapx" style={{ "--gap": "6px 10px" } as React.CSSProperties}>
                      <b>{m.title}</b>
                      {x ? <span className="tiny faint num">{money(x.amountUsdc)}</span> : null}
                      {manual ? <Chip icon="eye">{t("reviewYours")}</Chip> : null}
                    </div>
                    <ul className="small muted" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                      {criteria.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                    <div className={`small ${st.tone}`} style={{ fontWeight: 600 }}>
                      {label}
                      {m.status === "disputed" && x?.disputeCriterion ? <span className="muted"> · {t("criterion", { criterion: x.disputeCriterion })}</span> : null}
                    </div>
                    {m.status === "pending" && deadline && i === firstPending && e.status === "active" ? (
                      <span className={`tiny ${overdue ? "warn" : "faint"}`}>{overdue ? t("overdue") : t("deliverBy", { date: f.date(deadline) })}</span>
                    ) : null}
                    {m.status === "pending" && x?.canCancelUndelivered ? (
                      <CancelUndelivered amount={money(x.amountUsdc)} pending={tx.pending} onConfirm={() => void cancelUndelivered(i)} />
                    ) : null}
                    {x?.tests && x.tests.mode !== "manual" && x.tests.total > 0 && (m.status === "passed" || m.status === "approved") ? (
                      <span className="tiny faint">
                        {t("tests", { passed: x.tests.passed, total: x.tests.total })}
                      </span>
                    ) : null}
                    {m.status === "approved" && (x?.previewUrl || x?.downloadable) ? (
                      <div className="row wrapx" style={{ "--gap": "8px", marginTop: 4 } as React.CSSProperties}>
                        {x?.previewUrl ? (
                          <Button variant="ghost" size="sm" icon="eye" href={x.previewUrl} target="_blank">
                            {t("viewPreview")}
                          </Button>
                        ) : null}
                        {x?.downloadable ? <Deliverable escrowId={e.id} index={i} /> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="col gcol" style={{ padding: "24px 26px", background: "var(--surface-2)", "--gap": "16px" } as React.CSSProperties}>
          {focus ? (
            <>
              <span className="eyebrow">{t("previewEyebrow", { title: focus.title })}</span>
              <div className="preview" style={{ minHeight: 180 }}>
                {isDesign ? (
                  <div className="row" style={{ "--gap": "12px", padding: 18, justifyContent: "center" } as React.CSSProperties} aria-hidden>
                    {[0, 1, 2].map((k) => (
                      <div key={k} className="phone" style={{ maxWidth: 96, minHeight: 170, borderWidth: 4, padding: 8, borderRadius: 16 }}>
                        <div className="blk" style={{ height: 16, background: k === 0 ? "var(--brand)" : undefined }} />
                        <div className="ln" style={{ width: "60%" }} />
                        <div className="blk" style={{ height: 40 }} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="col" style={{ "--gap": "9px", padding: "20px 26px" } as React.CSSProperties} aria-hidden>
                    <div className="skel" style={{ width: "50%", height: 12, background: "var(--ink)", opacity: 0.7 }} />
                    <div className="skel" />
                    <div className="skel redact" style={{ width: "80%" }} />
                    <div className="skel" />
                    <div className="skel" style={{ width: "90%" }} />
                    <div className="skel redact" style={{ width: "60%" }} />
                    <div className="skel" />
                    <div className="skel" style={{ width: "70%" }} />
                  </div>
                )}
                <div className="wm" />
                {focus.extra?.previewUrl ? (
                  <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                    <Button variant="secondary" icon="external" href={focus.extra.previewUrl} target="_blank">
                      {t("openPreview")}
                    </Button>
                  </div>
                ) : null}
              </div>
              {cd ? (
                <div className="row card pad-s countdown-box" style={{ "--gap": "12px", padding: "14px 18px" } as React.CSSProperties}>
                  <Icon name="clock" size="l" className={cd.urgent ? "warn" : undefined} />
                  <div className="grow">
                    <div className="small muted">{cd.done ? t("autoApprove") : t("autoApproveIn")}</div>
                    <b className="num" style={{ fontSize: cd.done ? 16 : 22, letterSpacing: ".02em", whiteSpace: "nowrap" }} role="timer" aria-live="off">
                      {cd.done ? cd.text : cd.clock}
                    </b>
                  </div>
                  <span className="tiny faint cd-note" style={{ maxWidth: 150 }}>
                    {t("autoNote")}
                  </span>
                </div>
              ) : null}
              {!disputing ? (
                <div className="row wrapx act-row" style={{ "--gap": "10px" } as React.CSSProperties}>
                  <Button variant="primary" size="lg" className="grow" icon="check" loading={tx.pending} onClick={approve}>
                    {t("approve")}
                  </Button>
                  {!cd?.done ? (
                    <Button
                      variant="danger"
                      size="lg"
                      icon="flag"
                      // Os critérios vêm do detalhe (getMyEscrow) ou, se ele falhou, do texto da garantia.
                      disabled={tx.pending || !focusCriteria.length}
                      onClick={() => {
                        tx.reset();
                        setDisputing(true);
                      }}
                    >
                      {t("dispute")}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <DisputeForm
                  criteria={focusCriteria}
                  pending={tx.pending}
                  onCancel={() => {
                    tx.reset();
                    setDisputing(false);
                  }}
                  onSend={sendDispute}
                />
              )}
            </>
          ) : e.status === "active" && submitted ? (
            <div className="col" style={{ "--gap": "10px", alignItems: "flex-start" } as React.CSSProperties}>
              <Chip tone="brand" icon="refresh">
                {t("verifyingChip")}
              </Chip>
              <p className="muted">{t("verifyingText", { title: submitted.title })}</p>
            </div>
          ) : e.status === "active" && !disputed ? (
            <div className="col" style={{ "--gap": "10px", alignItems: "flex-start" } as React.CSSProperties}>
              <Chip icon="clock">{t("waitingChip")}</Chip>
              <p className="muted">{t("waitingText")}</p>
            </div>
          ) : null}
          {detailFailed && !detail ? (
            <div className="row card-flat pad-s wrapx" style={{ "--gap": "10px", background: "var(--surface)" } as React.CSSProperties} role="status">
              <span className="warn">
                <Icon name="info" size="s" />
              </span>
              <span className="small grow">{t("detailFailed")}</span>
              <Button
                variant="secondary"
                size="sm"
                icon="refresh"
                loading={retrying}
                onClick={async () => {
                  setRetrying(true);
                  try {
                    await onRetryDetail?.();
                  } finally {
                    setRetrying(false);
                  }
                }}
              >
                {ts("retry")}
              </Button>
            </div>
          ) : null}
          {tx.error ? (
            <Notice tone="bad" role="alert" title={tx.error.title}>
              {tx.error.text}
            </Notice>
          ) : null}
          {msg ? (
            <div className="row card-flat pad-s" style={{ "--gap": "10px", background: "var(--surface)" } as React.CSSProperties} role="status">
              <span className={msg.tone}>
                <Icon name="info" size="s" />
              </span>
              <span className="small grow">{msg.text}</span>
            </div>
          ) : disputed ? (
            <div className="row card-flat pad-s" style={{ "--gap": "10px", background: "var(--surface)" } as React.CSSProperties} role="status">
              <span className="warn">
                <Icon name="info" size="s" />
              </span>
              <span className="small grow">
                {t("disputeReview")}
                {disputed.extra?.disputedAt
                  ? disputed.extra.disputeDeadline
                    ? ` ${t("disputeDeadline", { date: f.date(disputed.extra.disputeDeadline) })}`
                    : ` ${t("disputeAdmin")}`
                  : ""}
              </span>
            </div>
          ) : null}
          {detail ? (
            <a className="link small row" style={{ "--gap": "6px" } as React.CSSProperties} href={detail.explorerUrl} target="_blank" rel="noopener noreferrer">
              {t("explorer")} <Icon name="external" size="s" />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
