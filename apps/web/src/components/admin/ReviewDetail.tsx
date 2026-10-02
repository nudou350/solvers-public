"use client";
// Revisão de um pacote (/admin/revisoes/[id]): resumo, validador, diff por arquivo, varreduras, conhecimento, histórico,
// checklist da PACKAGE_SPEC.md 14.5 e as decisões.
// SEGURANÇA: tudo que veio do criador (manifesto, etapas, templates, evals, conhecimento, notas) é mostrado como TEXTO
// do React (escapado), em bloco monoespaçado. Nunca dangerouslySetInnerHTML, nunca Markdown renderizado, nunca um
// link montado a partir do conteúdo. Caracteres invisíveis e de direção viram marcas visíveis ([U+202E]).
import { REVIEW_CHECKLIST_KEYS, reviewChecklistComplete, type AdminSubmissionDetail, type ReviewChecklist } from "@solvers/api-client";
import { ApiError } from "@solvers/api-client";
import Link from "next/link";
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
import { differentiatorLabel } from "@/lib/differentiators";
import { short } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { fileSizeText, loadErrorText, prettyJson, revealHidden, statusInfo } from "@/lib/submissions-ui";
import { AdminGate } from "./AdminGate";

const CHECKLIST_LABEL: Record<(typeof REVIEW_CHECKLIST_KEYS)[number], string> = {
  promiseDelivered: "A promessa é entregue pelas etapas.",
  twoDifferentiatorsProven: "Pelo menos 2 dos 5 diferenciais estão comprovados.",
  rightsAndSources: "As fontes estão listadas e há permissão para o conteúdo de terceiros.",
  noHarmfulInstructions: "Nada age contra o usuário nem manda dados dele para fora, e não há injeção em nenhum texto (inclusive o que só aparece para uma consulta específica).",
  priceTrialShowcaseCoherent: "Preço, teste grátis e vitrine são coerentes, sem promessa de resultado financeiro, jurídico ou médico sem ressalva.",
};

const ACTION_LABEL: Record<string, string> = {
  approve: "Aprovou",
  request_changes: "Pediu mudanças",
  reject: "Recusou",
  finish: "Concluiu a publicação",
  suspend: "Suspendeu",
  resume: "Reativou",
};

const DIFF_LABEL = { added: "Novo", changed: "Mudou", removed: "Removido", same: "Igual" } as const;
const DIFF_TONE = { added: "ok", changed: "warn", removed: "red", same: "default" } as const;

type State = { kind: "loading" } | { kind: "missing" } | { kind: "error"; message: string } | { kind: "ok"; d: AdminSubmissionDetail };

export function ReviewDetailView({ id }: { id: string }) {
  return (
    <AdminGate>
      <Detail id={id} />
    </AdminGate>
  );
}

function Detail({ id }: { id: string }) {
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
        else setState({ kind: "error", message: loadErrorText(e) });
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
        <Link className="link small" href="/admin/revisoes">
          <Icon name="arrow-left" size="s" /> Fila de revisões
        </Link>
      </div>
      {state.kind === "loading" ? <Loading text="Carregando o envio…" /> : null}
      {state.kind === "missing" ? (
        <Empty icon="search" title="Envio não encontrado" action={<Button href="/admin/revisoes">Voltar à fila</Button>}>
          Este envio não existe.
        </Empty>
      ) : null}
      {state.kind === "error" ? (
        <Empty icon="warning" title="Não deu para carregar o envio" action={<Button onClick={() => void load()}>Tentar de novo</Button>}>
          {state.message}
        </Empty>
      ) : null}
      {state.kind === "ok" ? <Review d={state.d} reload={() => load(true)} /> : null}
    </div>
  );
}

/** Texto do criador como texto puro. Mostra quantos caracteres invisíveis foram tornados visíveis. */
function RawText({ text, label }: { text: string; label: string }) {
  const { text: shown, count } = revealHidden(text);
  return (
    <div className="col" style={gap(6)}>
      {count ? (
        <Notice tone="warn" role="alert" title={`${count} ${count === 1 ? "caractere invisível" : "caracteres invisíveis"} neste texto`}>
          Eles aparecem como [U+XXXX]. Caracteres invisíveis e de direção podem esconder instruções do olhar do revisor: confira cada um.
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
            <span className="eyebrow">Revisão</span>
            <Chip tone={d.isNewAgent ? "brand" : "default"}>{d.isNewAgent ? "Especialista novo" : "Nova versão"}</Chip>
            <StatusChip status={sub.status} nextAction={sub.nextAction} />
          </div>
          <h1 className="display h2s" style={{ overflowWrap: "anywhere" }}>
            {sub.name || sub.slug}
          </h1>
          <p className="small muted" style={{ overflowWrap: "anywhere" }}>
            <span className="mono">{sub.slug}</span> · v{sub.version} · {fileSizeText(sub.sizeBytes)} · enviado <Ago iso={sub.createdAt} />
          </p>
        </div>

        <Section id="rv-resumo" title="Resumo">
          <dl className="col" style={gap(10)}>
            <Row label="Criador">
              <span style={{ overflowWrap: "anywhere" }}>{d.creator.name || "Sem nome"}</span>{" "}
              <Chip tone={d.creator.contactVerified ? "ok" : "warn"}>{d.creator.contactVerified ? "Contato verificado" : "Contato não verificado"}</Chip>
            </Row>
            <Row label="Carteira">
              <span className="mono" style={{ overflowWrap: "anywhere" }}>
                {d.creator.wallet}
              </span>
            </Row>
            {d.creator.bio ? (
              <Row label="Bio">
                <span style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{d.creator.bio}</span>
              </Row>
            ) : null}
            {text("category") ? <Row label="Categoria">{text("category")}</Row> : null}
            {text("tagline") ? (
              <Row label="Frase curta">
                <span style={{ overflowWrap: "anywhere" }}>{text("tagline")}</span>
              </Row>
            ) : null}
            {price !== null ? <Row label="Preço">{price} USDC</Row> : null}
            <Row label="Diferenciais">
              {d.differentiators.declared.length === 0 ? (
                <span className="muted">Nenhum declarado</span>
              ) : (
                <span className="row wrapx" style={gap(6)}>
                  {d.differentiators.declared.map((k) => (
                    <Chip key={k} tone={proven.has(k) ? "ok" : "warn"} icon={proven.has(k) ? "check-circle" : "warning"}>
                      {differentiatorLabel(k)}
                      <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                        {proven.has(k) ? " (comprovado)" : " (não comprovado)"}
                      </span>
                    </Chip>
                  ))}
                </span>
              )}
            </Row>
          </dl>
          {text("description") ? (
            <div className="col" style={gap(6)}>
              <span className="label">Descrição enviada</span>
              <RawText text={text("description") ?? ""} label="Descrição enviada pelo criador" />
            </div>
          ) : null}
        </Section>

        <Section id="rv-validador" title="Validador" aside={<Chip tone={d.validation && d.validation.errors.length === 0 ? "ok" : "red"}>{d.validation ? `${d.validation.errors.length} erros · ${d.validation.warnings.length} avisos` : "Sem resultado"}</Chip>}>
          {d.validation ? <ValidationList report={d.validation} /> : <p className="small muted">Sem resultado de conferência.</p>}
        </Section>

        <Section id="rv-varreduras" title="Varreduras automáticas">
          <p className="small muted">Unicode oculto, HTML ou CSS escondido, padrões de injeção, URLs, conteúdo repetido de outros pacotes e frases de busca fora do assunto.</p>
          <Scans scans={d.scans} />
        </Section>

        <Files id={sub.id} files={d.files} />

        <DiffSection scans={d.scans} />

        <Knowledge id={sub.id} k={d.knowledge} />

        <Section id="rv-manifesto" title="Manifesto">
          {m ? <RawText text={prettyJson(m)} label="Manifesto como enviado" /> : <p className="small muted">Sem manifesto.</p>}
        </Section>

        <Section id="rv-historico" title="Histórico de revisões">
          {d.reviews.length === 0 ? (
            <p className="small muted">Ainda não há decisões neste envio.</p>
          ) : (
            <ul className="col" style={gap(14)}>
              {d.reviews.map((r) => {
                const done = REVIEW_CHECKLIST_KEYS.filter((k) => r.checklist[k]).length;
                return (
                  <li key={r.id} className="card-flat pad-s col" style={gap(6)}>
                    <div className="row between wrapx" style={gap(8)}>
                      <b>{ACTION_LABEL[r.action] ?? r.action}</b>
                      <span className="tiny faint">
                        <Ago iso={r.createdAt} /> · <span className="mono">{short(r.reviewerWallet)}</span>
                      </span>
                    </div>
                    {r.notes ? <p className="small" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.notes}</p> : null}
                    <span className="tiny faint">
                      Checklist: {done} de {REVIEW_CHECKLIST_KEYS.length} itens marcados
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>

      <aside className="sticky col" style={gap(16)} aria-label="Decisão">
        <Decision d={d} reload={reload} />
        <div className="card pad col" style={gap(14)}>
          <h2 className="h4">Andamento</h2>
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
const SEVERITY_LABEL = { high: "Alta", warn: "Média", info: "Aviso" } as const;

/** Varreduras do worker: `scans.report` (achados e contagens) e `scans.diff` (o texto do diff vai na seção de arquivos). Tudo texto escapado. */
function Scans({ scans }: { scans: Record<string, unknown> | null }) {
  if (!scans || Object.keys(scans).length === 0) return <p className="small muted">Sem resultado de varredura.</p>;
  const report = (scans as ScansShape).report;
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const counts = report?.counts;
  if (!report) {
    return <RawText text={prettyJson(scans)} label="Resultado das varreduras" />;
  }
  return (
    <div className="col" style={gap(10)}>
      <div className="row wrapx" style={gap(8)}>
        <Chip tone={counts?.high ? "red" : "ok"}>{counts?.high ?? 0} alta(s)</Chip>
        <Chip tone={counts?.warn ? "warn" : "ok"}>{counts?.warn ?? 0} média(s)</Chip>
        <Chip>{counts?.info ?? 0} aviso(s)</Chip>
        {counts?.suppressed ? <Chip tone="warn">{counts.suppressed} repetidos omitidos</Chip> : null}
      </div>
      {findings.length === 0 ? <p className="small muted">Nada achado pelas varreduras.</p> : null}
      {findings.map((f, i) => (
        <details key={`${f.kind}-${f.path}-${i}`} className="card-flat pad-s" open={f.severity === "high"}>
          <summary style={{ cursor: "pointer", minHeight: 32, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Chip tone={SEVERITY_TONE[f.severity] ?? "default"}>{SEVERITY_LABEL[f.severity] ?? f.severity}</Chip>
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
            <RawText text={f.snippet} label={`Trecho do achado ${f.kind}`} />
          </div>
        </details>
      ))}
    </div>
  );
}

/** Diff com texto de cada arquivo que mudou contra a versão publicada (`scans.diff.changed`). */
function DiffSection({ scans }: { scans: Record<string, unknown> | null }) {
  const diff = (scans as ScansShape | null)?.diff;
  const changed = Array.isArray(diff?.changed) ? diff.changed : [];
  if (changed.length === 0) return null;
  return (
    <Section id="rv-diff" title="Diff contra a versão publicada" aside={diff?.truncated ? <Chip tone="warn">Cortado pelo teto</Chip> : undefined}>
      <p className="small muted">Linhas com + entraram, linhas com - saíram. Na primeira versão, tudo é novo.</p>
      {changed.map((f) => (
        <details key={f.path} className="card-flat pad-s">
          <summary style={{ cursor: "pointer", minHeight: 32, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <b className="mono" style={{ overflowWrap: "anywhere" }}>
              {revealHidden(f.path).text}
            </b>
            {f.truncated ? <Chip tone="warn">Cortado</Chip> : null}
          </summary>
          <div style={{ paddingTop: 10 }}>
            <RawText text={f.unified} label={`Diff de ${f.path}`} />
          </div>
        </details>
      ))}
    </Section>
  );
}

const GROUPS: { id: string; title: string; match: (p: string) => boolean }[] = [
  { id: "manifest", title: "Manifesto e etapas", match: (p) => p === "manifest.json" || p.startsWith("steps/") },
  { id: "templates", title: "Templates", match: (p) => p.startsWith("templates/") },
  { id: "evals", title: "Evals", match: (p) => p.startsWith("evals/") },
  { id: "knowledge", title: "Conhecimento", match: (p) => p.startsWith("knowledge/") },
];

function Files({ id, files }: { id: string; files: AdminSubmissionDetail["files"] }) {
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
  if (others.length) groups.push({ id: "others", title: "Outros arquivos", match: () => false, list: others });

  return (
    <Section
      id="rv-arquivos"
      title="Arquivos e diferenças"
      aside={
        <button type="button" className={["chip", onlyChanged ? "on" : ""].join(" ")} style={{ minHeight: 44 }} aria-pressed={onlyChanged} onClick={() => setOnlyChanged((v) => !v)}>
          Só o que mudou
        </button>
      }
    >
      <p className="small muted">
        {counts.added} novos · {counts.changed} alterados · {counts.removed} removidos · {counts.same} iguais à versão publicada. Toque em um arquivo para ler o conteúdo como texto.
      </p>
      {files.length === 0 ? <p className="small muted">Nenhum arquivo.</p> : null}
      {groups
        .filter((g) => g.list.length)
        .map((g) => (
          <div key={g.id} className="col" style={gap(4)}>
            <h3 className="h4">
              {g.title} <span className="tiny faint">({g.list.length})</span>
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
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; text: string } | null>(null);
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
        setContent({ kind: "error", message: loadErrorText(e) });
        setOpen(true);
      }
    }
  }

  return (
    <li>
      <button type="button" className={creator.fileBtn} aria-expanded={open} aria-controls={panel} onClick={() => void toggle()} disabled={file.diff === "removed"}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size="s" />
        <span className={creator.fileName}>{revealHidden(file.path).text}</span>
        <span className="tiny faint">{fileSizeText(file.size)}</span>
        <Chip tone={DIFF_TONE[file.diff]}>{DIFF_LABEL[file.diff]}</Chip>
      </button>
      <div id={panel} hidden={!open} style={{ padding: "6px 10px 12px" }}>
        {open && content?.kind === "loading" ? <Loading text="Carregando o arquivo…" /> : null}
        {open && content?.kind === "error" ? (
          <p className="small bad" role="alert">
            {content.message}
          </p>
        ) : null}
        {open && content?.kind === "ok" ? <RawText text={content.text} label={`Conteúdo de ${file.path}`} /> : null}
      </div>
    </li>
  );
}

function Knowledge({ id, k }: { id: string; k: AdminSubmissionDetail["knowledge"] }) {
  const { api } = useSession();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; items: { source: string; content: string; score: number }[] }>({ kind: "idle" });
  const ingest = { queued: "Na fila", running: "Rodando", done: "Pronta", failed: "Falhou", none: "Sem conhecimento" }[k.ingest];

  async function search(e: FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (text.length < 2) return;
    setRes({ kind: "loading" });
    try {
      const r = await api.adminSearchSubmissionKnowledge(id, text);
      setRes({ kind: "ok", items: r.hits });
    } catch (err) {
      setRes({ kind: "error", message: loadErrorText(err) });
    }
  }

  return (
    <Section id="rv-conhecimento" title="Conhecimento" aside={<Chip tone={k.ingest === "done" ? "ok" : k.ingest === "failed" ? "red" : "default"}>Ingestão: {ingest}</Chip>}>
      <p className="small muted">
        {k.files} {k.files === 1 ? "arquivo" : "arquivos"} · {k.chunks} trechos · {k.expiredChunks} {k.expiredChunks === 1 ? "trecho vencido" : "trechos vencidos"}.
      </p>
      {k.expiredChunks > 0 ? (
        <Notice tone="warn" role="note">
          Há trechos com validade vencida. Eles não deveriam sustentar o diferencial “Dado vivo”.
        </Notice>
      ) : null}
      <form className="col" style={gap(10)} onSubmit={search}>
        <label className="label" htmlFor="kb-q">
          Busca de teste na base do pacote
        </label>
        <div className="row m-col" style={gap(10)}>
          <input id="kb-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} placeholder="Ex.: uma pergunta que um comprador faria" disabled={k.ingest === "none"} />
          <Button type="submit" variant="secondary" icon="search" loading={res.kind === "loading"} disabled={k.ingest === "none" || q.trim().length < 2}>
            Buscar
          </Button>
        </div>
      </form>
      {res.kind === "error" ? (
        <p className="small bad" role="alert">
          {res.message}
        </p>
      ) : null}
      {res.kind === "ok" ? (
        res.items.length === 0 ? (
          <p className="small muted" role="status">
            Nada encontrado para essa busca.
          </p>
        ) : (
          <ul className="col" style={gap(12)} aria-label="Resultados da busca">
            {res.items.map((it, i) => (
              <li key={i} className="col" style={gap(6)}>
                <span className="tiny faint">
                  <span className="mono" style={{ overflowWrap: "anywhere" }}>
                    {revealHidden(it.source).text}
                  </span>{" "}
                  · relevância {it.score.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                </span>
                <RawText text={it.content} label={`Trecho ${i + 1} de ${it.source}`} />
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Section>
  );
}

type Pending = "approve" | "request_changes" | "reject" | "finish" | null;

function Decision({ d, reload }: { d: AdminSubmissionDetail; reload: () => Promise<void> }) {
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
  const canFinish = sub.status === "awaiting_onchain_approval" || sub.status === "publishing" || sub.status === "publish_failed";
  const complete = reviewChecklistComplete(checklist);
  const notesOk = notes.trim().length >= 3;
  const noteError = touched && !notesOk ? "Escreva o motivo (pelo menos 3 caracteres). O criador lê este texto." : null;

  async function run(action: Exclude<Pending, null>) {
    setBusy(true);
    setError(null);
    const input = { notes: notes.trim(), checklist: checklist as ReviewChecklist };
    try {
      if (action === "approve") await api.adminApproveSubmission(sub.id, input);
      else if (action === "request_changes") await api.adminRequestChanges(sub.id, input);
      else if (action === "reject") await api.adminRejectSubmission(sub.id, input);
      else await api.adminFinishSubmission(sub.id);
      setConfirm(null);
      toast({
        tone: "ok",
        title: { approve: "Aprovado", request_changes: "Mudanças pedidas", reject: "Envio recusado", finish: "Publicação concluída" }[action],
        text: action === "approve" ? "O criador já pode confirmar com a conta dele. Nada foi assinado na cadeia." : undefined,
      });
      setNotes("");
      setTouched(false);
      await reload();
    } catch (e) {
      setConfirm(null);
      setError(e instanceof ApiError ? `${e.message}${e.code && e.code !== "error" ? ` (${e.code})` : ""}` : (e as Error).message);
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
      <h2 className="h3">Decisão</h2>

      {!inReview && !canReject && !canFinish ? (
        <Notice tone="info" role="note">
          Este envio está em “{statusInfo(sub.status).label}”. Não há decisão para tomar agora.
        </Notice>
      ) : null}

      {inReview || canReject ? (
        <>
          <div className="col" style={gap(8)} role="group" aria-label="Checklist da revisão">
            <span className="label">Checklist</span>
            {REVIEW_CHECKLIST_KEYS.map((k) => (
              <button key={k} type="button" role="checkbox" aria-checked={!!checklist[k]} className={creator.checkRow} onClick={() => setChecklist((c) => ({ ...c, [k]: !c[k] }))}>
                <span className={["check", checklist[k] ? "on" : ""].join(" ")} aria-hidden>
                  {checklist[k] ? <Icon name="check" size="s" /> : null}
                </span>
                <span className="small grow">{CHECKLIST_LABEL[k]}</span>
              </button>
            ))}
            {inReview && !complete ? <span className="hint">Aprovar exige o checklist inteiro marcado.</span> : null}
          </div>
          <div className="field">
            <label className="label" htmlFor="rv-notes">
              Nota para o criador
            </label>
            <textarea id="rv-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} aria-invalid={!!noteError} aria-describedby="rv-notes-hint" />
            {noteError ? (
              <span className="hint" style={{ color: "var(--red)" }} role="alert">
                {noteError}
              </span>
            ) : (
              <span className="hint" id="rv-notes-hint">
                Obrigatória em toda decisão. Guardada como parte do registro, que não pode ser apagado.
              </span>
            )}
          </div>
        </>
      ) : null}

      {error ? (
        <Notice tone="bad" role="alert" title="Não deu para registrar a decisão">
          {error}
        </Notice>
      ) : null}

      <div className="col" style={gap(10)}>
        {inReview ? (
          <>
            <Button size="lg" block variant="ok" icon="check-circle" onClick={() => ask("approve")} disabled={!complete}>
              Aprovar
            </Button>
            <Button block variant="secondary" icon="message" onClick={() => ask("request_changes")}>
              Pedir mudanças
            </Button>
          </>
        ) : null}
        {canReject ? (
          <Button block variant="danger" icon="x" onClick={() => ask("reject")}>
            Recusar
          </Button>
        ) : null}
        {canFinish ? (
          <>
            <p className="small muted">Use só se o evento de aprovação na cadeia não chegou sozinho: conclui o catálogo e coloca o especialista no ar.</p>
            <Button size="lg" block icon="check" onClick={() => ask("finish")}>
              Concluir publicação
            </Button>
          </>
        ) : null}
      </div>
      {inReview ? <p className="tiny faint">Aprovar no site não assina nada na cadeia: libera o criador para confirmar. A aprovação final, em especialista novo, é feita à parte com a carteira fria.</p> : null}

      {confirm ? <ConfirmDialog action={confirm} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void run(confirm)} /> : null}
    </div>
  );
}

const CONFIRM: Record<Exclude<Pending, null>, { title: string; text: string; label: string; variant: "ok" | "danger" | "primary" | "secondary" }> = {
  approve: { title: "Aprovar este envio?", text: "A versão aprovada (conteúdo, preço e versão) fica gravada e o criador passa a poder confirmar o cadastro. Depois disso, o conteúdo não pode mais ser trocado.", label: "Aprovar", variant: "ok" },
  request_changes: { title: "Pedir mudanças?", text: "O criador recebe a sua nota e envia o pacote corrigido na mesma versão.", label: "Pedir mudanças", variant: "primary" },
  reject: { title: "Recusar este envio?", text: "A recusa é definitiva para este envio: o criador vê a sua nota e só pode mandar um pacote novo.", label: "Recusar", variant: "danger" },
  finish: { title: "Concluir a publicação?", text: "O especialista entra na vitrine agora. Confira se a aprovação na cadeia já aconteceu.", label: "Concluir", variant: "primary" },
};

function ConfirmDialog({ action, busy, onCancel, onConfirm }: { action: Exclude<Pending, null>; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const c = CONFIRM[action];
  return (
    <Dialog title={c.title} onClose={onCancel} locked={busy}>
      <div className="col" style={gap(16)}>
        <p className="muted">{c.text}</p>
        <div className="row wrapx" style={gap(10)}>
          <Button variant={c.variant} loading={busy} onClick={onConfirm}>
            {c.label}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Voltar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
