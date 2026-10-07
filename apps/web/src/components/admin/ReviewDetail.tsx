"use client";
// Revisão de um pacote (/admin/reviews/[id]): resumo, validador, diff por arquivo, varreduras, conhecimento, histórico,
// checklist da PACKAGE_SPEC.md 14.5 e as decisões.
// SEGURANÇA: tudo que veio do criador (manifesto, etapas, templates, evals, conhecimento, notas) é mostrado como TEXTO
// do React (escapado), em bloco monoespaçado. Nunca dangerouslySetInnerHTML, nunca Markdown renderizado, nunca um
// link montado a partir do conteúdo. Caracteres invisíveis e de direção viram marcas visíveis ([U+202E]).
import { REVIEW_CHECKLIST_KEYS, reviewChecklistComplete, type AdminSubmissionDetail, type ReviewChecklist } from "@solvers/api-client";
import { ApiError } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { StatusChip, Timeline, ValidationList } from "@/components/creator/SubmissionParts";
import creator from "@/components/creator/creator.module.css";
import { Ago } from "@/components/ui/Ago";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Dialog } from "@/components/ui/Dialog";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";
import { Loading } from "@/components/ui/Spinner";
import { Notice, useToast } from "@/components/ui/Toast";
import { useErrorText } from "@/lib/error-text";
import { short, useFormat } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { prettyJson, revealHidden } from "@/lib/submissions-ui";
import { Untrusted } from "@/components/ui/Untrusted";
import { AdminGate } from "./AdminGate";

const ACTIONS = ["approve", "request_changes", "reject", "finish", "suspend", "resume"];

const DIFF_TONE = { added: "ok", changed: "warn", removed: "red", same: "default" } as const;

type State = { kind: "loading" } | { kind: "missing" } | { kind: "error"; error: unknown } | { kind: "ok"; d: AdminSubmissionDetail };

export function ReviewDetailView({ id }: { id: string }) {
  return (
    <AdminGate>
      <Detail id={id} />
    </AdminGate>
  );
}

function Detail({ id }: { id: string }) {
  const t = useTranslations("admin");
  const errorText = useErrorText();
  const { api } = useSession();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setState({ kind: "loading" });
      try {
        setState({ kind: "ok", d: await api.adminGetSubmission(id) });
      } catch (e) {
        if (silent) return;
        if (e instanceof ApiError && e.status === 404) setState({ kind: "missing" });
        else setState({ kind: "error", error: e });
      }
    },
    [api, id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="col" style={gap(20)}>
      <div>
        <Link className="link small" href="/admin/reviews">
          <Icon name="arrow-left" size="s" /> {t("detail.back")}
        </Link>
      </div>
      {state.kind === "loading" ? <Loading text={t("detail.loading")} /> : null}
      {state.kind === "missing" ? (
        <Empty icon="search" title={t("detail.missingTitle")} action={<Button href="/admin/reviews">{t("detail.missingBack")}</Button>}>
          {t("detail.missingText")}
        </Empty>
      ) : null}
      {state.kind === "error" ? (
        <Empty icon="warning" title={t("detail.errorTitle")} action={<Button onClick={() => void load()}>{t("detail.retry")}</Button>}>
          {errorText(state.error)}
        </Empty>
      ) : null}
      {state.kind === "ok" ? <Review d={state.d} reload={() => load(true)} /> : null}
    </div>
  );
}

/** Texto do criador como texto puro. Mostra quantos caracteres invisíveis foram tornados visíveis. */
function RawText({ text, label }: { text: string; label: string }) {
  const t = useTranslations("admin.raw");
  const { text: shown, count } = revealHidden(text);
  return (
    <div className="col" style={gap(6)}>
      {count ? (
        <Notice tone="warn" role="alert" title={t("hiddenTitle", { n: count })}>
          {t("hiddenText")}
        </Notice>
      ) : null}
      <pre className={creator.raw} tabIndex={0} aria-label={label}>
        {shown}
      </pre>
    </div>
  );
}

function Section({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card pad col" style={gap(16)} aria-labelledby={id}>
      <div className="row between wrapx" style={gap(10)}>
        <h2 className="h3" id={id}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Review({ d, reload }: { d: AdminSubmissionDetail; reload: () => Promise<void> }) {
  const t = useTranslations("admin");
  const f = useFormat();
  const sub = d.submission;
  const m = d.manifest;
  const text = (k: string): string | null => {
    const v = m?.[k];
    return typeof v === "string" || typeof v === "number" ? String(v) : null;
  };
  const pricing = m?.pricing && typeof m.pricing === "object" ? (m.pricing as Record<string, unknown>) : null;
  const price = pricing && typeof pricing.priceUsdc === "number" ? pricing.priceUsdc : null;
  const proven = new Set(d.differentiators.proven);

  return (
    <div className="split">
      <div className="col" style={gap(20)}>
        <div className="col" style={gap(8)}>
          <div className="row wrapx" style={gap(8)}>
            <span className="eyebrow">{t("header.eyebrow")}</span>
            <Chip tone={d.isNewAgent ? "brand" : "default"}>{d.isNewAgent ? t("header.newSolver") : t("header.newVersion")}</Chip>
            <StatusChip status={sub.status} nextAction={sub.nextAction} />
          </div>
          <h1 className="display h2s" style={{ overflowWrap: "anywhere" }}>
            <Untrusted>{sub.name || sub.slug}</Untrusted>
          </h1>
          <p className="small muted" style={{ overflowWrap: "anywhere" }}>
            <span className="mono">{sub.slug}</span> · v{sub.version} · {f.fileSize(sub.sizeBytes)} · {t.rich("header.sent", { ago: () => <Ago iso={sub.createdAt} /> })}
          </p>
        </div>

        <Section id="rv-resumo" title={t("summary.title")}>
          <dl className="col" style={gap(10)}>
            <Row label={t("summary.creator")}>
              <span style={{ overflowWrap: "anywhere" }}><Untrusted>{d.creator.name || t("summary.noName")}</Untrusted></span>{" "}
              <Chip tone={d.creator.contactVerified ? "ok" : "warn"}>{d.creator.contactVerified ? t("summary.verified") : t("summary.unverified")}</Chip>
            </Row>
            <Row label={t("summary.wallet")}>
              <span className="mono" style={{ overflowWrap: "anywhere" }}>
                {d.creator.wallet}
              </span>
            </Row>
            {d.creator.bio ? (
              <Row label={t("summary.bio")}>
                <span style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}><Untrusted>{d.creator.bio}</Untrusted></span>
              </Row>
            ) : null}
            {text("category") ? <Row label={t("summary.category")}><Untrusted>{text("category")}</Untrusted></Row> : null}
            {text("tagline") ? (
              <Row label={t("summary.tagline")}>
                <span style={{ overflowWrap: "anywhere" }}><Untrusted>{text("tagline")}</Untrusted></span>
              </Row>
            ) : null}
            {price !== null ? <Row label={t("summary.price")}>{f.usdc(price)}</Row> : null}
            <Row label={t("summary.differentiators")}>
              {d.differentiators.declared.length === 0 ? (
                <span className="muted">{t("summary.none")}</span>
              ) : (
                <span className="row wrapx" style={gap(6)}>
                  {d.differentiators.declared.map((k) => (
                    <Chip key={k} tone={proven.has(k) ? "ok" : "warn"} icon={proven.has(k) ? "check-circle" : "warning"}>
                      {t.has(`differentiator.${k}`) ? t(`differentiator.${k}`) : k}
                      <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                        {proven.has(k) ? t("summary.proven") : t("summary.notProven")}
                      </span>
                    </Chip>
                  ))}
                </span>
              )}
            </Row>
          </dl>
          {text("description") ? (
            <div className="col" style={gap(6)}>
              <span className="label">{t("summary.description")}</span>
              <RawText text={text("description") ?? ""} label={t("summary.descriptionAria")} />
            </div>
          ) : null}
        </Section>

        <Section id="rv-validador" title={t("validator.title")} aside={<Chip tone={d.validation && d.validation.errors.length === 0 ? "ok" : "red"}>{d.validation ? t("validator.counts", { errors: d.validation.errors.length, warnings: d.validation.warnings.length }) : t("validator.noResult")}</Chip>}>
          {d.validation ? <ValidationList report={d.validation} /> : <p className="small muted">{t("validator.noResultText")}</p>}
        </Section>

        <Section id="rv-varreduras" title={t("scans.title")}>
          <p className="small muted">{t("scans.intro")}</p>
          <Scans scans={d.scans} />
        </Section>

        <Files id={sub.id} files={d.files} />

        <DiffSection scans={d.scans} />

        <Knowledge id={sub.id} k={d.knowledge} />

        <Section id="rv-manifesto" title={t("manifest.title")}>
          {m ? <RawText text={prettyJson(m)} label={t("manifest.aria")} /> : <p className="small muted">{t("manifest.none")}</p>}
        </Section>

        <Section id="rv-historico" title={t("history.title")}>
          {d.reviews.length === 0 ? (
            <p className="small muted">{t("history.none")}</p>
          ) : (
            <ul className="col" style={gap(14)}>
              {d.reviews.map((r) => {
                const done = REVIEW_CHECKLIST_KEYS.filter((k) => r.checklist[k]).length;
                return (
                  <li key={r.id} className="card-flat pad-s col" style={gap(6)}>
                    <div className="row between wrapx" style={gap(8)}>
                      <b>{ACTIONS.includes(r.action) ? t(`history.actions.${r.action}`) : r.action}</b>
                      <span className="tiny faint">
                        <Ago iso={r.createdAt} /> · <span className="mono">{short(r.reviewerWallet)}</span>
                      </span>
                    </div>
                    {r.notes ? <p className="small" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><Untrusted>{r.notes}</Untrusted></p> : null}
                    <span className="tiny faint">
                      {t("history.checklist", { done, total: REVIEW_CHECKLIST_KEYS.length })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>

      <aside className="sticky col" style={gap(16)} aria-label={t("decision.asideAria")}>
        <Decision d={d} reload={reload} />
        <div className="card pad col" style={gap(14)}>
          <h2 className="h4">{t("decision.progress")}</h2>
          <Timeline status={sub.status} nextAction={sub.nextAction} />
        </div>
      </aside>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row start" style={gap(12)}>
      <dt className="small muted" style={{ width: 110, flex: "none" }}>
        {label}
      </dt>
      <dd className="grow" style={{ margin: 0, minWidth: 0 }}>
        {children}
      </dd>
    </div>
  );
}

type ScanFinding = { kind: string; severity: "info" | "warn" | "high"; path: string; snippet: string; detail: string };
type ScansShape = {
  report?: { findings?: ScanFinding[]; counts?: { total?: number; high?: number; warn?: number; info?: number; suppressed?: number } };
  diff?: { changed?: { path: string; unified: string; truncated: boolean }[]; truncated?: boolean };
};

const SEVERITY_TONE = { high: "red", warn: "warn", info: "default" } as const;

/** Varreduras do worker: `scans.report` (achados e contagens) e `scans.diff` (o texto do diff vai na seção de arquivos). Tudo texto escapado. */
function Scans({ scans }: { scans: Record<string, unknown> | null }) {
  const t = useTranslations("admin.scans");
  if (!scans || Object.keys(scans).length === 0) return <p className="small muted">{t("none")}</p>;
  const report = (scans as ScansShape).report;
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const counts = report?.counts;
  if (!report) {
    return <RawText text={prettyJson(scans)} label={t("rawAria")} />;
  }
  return (
    <div className="col" style={gap(10)}>
      <div className="row wrapx" style={gap(8)}>
        <Chip tone={counts?.high ? "red" : "ok"}>{t("high", { n: counts?.high ?? 0 })}</Chip>
        <Chip tone={counts?.warn ? "warn" : "ok"}>{t("medium", { n: counts?.warn ?? 0 })}</Chip>
        <Chip>{t("info", { n: counts?.info ?? 0 })}</Chip>
        {counts?.suppressed ? <Chip tone="warn">{t("suppressed", { n: counts.suppressed })}</Chip> : null}
      </div>
      {findings.length === 0 ? <p className="small muted">{t("nothing")}</p> : null}
      {findings.map((f, i) => (
        <details key={`${f.kind}-${f.path}-${i}`} className="card-flat pad-s" open={f.severity === "high"}>
          <summary style={{ cursor: "pointer", minHeight: 32, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Chip tone={SEVERITY_TONE[f.severity] ?? "default"}>{f.severity in SEVERITY_TONE ? t(`severity.${f.severity}`) : f.severity}</Chip>
            <b className="mono" style={{ overflowWrap: "anywhere" }}>
              {revealHidden(f.kind).text}
            </b>
            <span className="tiny faint mono" style={{ overflowWrap: "anywhere" }}>
              {revealHidden(f.path).text}
            </span>
          </summary>
          <div className="col" style={{ ...gap(6), paddingTop: 10 }}>
            <p className="small" style={{ overflowWrap: "anywhere" }}>
              {revealHidden(f.detail).text}
            </p>
            <RawText text={f.snippet} label={t("snippetAria", { kind: f.kind })} />
          </div>
        </details>
      ))}
    </div>
  );
}

/** Diff com texto de cada arquivo que mudou contra a versão publicada (`scans.diff.changed`). */
function DiffSection({ scans }: { scans: Record<string, unknown> | null }) {
  const t = useTranslations("admin.diff");
  const diff = (scans as ScansShape | null)?.diff;
  const changed = Array.isArray(diff?.changed) ? diff.changed : [];
  if (changed.length === 0) return null;
  return (
    <Section id="rv-diff" title={t("title")} aside={diff?.truncated ? <Chip tone="warn">{t("truncated")}</Chip> : undefined}>
      <p className="small muted">{t("intro")}</p>
      {changed.map((f) => (
        <details key={f.path} className="card-flat pad-s">
          <summary style={{ cursor: "pointer", minHeight: 32, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <b className="mono" style={{ overflowWrap: "anywhere" }}>
              {revealHidden(f.path).text}
            </b>
            {f.truncated ? <Chip tone="warn">{t("fileTruncated")}</Chip> : null}
          </summary>
          <div style={{ paddingTop: 10 }}>
            <RawText text={f.unified} label={t("aria", { path: f.path })} />
          </div>
        </details>
      ))}
    </Section>
  );
}

const GROUPS: { id: string; match: (p: string) => boolean }[] = [
  { id: "manifest", match: (p) => p === "manifest.json" || p.startsWith("steps/") },
  { id: "templates", match: (p) => p.startsWith("templates/") },
  { id: "evals", match: (p) => p.startsWith("evals/") },
  { id: "knowledge", match: (p) => p.startsWith("knowledge/") },
];

function Files({ id, files }: { id: string; files: AdminSubmissionDetail["files"] }) {
  const t = useTranslations("admin.files");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const counts = { added: 0, changed: 0, removed: 0, same: 0 };
  for (const f of files) counts[f.diff]++;
  const shown = onlyChanged ? files.filter((f) => f.diff !== "same") : files;
  const used = new Set<string>();
  const groups = GROUPS.map((g) => {
    const list = shown.filter((f) => g.match(f.path));
    list.forEach((f) => used.add(f.path));
    return { ...g, list };
  });
  const others = shown.filter((f) => !used.has(f.path));
  if (others.length) groups.push({ id: "others", match: () => false, list: others });

  return (
    <Section
      id="rv-arquivos"
      title={t("title")}
      aside={
        <button type="button" className={["chip", onlyChanged ? "on" : ""].join(" ")} style={{ minHeight: 44 }} aria-pressed={onlyChanged} onClick={() => setOnlyChanged((v) => !v)}>
          {t("onlyChanged")}
        </button>
      }
    >
      <p className="small muted">
        {t("summary", counts)}
      </p>
      {files.length === 0 ? <p className="small muted">{t("empty")}</p> : null}
      {groups
        .filter((g) => g.list.length)
        .map((g) => (
          <div key={g.id} className="col" style={gap(4)}>
            <h3 className="h4">
              {t(`groups.${g.id}`)} <span className="tiny faint">({g.list.length})</span>
            </h3>
            <ul>
              {g.list.map((f) => (
                <FileItem key={f.path} id={id} file={f} />
              ))}
            </ul>
          </div>
        ))}
    </Section>
  );
}

function FileItem({ id, file }: { id: string; file: AdminSubmissionDetail["files"][number] }) {
  const t = useTranslations("admin.files");
  const errorText = useErrorText();
  const f = useFormat();
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<{ kind: "loading" } | { kind: "error"; error: unknown } | { kind: "ok"; text: string } | null>(null);
  const panel = `file-${file.path.replace(/[^a-zA-Z0-9]/g, "-")}`;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !content) {
      setContent({ kind: "loading" });
      try {
        const r = await api.adminGetSubmissionFile(id, file.path);
        setContent({ kind: "ok", text: r.content });
      } catch (e) {
        setContent({ kind: "error", error: e });
        setOpen(true);
      }
    }
  }

  return (
    <li>
      <button type="button" className={creator.fileBtn} aria-expanded={open} aria-controls={panel} onClick={() => void toggle()} disabled={file.diff === "removed"}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size="s" />
        <span className={creator.fileName}>{revealHidden(file.path).text}</span>
        <span className="tiny faint">{f.fileSize(file.size)}</span>
        <Chip tone={DIFF_TONE[file.diff]}>{t(`diffLabel.${file.diff}`)}</Chip>
      </button>
      <div id={panel} hidden={!open} style={{ padding: "6px 10px 12px" }}>
        {open && content?.kind === "loading" ? <Loading text={t("loading")} /> : null}
        {open && content?.kind === "error" ? (
          <p className="small bad" role="alert">
            {errorText(content.error)}
          </p>
        ) : null}
        {open && content?.kind === "ok" ? <RawText text={content.text} label={t("contentAria", { path: file.path })} /> : null}
      </div>
    </li>
  );
}

function Knowledge({ id, k }: { id: string; k: AdminSubmissionDetail["knowledge"] }) {
  const t = useTranslations("admin.knowledge");
  const errorText = useErrorText();
  const f = useFormat();
  const { api } = useSession();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "error"; error: unknown } | { kind: "ok"; items: { source: string; content: string; score: number }[] }>({ kind: "idle" });
  const ingest = t(`ingestStatus.${k.ingest}`);

  async function search(e: FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (text.length < 2) return;
    setRes({ kind: "loading" });
    try {
      const r = await api.adminSearchSubmissionKnowledge(id, text);
      setRes({ kind: "ok", items: r.hits });
    } catch (err) {
      setRes({ kind: "error", error: err });
    }
  }

  return (
    <Section id="rv-conhecimento" title={t("title")} aside={<Chip tone={k.ingest === "done" ? "ok" : k.ingest === "failed" ? "red" : "default"}>{t("ingest", { status: ingest })}</Chip>}>
      <p className="small muted">
        {t("counts", { files: k.files, chunks: k.chunks, expired: k.expiredChunks })}
      </p>
      {k.expiredChunks > 0 ? (
        <Notice tone="warn" role="note">
          {t("expiredNotice")}
        </Notice>
      ) : null}
      <form className="col" style={gap(10)} onSubmit={search}>
        <label className="label" htmlFor="kb-q">
          {t("searchLabel")}
        </label>
        <div className="row m-col" style={gap(10)}>
          <input id="kb-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} placeholder={t("searchPlaceholder")} disabled={k.ingest === "none"} />
          <Button type="submit" variant="secondary" icon="search" loading={res.kind === "loading"} disabled={k.ingest === "none" || q.trim().length < 2}>
            {t("search")}
          </Button>
        </div>
      </form>
      {res.kind === "error" ? (
        <p className="small bad" role="alert">
          {errorText(res.error)}
        </p>
      ) : null}
      {res.kind === "ok" ? (
        res.items.length === 0 ? (
          <p className="small muted" role="status">
            {t("noHits")}
          </p>
        ) : (
          <ul className="col" style={gap(12)} aria-label={t("resultsAria")}>
            {res.items.map((it, i) => (
              <li key={i} className="col" style={gap(6)}>
                <span className="tiny faint">
                  <span className="mono" style={{ overflowWrap: "anywhere" }}>
                    {revealHidden(it.source).text}
                  </span>{" "}
                  · {t("relevance", { score: f.num(it.score, 0, 2) })}
                </span>
                <RawText text={it.content} label={t("hitAria", { n: i + 1, source: it.source })} />
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Section>
  );
}

type Pending = "approve" | "request_changes" | "reject" | "revoke" | "finish" | null;

function Decision({ d, reload }: { d: AdminSubmissionDetail; reload: () => Promise<void> }) {
  const t = useTranslations("admin.decision");
  const tStatus = useTranslations("admin.status");
  const errorText = useErrorText();
  const { api } = useSession();
  const toast = useToast();
  const sub = d.submission;
  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => Object.fromEntries(REVIEW_CHECKLIST_KEYS.map((k) => [k, false])));
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState(false);
  const [confirm, setConfirm] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inReview = sub.status === "pending_review";
  const canReject = inReview || sub.status === "changes_requested";
  const canRevoke = sub.status === "awaiting_creator_signature";
  const canFinish = sub.status === "awaiting_onchain_approval" || sub.status === "publishing" || sub.status === "publish_failed";
  const complete = reviewChecklistComplete(checklist);
  const notesOk = notes.trim().length >= 3;
  const noteError = touched && !notesOk ? t("notesError") : null;

  async function run(action: Exclude<Pending, null>) {
    setBusy(true);
    setError(null);
    const input = { notes: notes.trim(), checklist: checklist as ReviewChecklist };
    try {
      if (action === "approve") await api.adminApproveSubmission(sub.id, input);
      else if (action === "request_changes") await api.adminRequestChanges(sub.id, input);
      else if (action === "reject") await api.adminRejectSubmission(sub.id, input);
      else if (action === "revoke") await api.adminRevokeSubmission(sub.id, input);
      else {
        // O servidor responde 200 mesmo quando nada foi publicado (`not_ready`, `busy`, `failed`): o resultado é que diz.
        const r = await api.adminFinishSubmission(sub.id);
        if (r.outcome !== "published" && r.outcome !== "already_published") {
          setConfirm(null);
          toast({
            tone: r.outcome === "failed" ? "bad" : "warn",
            title: t("toast.notPublishedTitle"),
            text:
              r.outcome === "busy"
                ? t("toast.busy")
                : r.outcome === "failed"
                  ? t("toast.failed", { error: r.error ?? t("toast.internalError") })
                  : r.step === "await-admin-approval"
                    ? t("toast.awaitAdmin", { slug: sub.slug })
                    : t("toast.missingStep", { step: r.step ?? t("toast.missingChain") }),
            durationMs: 12000,
          });
          await reload();
          return;
        }
      }
      setConfirm(null);
      toast({
        tone: "ok",
        title: { approve: t("toast.approved"), request_changes: t("toast.changesRequested"), reject: t("toast.rejected"), revoke: t("toast.revoked"), finish: t("toast.finished") }[action],
        text: action === "approve" ? t("toast.approvedText") : undefined,
      });
      setNotes("");
      setTouched(false);
      await reload();
    } catch (e) {
      setConfirm(null);
      setError(e instanceof ApiError ? `${errorText(e)}${e.code && e.code !== "error" ? ` (${e.code})` : ""}` : errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function ask(action: Exclude<Pending, null>) {
    if (action !== "finish") {
      setTouched(true);
      if (!notesOk) return;
      if (action === "approve" && !complete) return;
    }
    setConfirm(action);
  }

  return (
    <div className="card pad col" style={gap(16)}>
      <h2 className="h3">{t("title")}</h2>

      {!inReview && !canReject && !canRevoke && !canFinish ? (
        <Notice tone="info" role="note">
          {t("noDecision", { status: tStatus(`${sub.status}`) })}
        </Notice>
      ) : null}

      {inReview || canReject || canRevoke ? (
        <>
          <div className="col" style={gap(8)} role="group" aria-label={t("checklistAria")}>
            <span className="label">{t("checklist")}</span>
            {REVIEW_CHECKLIST_KEYS.map((k) => (
              <button key={k} type="button" role="checkbox" aria-checked={!!checklist[k]} className={creator.checkRow} onClick={() => setChecklist((c) => ({ ...c, [k]: !c[k] }))}>
                <span className={["check", checklist[k] ? "on" : ""].join(" ")} aria-hidden>
                  {checklist[k] ? <Icon name="check" size="s" /> : null}
                </span>
                <span className="small grow">{t(`checklistItems.${k}`)}</span>
              </button>
            ))}
            {inReview && !complete ? <span className="hint">{t("checklistRequired")}</span> : null}
          </div>
          <div className="field">
            <label className="label" htmlFor="rv-notes">
              {t("notesLabel")}
            </label>
            <textarea id="rv-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} aria-invalid={!!noteError} aria-describedby="rv-notes-hint" />
            {noteError ? (
              <span className="hint" style={{ color: "var(--red)" }} role="alert">
                {noteError}
              </span>
            ) : (
              <span className="hint" id="rv-notes-hint">
                {t("notesHint")}
              </span>
            )}
          </div>
        </>
      ) : null}

      {error ? (
        <Notice tone="bad" role="alert" title={t("errorTitle")}>
          {error}
        </Notice>
      ) : null}

      <div className="col" style={gap(10)}>
        {inReview ? (
          <>
            <Button size="lg" block variant="ok" icon="check-circle" onClick={() => ask("approve")} disabled={!complete}>
              {t("approve")}
            </Button>
            <Button block variant="secondary" icon="message" onClick={() => ask("request_changes")}>
              {t("requestChanges")}
            </Button>
          </>
        ) : null}
        {canReject ? (
          <Button block variant="danger" icon="x" onClick={() => ask("reject")}>
            {t("reject")}
          </Button>
        ) : null}
        {canRevoke ? (
          <>
            <p className="small muted">{t("revokeHelp")}</p>
            <Button block variant="danger" icon="x" onClick={() => ask("revoke")}>
              {t("revoke")}
            </Button>
          </>
        ) : null}
        {canFinish ? (
          <>
            <p className="small muted">{t.rich("finishHelp", { code: (chunks) => <code>{chunks}</code> })}</p>
            <Button size="lg" block icon="check" onClick={() => ask("finish")}>
              {t("finish")}
            </Button>
          </>
        ) : null}
      </div>
      {inReview ? <p className="tiny faint">{t("approveHelp")}</p> : null}

      {confirm ? <ConfirmDialog action={confirm} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void run(confirm)} /> : null}
    </div>
  );
}

const CONFIRM_VARIANT: Record<Exclude<Pending, null>, "ok" | "danger" | "primary" | "secondary"> = {
  approve: "ok",
  request_changes: "primary",
  reject: "danger",
  revoke: "danger",
  finish: "primary",
};

function ConfirmDialog({ action, busy, onCancel, onConfirm }: { action: Exclude<Pending, null>; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const t = useTranslations("admin.decision");
  return (
    <Dialog title={t(`confirm.${action}.title`)} onClose={onCancel} locked={busy}>
      <div className="col" style={gap(16)}>
        <p className="muted">{t(`confirm.${action}.text`)}</p>
        <div className="row wrapx" style={gap(10)}>
          <Button variant={CONFIRM_VARIANT[action]} loading={busy} onClick={onConfirm}>
            {t(`confirm.${action}.label`)}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            {t("back")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
