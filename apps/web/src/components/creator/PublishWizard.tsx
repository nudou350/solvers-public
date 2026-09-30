"use client";
// Assistente de publicação (/criador/publicar).
// MOCK: ainda não há API de publicação (fase D, FRONT_PLAN.md). Nada aqui é enviado ao servidor:
// os arquivos ficam no navegador, a bateria de testes é simulada e "Publicar" só mostra "Enviado para revisão".
// Da API real vêm apenas os limites e regras (getConfig: minPurchaseUsdc, feeBps, guaranteeMinSales/Rating) e a cotação.
import type { Requirement } from "@solvers/api-client";
import { useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Toast";
import { brl, dec1, int, parseNum, usdc } from "@/lib/format";
import { useRate, useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { CreatorHead } from "./CreatorHead";

const MIN_CASES = 30;
const MIN_SCORE = 80;

const STEPS = [
  { title: "Descrição", text: "Conte o que o especialista faz e quanto ele custa." },
  { title: "Requisitos", text: "O que o comprador precisa ter para usar." },
  { title: "Arquivos", text: "O conhecimento, os modelos e as ferramentas do pacote." },
  { title: "Bateria de testes", text: "Os casos que provam que o especialista funciona." },
  { title: "Revisão e publicação", text: "Confira tudo antes de enviar." },
] as const;

const CLIENTS = ["Claude", "ChatGPT"];
const CONNECTORS = ["Figma", "GitHub", "Google Drive", "Google Agenda", "Google Planilhas", "Gmail", "Notion", "Slack"];
const PLANS = ["Qualquer plano", "Plano pago recomendado (Claude Pro ou ChatGPT Plus)"];
/** Nome do requisito de plano quando o criador recomenda um plano pago. */
const PAID_PLAN = "Claude Pro ou ChatGPT Plus";
const HOWTO_MAX = 600;
const KEY_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

type Conn = { label: string; key: string; optional: boolean; howTo?: string; helpUrl?: string; custom?: boolean };
type ConnDraft = { label: string; key: string; howTo: string; helpUrl: string };
const EMPTY_CONN: ConnDraft = { label: "", key: "", howTo: "", helpUrl: "" };

type FileKind = "Conhecimento" | "Modelos" | "Ferramentas";
type LocalFile = { name: string; size: number; kind: FileKind };
type TestCase = { title: string; expect: string };
type RunResult = { passed: number; partial: number[]; total: number; score: number };

const KIND_STYLE: Record<FileKind, { hue: number; icon: IconName }> = {
  Conhecimento: { hue: 250, icon: "book" },
  Modelos: { hue: 60, icon: "file" },
  Ferramentas: { hue: 300, icon: "wrench" },
};

function kindOf(name: string): FileKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "ts", "mjs", "cjs", "py"].includes(ext)) return "Ferramentas";
  if (["json", "yaml", "yml", "csv"].includes(ext)) return "Modelos";
  return "Conhecimento";
}

/** "Google Drive" -> "google_drive": minúsculas, sem acentos, tokens separados por "_". */
function connKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${dec1(bytes / (1024 * 1024))} MB`;
  return `${int(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** Casos de exemplo, só para experimentar o assistente. */
const SAMPLE_CASES: TestCase[] = [
  { title: "Resolver o pedido mais comum do público", expect: "o resultado completo, pronto para usar" },
  { title: "Explicar a resposta em linguagem simples", expect: "sem jargão e com um exemplo" },
  { title: "Lidar com um pedido incompleto", expect: "perguntar o que falta antes de responder" },
  { title: "Recusar um pedido fora do escopo", expect: "dizer o que não faz e sugerir o caminho" },
  { title: "Revisar um trabalho existente", expect: "pelo menos 3 problemas reais, com correção" },
];

export function PublishWizard() {
  const { config, me } = useSession();
  const rate = useRate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: "", tagline: "", description: "", price: "" });
  const [touched, setTouched] = useState(false);
  const [clients, setClients] = useState<string[]>(["Claude", "ChatGPT"]);
  const [conns, setConns] = useState<Conn[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [connDraft, setConnDraft] = useState<ConnDraft>(EMPTY_CONN);
  const [keyEdited, setKeyEdited] = useState(false);
  const [connTouched, setConnTouched] = useState(false);
  const [plan, setPlan] = useState(PLANS[0]!);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [draft, setDraft] = useState<TestCase>({ title: "", expect: "" });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [published, setPublished] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const minPrice = config?.minPurchaseUsdc ?? null;
  const price = parseNum(form.price);
  const money = (v: number) => (rate != null ? brl(v, rate) : usdc(v));
  const sharePct = config?.feeBps != null ? 100 - config.feeBps / 100 : null;

  // Validação do passo 1 (mock, só no front).
  const errors = {
    name: form.name.trim().length < 3 ? "Dê um nome com pelo menos 3 letras." : null,
    tagline: form.tagline.trim().length < 10 ? "Escreva uma frase curta (pelo menos 10 caracteres)." : null,
    price: !Number.isFinite(price) || price <= 0 ? "Informe o preço em USDC." : minPrice != null && price < minPrice ? `O preço mínimo é ${usdc(minPrice)}.` : null,
  };
  const connErrors = {
    label: connDraft.label.trim().length < 2 ? "Dê um nome ao conector." : null,
    key: !KEY_RE.test(connDraft.key)
      ? "Use minúsculas, números e _ (ex.: google_drive)."
      : conns.some((c) => c.key === connDraft.key || c.label.toLowerCase() === connDraft.label.trim().toLowerCase())
        ? "Esse conector já está na lista."
        : null,
    helpUrl: connDraft.helpUrl.trim() && !isHttpUrl(connDraft.helpUrl.trim()) ? "Informe o link completo, começando com https://" : null,
  };
  // Requisitos no formato do servidor (Requirement[]). Nada é enviado nesta pré-visualização.
  const requirements: Requirement[] = [
    ...clients.map<Requirement>((label) => ({ type: "client", label })),
    ...conns.map<Requirement>((c) => ({ type: "connector", label: c.label, key: c.key, optional: c.optional, ...(c.howTo ? { howTo: c.howTo } : {}), ...(c.helpUrl ? { helpUrl: c.helpUrl } : {}) })),
    ...(plan === PLANS[1] ? [{ type: "plan", label: PAID_PLAN } satisfies Requirement] : []),
  ];
  const step1Ok = !errors.name && !errors.tagline && !errors.price;
  const testsOk = result != null && result.score >= MIN_SCORE && result.total >= MIN_CASES;
  const canPublish = step1Ok && clients.length > 0 && testsOk;

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setPublished(false);
  };
  const toggleCatalog = (label: string) =>
    setConns((c) => (c.some((x) => !x.custom && x.label === label) ? c.filter((x) => x.custom || x.label !== label) : [...c, { label, key: connKey(label), optional: false }]));
  const setOptional = (key: string) => setConns((c) => c.map((x) => (x.key === key ? { ...x, optional: !x.optional } : x)));
  const removeConn = (key: string) => setConns((c) => c.filter((x) => x.key !== key));
  const editConn = (k: keyof ConnDraft) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    if (k === "key") setKeyEdited(true);
    setConnDraft((d) => ({ ...d, [k]: v, ...(k === "label" && !keyEdited ? { key: connKey(v) } : {}) }));
  };
  const closeConnForm = () => {
    setAddOpen(false);
    setConnDraft(EMPTY_CONN);
    setKeyEdited(false);
    setConnTouched(false);
  };
  const addConn = (e: FormEvent) => {
    e.preventDefault();
    setConnTouched(true);
    if (connErrors.label || connErrors.key || connErrors.helpUrl) return;
    const howTo = connDraft.howTo.trim();
    const helpUrl = connDraft.helpUrl.trim();
    // Conector personalizado nasce opcional: só bloqueia o comprador se o criador desmarcar.
    setConns((c) => [...c, { label: connDraft.label.trim(), key: connDraft.key, optional: true, custom: true, ...(howTo ? { howTo } : {}), ...(helpUrl ? { helpUrl } : {}) }]);
    closeConnForm();
  };
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const go = (n: number) => {
    if (step === 1 && n > 1) setTouched(true);
    setStep(Math.min(5, Math.max(1, n)));
  };

  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    setFiles((cur) => [...cur, ...list.filter((f) => !cur.some((c) => c.name === f.name)).map((f) => ({ name: f.name, size: f.size, kind: kindOf(f.name) }))]);
    e.target.value = "";
  };

  const addCase = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim() || !draft.expect.trim()) return;
    setCases((c) => [...c, { title: draft.title.trim(), expect: draft.expect.trim() }]);
    setDraft({ title: "", expect: "" });
    setResult(null);
  };
  const fillSamples = () => {
    const out: TestCase[] = [];
    for (let i = 0; out.length < MIN_CASES - cases.length; i++) {
      const s = SAMPLE_CASES[i % SAMPLE_CASES.length]!;
      out.push({ title: `${s.title} (variação ${Math.floor(i / SAMPLE_CASES.length) + 1})`, expect: s.expect });
    }
    setCases((c) => [...c, ...out]);
    setResult(null);
  };
  const runTests = () => {
    // Simulação: um caso a cada 15 fica "parcial". A bateria de verdade roda no servidor (fase D).
    setRunning(true);
    setResult(null);
    window.setTimeout(() => {
      const partial = cases.map((_, i) => i).filter((i) => i % 15 === 3);
      const passed = cases.length - partial.length;
      setResult({ passed, partial, total: cases.length, score: cases.length ? Math.round((passed / cases.length) * 100) : 0 });
      setRunning(false);
    }, 1800);
  };

  const info = STEPS[step - 1]!;
  const creatorName = me?.displayName ?? "você";
  const scoreLabel = result ? `${result.score}% nos testes` : "Testes pendentes";

  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <CreatorHead tab="publish" />
      <Notice tone="brand" icon="info" role="note">
        Pré-visualização: a publicação pelo site chega em breve; hoje publicamos junto com você.
      </Notice>

      <nav aria-label="Etapas da publicação" className="row wrapx" style={gap(10, { margin: "24px 0 28px" })}>
        {STEPS.map((s, i) => {
          const n = i + 1;
          const done = step > n;
          return (
            <button key={s.title} type="button" className={["chip", step === n ? "on" : ""].join(" ")} style={{ minHeight: 44 }} onClick={() => go(n)} aria-current={step === n ? "step" : undefined}>
              <span className={["dot", done ? "dot-ok" : "dot-now"].join(" ")} style={{ width: 24, height: 24, fontSize: 12, borderWidth: 1.5 }}>
                {done ? "✓" : n}
              </span>
              {s.title}
            </button>
          );
        })}
      </nav>

      <div className="split">
        <div className="card pad-l col" style={gap(22)}>
          <div className="col" style={gap(4)}>
            <span className="eyebrow">
              Etapa {step} de 5
            </span>
            <h2 className="display h2s">{info.title}</h2>
            <p className="muted">{info.text}</p>
          </div>

          {step === 1 ? (
            <div className="col" style={gap(18)}>
              <Field id="f-nome" label="Nome do especialista" error={touched ? errors.name : null}>
                <input id="f-nome" className="input" value={form.name} onChange={set("name")} placeholder="Ex: Sistemas de Design" maxLength={60} aria-invalid={touched && !!errors.name} />
              </Field>
              <Field id="f-slogan" label="Frase curta" hint="Aparece no cartão. Diga o resultado, não a tecnologia." error={touched ? errors.tagline : null}>
                <input id="f-slogan" className="input" value={form.tagline} onChange={set("tagline")} placeholder="Ex: Do rascunho a uma biblioteca de componentes pronta para o time." maxLength={120} aria-invalid={touched && !!errors.tagline} />
              </Field>
              <Field id="f-desc" label="Descrição">
                <textarea id="f-desc" className="textarea" value={form.description} onChange={set("description")} placeholder="O que ele faz, para quem é e o que entrega." maxLength={2000} />
              </Field>
              <Field
                id="f-p1"
                label="Preço da licença permanente (USDC)"
                hint={`${Number.isFinite(price) && price > 0 ? `Equivale a ${money(price)}. ` : ""}${minPrice != null ? `Mínimo: ${usdc(minPrice)}${rate != null ? ` (${brl(minPrice, rate)})` : ""}.` : ""}`}
                error={touched ? errors.price : null}
              >
                <input id="f-p1" className="input" value={form.price} onChange={set("price")} inputMode="decimal" placeholder={minPrice != null ? String(Math.max(minPrice, 1)) : ""} aria-invalid={touched && !!errors.price} />
              </Field>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="col" style={gap(22)}>
              <div className="col" style={gap(10)} role="group" aria-labelledby="req-clients">
                <span className="label" id="req-clients">
                  IAs compatíveis
                </span>
                <div className="row wrapx" style={gap(10)}>
                  {CLIENTS.map((n) => {
                    const on = clients.includes(n);
                    return (
                      <button key={n} type="button" className={["opt", on ? "on" : ""].join(" ")} aria-pressed={on} onClick={() => setClients((c) => toggle(c, n))} style={{ width: "auto", padding: "12px 18px", alignItems: "center" }}>
                        <span className={["check", on ? "on" : ""].join(" ")}>
                          <Icon name="check" size="s" />
                        </span>
                        <b>{n}</b>
                      </button>
                    );
                  })}
                </div>
                {clients.length === 0 ? <span className="hint" style={{ color: "var(--amber)" }}>Escolha pelo menos uma IA.</span> : null}
              </div>
              <div className="col" style={gap(10)} role="group" aria-labelledby="req-conns">
                <span className="label" id="req-conns">
                  Conectores necessários
                </span>
                <div className="row wrapx" style={gap(10)}>
                  {CONNECTORS.map((n) => {
                    const on = conns.some((c) => !c.custom && c.label === n);
                    return (
                      <button key={n} type="button" className={["chip", on ? "on" : ""].join(" ")} aria-pressed={on} onClick={() => toggleCatalog(n)}>
                        {n}
                      </button>
                    );
                  })}
                  {conns
                    .filter((c) => c.custom)
                    .map((c) => (
                      <button key={c.key} type="button" className="chip chip-brand" aria-label={`Remover o conector ${c.label}`} onClick={() => removeConn(c.key)}>
                        {c.label}
                        <Icon name="x" size="s" />
                      </button>
                    ))}
                </div>
                <span className="hint">Escolha só o que o especialista realmente usa. Cada conector pede autorização do comprador.</span>
                {conns.length ? (
                  <div className="card-flat pad-s col" style={gap(6)}>
                    <span className="small muted">Marque como opcional o que o especialista consegue dispensar: o comprador é só avisado, não fica bloqueado.</span>
                    {conns.map((c) => (
                      <div key={c.key} className="row between wrapx" style={gap(10)}>
                        <b className="small" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                          {c.label}
                        </b>
                        <button type="button" className={["chip", c.optional ? "on" : ""].join(" ")} aria-pressed={c.optional} aria-label={`${c.label}: opcional`} onClick={() => setOptional(c.key)}>
                          Opcional
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {addOpen ? (
                  <form className="card pad-s col" style={gap(12)} onSubmit={addConn} noValidate>
                    <b className="small">Novo conector</b>
                    <Field id="cn-nome" label="Nome do conector" error={connTouched ? connErrors.label : null}>
                      <input id="cn-nome" className="input" value={connDraft.label} onChange={editConn("label")} placeholder="Ex: Google Drive" maxLength={60} aria-invalid={connTouched && !!connErrors.label} autoFocus />
                    </Field>
                    <Field id="cn-como" label="Como conectar (opcional)" hint={`${connDraft.howTo.length}/${HOWTO_MAX} · Em 1 a 3 frases, o que o comprador faz na IA dele.`}>
                      <textarea id="cn-como" className="textarea" style={{ minHeight: 72 }} value={connDraft.howTo} onChange={editConn("howTo")} placeholder="Ex: Na sua IA, abra as configurações de conectores e autorize o Google Drive." maxLength={HOWTO_MAX} />
                    </Field>
                    <Field id="cn-link" label="Link da ajuda oficial (opcional)" error={connTouched ? connErrors.helpUrl : null}>
                      <input id="cn-link" className="input" type="url" inputMode="url" value={connDraft.helpUrl} onChange={editConn("helpUrl")} placeholder="https://" aria-invalid={connTouched && !!connErrors.helpUrl} />
                    </Field>
                    <details>
                      <summary className="small muted" style={{ cursor: "pointer", minHeight: 32 }}>
                        Avançado
                      </summary>
                      <div style={{ paddingTop: 8 }}>
                        <Field id="cn-chave" label="Chave" hint="Identificador interno, gerado do nome. Minúsculas, números e _." error={connTouched ? connErrors.key : null}>
                          <input id="cn-chave" className="input mono" value={connDraft.key} onChange={editConn("key")} maxLength={40} spellCheck={false} aria-invalid={connTouched && !!connErrors.key} />
                        </Field>
                      </div>
                    </details>
                    <div className="row wrapx" style={gap(10)}>
                      <Button type="submit" variant="secondary" icon="plus">
                        Adicionar conector
                      </Button>
                      <Button variant="ghost" onClick={closeConnForm}>
                        Cancelar
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div>
                    <button type="button" className="link-btn" onClick={() => setAddOpen(true)}>
                      <Icon name="plus" size="s" />
                      Adicionar outro conector
                    </button>
                  </div>
                )}
              </div>
              <div className="col" style={gap(10)} role="radiogroup" aria-labelledby="req-plan">
                <span className="label" id="req-plan">
                  Plano recomendado
                </span>
                {PLANS.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={plan === n} className={["opt", plan === n ? "on" : ""].join(" ")} onClick={() => setPlan(n)} style={{ alignItems: "center" }}>
                    <span className="dot-r" />
                    <b>{n}</b>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="col" style={gap(18)}>
              <div className="drop col" style={gap(10, { alignItems: "center" })}>
                <span className="brand">
                  <Icon name="upload" size="xl" />
                </span>
                <b>Escolha os arquivos do pacote</b>
                <span className="small muted">Conhecimento (PDF, Markdown), modelos prontos e o servidor de ferramentas.</span>
                <input ref={fileInput} type="file" multiple hidden onChange={onFiles} accept=".pdf,.md,.txt,.json,.yaml,.yml,.csv,.js,.ts,.mjs,.py" />
                <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                  Escolher arquivos
                </Button>
                <span className="tiny faint">Os arquivos ficam no seu navegador: nada é enviado nesta pré-visualização.</span>
              </div>
              {files.length ? (
                <div className="col" style={gap(0)}>
                  {files.map((f) => (
                    <div key={f.name} className="rowline">
                      <span className="tile tile-s" style={{ "--h": KIND_STYLE[f.kind].hue } as CSSProperties} aria-hidden>
                        <Icon name={KIND_STYLE[f.kind].icon} />
                      </span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <b className="mono trunc" style={{ fontSize: 14, display: "block" }}>
                          {f.name}
                        </b>
                        <div className="tiny faint">
                          {f.kind} · {fileSize(f.size)}
                        </div>
                      </div>
                      <span className="hide-m">
                        <Chip tone="ok" icon="check">
                          Selecionado
                        </Chip>
                      </span>
                      <button type="button" className="icon-btn" aria-label={`Remover ${f.name}`} onClick={() => setFiles((l) => l.filter((x) => x.name !== f.name))}>
                        <Icon name="trash" size="s" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 4 ? (
            <div className="col" style={gap(18)}>
              <div className="card-flat pad-s row start" style={gap(12)}>
                <Icon name="info" />
                <span className="small grow">
                  São necessários pelo menos {MIN_CASES} casos de teste, cada um com o que a resposta precisa conter. A nota que aparece para os compradores é a
                  porcentagem de casos resolvidos, e é preciso pelo menos {MIN_SCORE}% para publicar.
                </span>
              </div>

              <form className="card pad-s col" style={gap(12)} onSubmit={addCase}>
                <b className="small">Novo caso de teste</b>
                <div className="g2" style={gap(12)}>
                  <div className="field">
                    <label className="label" htmlFor="c-title">
                      Pedido
                    </label>
                    <input id="c-title" className="input" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Ex: Criar tela de cadastro para celular" maxLength={140} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="c-expect">
                      A resposta precisa conter
                    </label>
                    <input id="c-expect" className="input" value={draft.expect} onChange={(e) => setDraft((d) => ({ ...d, expect: e.target.value }))} placeholder="Ex: campos, estados de erro e contraste de 4,5:1" maxLength={200} />
                  </div>
                </div>
                <div className="row wrapx" style={gap(10)}>
                  <Button type="submit" variant="secondary" icon="plus" disabled={!draft.title.trim() || !draft.expect.trim()}>
                    Adicionar caso
                  </Button>
                  {cases.length < MIN_CASES ? (
                    <button type="button" className="link small" style={{ background: "none", border: 0, padding: 0 }} onClick={fillSamples}>
                      Completar com casos de exemplo
                    </button>
                  ) : null}
                </div>
              </form>

              <div className="row between wrapx small">
                <b>
                  {int(cases.length)} {cases.length === 1 ? "caso" : "casos"}
                </b>
                <span className={cases.length >= MIN_CASES ? "ok" : "muted"}>
                  {cases.length >= MIN_CASES ? "Mínimo atingido" : `Faltam ${MIN_CASES - cases.length} para o mínimo de ${MIN_CASES}`}
                </span>
              </div>
              {cases.length ? (
                <div className="card pad-s" style={{ padding: "4px 20px", maxHeight: 420, overflowY: "auto" }}>
                  {cases.map((t, i) => {
                    const res = result ? (result.partial.includes(i) ? { l: "Parcial", c: "warn" as const } : { l: "Resolvido", c: "ok" as const }) : null;
                    return (
                      <div key={i} className="rowline start" style={{ alignItems: "flex-start" }}>
                        <span className="mono tiny faint" style={{ width: 30, marginTop: 3 }}>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <b className="small">{t.title}</b>
                          <div className="tiny muted">Precisa: {t.expect}</div>
                        </div>
                        {res ? <Chip tone={res.c}>{res.l}</Chip> : <Chip>Não rodado</Chip>}
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Remover o caso ${i + 1}`}
                          onClick={() => {
                            setCases((l) => l.filter((_, j) => j !== i));
                            setResult(null);
                          }}
                        >
                          <Icon name="x" size="s" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="row wrapx" style={gap(14)}>
                <Button size="lg" icon="play" loading={running} disabled={cases.length < MIN_CASES} onClick={runTests}>
                  {result ? "Rodar de novo" : "Rodar bateria de testes"}
                </Button>
                <span className="small muted" aria-live="polite">
                  {running ? "Rodando os casos…" : result ? "Última execução agora há pouco (simulada)." : cases.length < MIN_CASES ? `Adicione pelo menos ${MIN_CASES} casos.` : "Leva cerca de 3 minutos."}
                </span>
              </div>
              {result ? (
                <div className="row card pad-s" style={gap(16, { borderColor: result.score >= MIN_SCORE ? "var(--mint)" : "var(--amber)" })} role="status">
                  <div className="ring" style={{ "--p": result.score, width: 76, height: 76 } as CSSProperties}>
                    <div style={{ width: 58, height: 58 }}>
                      <b className="num">{result.score}%</b>
                    </div>
                  </div>
                  <div className="grow">
                    <b>{result.score}% dos casos resolvidos</b>
                    <div className="small muted">
                      {result.passed} de {result.total} casos. {result.score >= MIN_SCORE ? `Acima do mínimo de ${MIN_SCORE}% para publicar.` : `Abaixo do mínimo de ${MIN_SCORE}%: ajuste o especialista e rode de novo.`}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 5 ? (
            <div className="col" style={gap(18)}>
              <div className="card-flat pad-s col" style={gap(12)}>
                <div className="row start" style={gap(12)}>
                  <span className="ok">
                    <Icon name="gift" />
                  </span>
                  <span className="small grow">
                    <b>Publicar é grátis, sem depósito.</b>{" "}
                    {sharePct != null ? `Você recebe ${dec1(sharePct).replace(",0", "")}% de cada venda; a taxa da plataforma já sai daí.` : "Você recebe a maior parte de cada venda; a taxa da plataforma já sai daí."}
                  </span>
                </div>
                <div className="row start" style={gap(12)}>
                  <span className="brand">
                    <Icon name="users" />
                  </span>
                  <span className="small grow">
                    <b>Revisão da equipe.</b> Os primeiros especialistas de cada criador passam por uma revisão antes de entrar na vitrine.
                  </span>
                </div>
                <div className="row start" style={gap(12)}>
                  <span className="warn">
                    <Icon name="shield-check" />
                  </span>
                  <span className="small grow">
                    <b>Garantia.</b>{" "}
                    {config
                      ? config.guaranteeMinSales > 0
                        ? `A compra com garantia fica disponível depois de ${int(config.guaranteeMinSales)} vendas com nota ${dec1(config.guaranteeMinRating)} ou mais.`
                        : "A compra com garantia fica disponível desde a primeira venda."
                      : "A compra com garantia fica disponível depois de um histórico mínimo de vendas e notas."}
                  </span>
                </div>
              </div>
              <div className="card pad-s col" style={gap(10)}>
                <b>Resumo da publicação</b>
                <SummaryRow label="Especialista" value={form.name.trim() || "Sem nome"} bad={!!errors.name} />
                <SummaryRow label="Licença permanente" value={Number.isFinite(price) && price > 0 ? `${money(price)} · ${usdc(price)}` : "Sem preço"} bad={!!errors.price} />
                <SummaryRow label="IAs" value={clients.join(" e ") || "Nenhuma"} bad={clients.length === 0} />
                <SummaryRow label="Conectores" value={conns.length ? conns.map((c) => (c.optional ? `${c.label} (opcional)` : c.label)).join(", ") : "Nenhum"} />
                <SummaryRow label="Plano recomendado" value={requirements.some((r) => r.type === "plan") ? PAID_PLAN : PLANS[0]!} />
                <SummaryRow label="Arquivos" value={files.length ? `${files.length} ${files.length === 1 ? "arquivo" : "arquivos"}` : "Nenhum"} />
                <SummaryRow label="Nota de desempenho" value={result ? `${result.score}% em ${result.total} casos` : "Bateria não rodada"} bad={!testsOk} good={testsOk} />
              </div>
              {!canPublish ? (
                <Notice tone="warn" title="Falta pouco">
                  {!step1Ok ? "Complete a descrição e o preço (etapa 1). " : ""}
                  {clients.length === 0 ? "Escolha pelo menos uma IA (etapa 2). " : ""}
                  {!testsOk ? `Rode a bateria com pelo menos ${MIN_CASES} casos e ${MIN_SCORE}% de acertos (etapa 4).` : ""}
                </Notice>
              ) : null}
              {published ? (
                <div className="row card pad-s" style={gap(12, { borderColor: "var(--mint)" })} role="status">
                  <span className="dot dot-ok">
                    <Icon name="check" />
                  </span>
                  <div className="grow">
                    <b>Enviado para revisão</b>
                    <div className="small muted">Você será avisado quando o especialista estiver no ar.</div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="row between wrapx" style={gap(12, { paddingTop: 8 })}>
            <Button variant="ghost" icon="arrow-left" className={step === 1 ? "off" : ""} disabled={step === 1} onClick={() => go(step - 1)}>
              Voltar
            </Button>
            {step < 5 ? (
              <Button size="lg" iconRight="arrow-right" onClick={() => go(step + 1)}>
                Continuar
              </Button>
            ) : (
              <Button size="lg" disabled={!canPublish || published} onClick={() => setPublished(true)}>
                {published ? "Enviado para revisão" : "Publicar especialista"}
              </Button>
            )}
          </div>
        </div>

        <aside className="sticky col" style={gap(16)} aria-label="Pré-visualização do cartão">
          <span className="eyebrow">Como os compradores vão ver</span>
          <div className="card pad-s col" style={gap(14)}>
            <div className="row start" style={gap(14)}>
              <span className="tile" style={{ "--h": 300 } as CSSProperties} aria-hidden>
                <Icon name="pen" />
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <b className={["h4 clamp2", form.name.trim() ? "" : "faint"].join(" ")} style={{ display: "-webkit-box" }}>
                  {form.name.trim() || "Nome do especialista"}
                </b>
                <div className="small muted trunc">por {creatorName}</div>
              </div>
            </div>
            <p className={["small", form.tagline.trim() ? "muted" : "faint"].join(" ")} style={{ overflowWrap: "anywhere" }}>
              {form.tagline.trim() || "A frase curta aparece aqui."}
            </p>
            <div className="row between" style={{ paddingTop: 12, borderTop: "1px solid var(--line)", gap: 12 }}>
              <div className="flex-none">
                <b className="num" style={{ fontSize: 20 }}>
                  {Number.isFinite(price) && price > 0 ? money(price) : "—"}
                </b>
                <div className="tiny faint">{Number.isFinite(price) && price > 0 ? usdc(price) : "defina o preço"}</div>
              </div>
              <span className={result ? "verified" : "chip"}>
                <Icon name="shield-check" size="s" />
                {scoreLabel}
              </span>
            </div>
          </div>
          {result ? null : <p className="small muted">A nota de desempenho só aparece depois que a bateria de testes é rodada.</p>}
        </aside>
      </div>
    </section>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="hint" style={{ color: "var(--red)" }} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}

function SummaryRow({ label, value, bad, good }: { label: string; value: string; bad?: boolean; good?: boolean }) {
  return (
    <div className="row between small" style={gap(12)}>
      <span className="muted">{label}</span>
      <b className={bad ? "warn" : good ? "ok" : undefined} style={{ textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>
        {value}
      </b>
    </div>
  );
}
