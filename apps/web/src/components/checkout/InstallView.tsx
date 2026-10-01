"use client";
// Instalação guiada (design: instalacao-guiada). Endereço único do conector (getConfig().connectorUrl),
// passo a passo para Claude e ChatGPT e checklist com o teste real da conexão (getConnector()).
import type { AgentDetail, ConnectorStatus } from "@solvers/api-client";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { ago, connectorName, copyText } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import s from "./checkout.module.css";
import { HelpDialog } from "./HelpDialog";
import { txErrorMessage } from "@/lib/tx";

type Client = "claude" | "gpt";

/** Nome com que cada app se registra ao autorizar. Nome que não bate com nenhum dos dois ("Assistente de IA") vale para a aba aberta. */
const CLIENT_NAME: Record<Client, RegExp> = { claude: /claude|anthropic/i, gpt: /chatgpt|gpt|openai/i };
const isKnown = (name: string) => CLIENT_NAME.claude.test(name) || CLIENT_NAME.gpt.test(name);

type Check = {
  key: string;
  label: string;
  ok: boolean;
  statusOk: string;
  statusNo: string;
  actLabel?: string;
  act?: () => void;
  acting?: boolean;
  /** Requisito opcional: não bloqueia nem conta no progresso. */
  optional?: boolean;
  /** Orientação do criador para conectores fora do catálogo. */
  howTo?: string;
  helpUrl?: string;
};


/** O que muda sem um conector opcional. Figma tem texto próprio; os demais, um genérico. */
function optionalHint(key: string | undefined, name: string) {
  if ((key ?? name).toLowerCase() === "figma") return "Opcional: conecte o Figma para ler o arquivo direto; sem ele, dá para colar prints e valores.";
  return `Opcional: conecte o ${name} para o especialista ler os dados direto; sem ele, dá para colar as informações na conversa.`;
}

function Ill({ children }: { children: ReactNode }) {
  return (
    <div className="ill">
      <div className="ill-win">
        <div className="ill-bar">
          <i />
          <i />
          <i />
        </div>
        {children}
      </div>
      <div className="tiny faint" style={{ marginTop: 8 }}>
        Ilustração. Os nomes dos menus podem variar conforme a versão do aplicativo.
      </div>
    </div>
  );
}

export function InstallView({ detail }: { detail: AgentDetail | null }) {
  const { api, config, status, me, login, loggingIn } = useSession();
  const toast = useToast();
  const agent = detail?.agent ?? null;
  const creator = detail?.creator ?? null;
  const [tab, setTab] = useState<Client>("claude");
  const [copied, setCopied] = useState(false);
  const [plan, setPlan] = useState(false);
  const [helping, setHelping] = useState(false);
  const [conns, setConns] = useState<Record<string, boolean>>({});
  // "Já colei e confirmei" é por aba: o que foi feito no Claude não vale para o ChatGPT.
  const [addedBy, setAddedBy] = useState<Record<Client, boolean>>({ claude: false, gpt: false });
  const [conn, setConn] = useState<ConnectorStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [testedEmpty, setTestedEmpty] = useState(false);
  const [trial, setTrial] = useState<{ trialUsesLeft: number; owned: boolean } | null>(null);

  const url = config?.connectorUrl ?? "";
  const gpt = tab === "gpt";
  const clientName = gpt ? "ChatGPT" : "Claude";
  // Só conta a autorização do app desta aba (ou de um app sem nome reconhecível).
  const mine = conn?.authorizedClients.filter((c) => CLIENT_NAME[tab].test(c.clientName) || !isKnown(c.clientName)) ?? [];
  const others = conn?.authorizedClients.filter((c) => !mine.includes(c)) ?? [];
  const connected = mine.length > 0;
  const added = addedBy[tab] || connected;
  const setAdded = (v: boolean) => setAddedBy((a) => ({ ...a, [tab]: v }));

  const test = useCallback(
    async (silent = false) => {
      setTesting(true);
      try {
        const c = await api.getConnector();
        setConn(c);
        if (!silent) setTestedEmpty(true);
      } catch (e) {
        if (!silent) {
          const info = txErrorMessage(e);
          toast({ tone: "bad", title: info.title, text: info.text });
        }
      } finally {
        setTesting(false);
      }
    },
    [api, toast],
  );

  // Logado: confere a conexão uma vez em silêncio (quem já conectou vê o item marcado).
  useEffect(() => {
    setConn(null);
    setTrial(null);
    if (!me) return;
    void test(true);
    if (agent)
      api.getMyAccess(agent.slug).then(
        (a) => setTrial({ trialUsesLeft: a.trialUsesLeft, owned: !!a.license }),
        () => {},
      );
  }, [me, agent, api, test]);

  async function copy() {
    if (url && (await copyText(url))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  const doLogin = () => login().catch((e: unknown) => toast({ tone: "bad", title: "Não deu para entrar", text: (e as Error).message }));

  const planReq = agent?.requirements.find((r) => r.type === "plan");
  const connectorReqs = agent?.requirements.filter((r) => r.type === "connector") ?? [];
  const logged = status === "authed" && !!me;
  const first = mine[0];
  const otherNames = [...new Set(others.map((c) => c.clientName))].join(" e ");

  const checks: Check[] = [
    {
      key: "plan",
      label: `${clientName} com plano compatível`,
      ok: plan,
      statusOk: "Confirmado por você",
      statusNo: planReq ? `${planReq.label}. Conectores personalizados costumam pedir um plano pago.` : "Conectores personalizados costumam pedir um plano pago.",
      actLabel: "Tenho um plano compatível",
      act: () => setPlan(true),
    },
    ...connectorReqs.map<Check>((r) => {
      const n = connectorName(r.label);
      return {
        key: `conn-${r.key ?? r.label}`,
        label: r.optional ? `${n} (opcional)` : `${n} conectado?`,
        ok: !!conns[r.label],
        statusOk: "Conectado",
        statusNo: r.optional ? optionalHint(r.key, n) : `Este especialista usa o ${n}. Conecte-o na sua IA também.`,
        actLabel: "Já conectei",
        act: () => setConns((c) => ({ ...c, [r.label]: true })),
        optional: r.optional,
        howTo: r.howTo,
        helpUrl: r.helpUrl,
      };
    }),
    {
      key: "added",
      label: "Conector do Solver adicionado",
      ok: added,
      statusOk: "Adicionado à sua IA",
      statusNo: "Falta colar o endereço no passo 3",
      actLabel: "Já adicionei",
      act: () => setAdded(true),
    },
    {
      key: "test",
      label: "Teste de conexão",
      ok: connected,
      statusOk: first ? `${first.clientName} autorizado ${ago(first.authorizedAt)}. Faça o passo 4 para confirmar.` : "Autorizado. Faça o passo 4 para confirmar.",
      statusNo: !logged
        ? "Entre na sua conta para testar"
        : others.length
          ? `Encontramos ${otherNames}, mas não o ${clientName}. Faça o passo 3 neste app e autorize o acesso.`
          : testedEmpty
            ? `Ainda não encontramos o ${clientName}. Confira o passo 3 e autorize o acesso.`
            : added
              ? "Pronto para testar"
              : "Faça o passo 3 primeiro",
      actLabel: !logged ? "Entrar" : "Testar conexão",
      act: !logged ? doLogin : () => void test(false),
      acting: !logged ? loggingIn : testing,
    },
  ];
  const required = checks.filter((k) => !k.optional);
  const doneCount = required.filter((k) => k.ok).length;
  const allDone = doneCount === required.length;
  const name = agent?.name ?? "Solver";

  return (
    <section className="wrap" style={{ paddingTop: 36, paddingBottom: 56 }}>
      <div className="col" style={{ ...gap(12), marginBottom: 32 }}>
        <span className="eyebrow">Instalação guiada</span>
        <h1 className="display h1s">Conecte o {name} à sua IA</h1>
        <p className="lead" style={{ maxWidth: 660 }}>
          São quatro passos rápidos. Você só faz isso uma vez{agent ? "" : ": o mesmo conector serve para todos os especialistas que você tiver"}.
        </p>
        {trial && !trial.owned && trial.trialUsesLeft > 0 ? (
          <div>
            <Chip tone="brand" icon="gift">
              Você tem {trial.trialUsesLeft} {trial.trialUsesLeft === 1 ? "uso grátis" : "usos grátis"} para testar
            </Chip>
          </div>
        ) : null}
        <div className="row" style={{ ...gap(14), marginTop: 6, maxWidth: 460 }}>
          <div className="bar mint grow" role="progressbar" aria-valuemin={0} aria-valuemax={required.length} aria-valuenow={doneCount} aria-label="Progresso da instalação">
            <i style={{ width: `${(doneCount / required.length) * 100}%` }} />
          </div>
          <b className="small num">
            {doneCount} de {required.length}
          </b>
        </div>
      </div>

      <div className="split">
        <div className="col" style={gap(22)}>
          <Tabs<Client>
            aria-label="Sua IA"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "claude", label: (<><Icon name="monitor" size="s" />Claude</>) },
              { id: "gpt", label: (<><Icon name="monitor" size="s" />ChatGPT</>) },
            ]}
          />

          <div className="card pad col" style={gap(16)}>
            <div className="row" style={gap(14)}>
              <span className="dot dot-now">1</span>
              <h2 className="h3">Copie o endereço do conector</h2>
            </div>
            <p className="muted">
              É um endereço só para todos os especialistas. Quando a sua IA se conectar, você entra com a sua conta do Solver e ela passa a usar o que você comprou.
            </p>
            <div className="row m-col" style={gap(10)}>
              <input className="input mono" readOnly value={url} placeholder="Carregando…" aria-label="Endereço do conector" style={{ flex: 1, minWidth: 0 }} onFocus={(e) => e.currentTarget.select()} />
              <Button size="lg" icon={copied ? "check" : "copy"} onClick={copy} disabled={!url}>
                {copied ? "Copiado" : "Copiar endereço"}
              </Button>
            </div>
          </div>

          <div className="card pad col" style={gap(16)}>
            <div className="row" style={gap(14)}>
              <span className="dot dot-now">2</span>
              <h2 className="h3">{gpt ? "Abra as configurações do ChatGPT" : "Abra as configurações do Claude"}</h2>
            </div>
            <p className="muted">
              {gpt
                ? "No ChatGPT, abra as configurações e procure por Conectores (ou Aplicativos). Escolha adicionar um conector personalizado."
                : "No Claude, abra Configurações, entre em Conectores e escolha Adicionar conector personalizado."}
            </p>
            <Ill>
              <div className={s.illGrid}>
                <div className={`col ${s.illSide}`} style={gap(8)}>
                  <div className="skel" style={{ width: "70%" }} />
                  <div className="ill-hi row" style={{ ...gap(8), padding: "8px 10px" }}>
                    <Icon name="plug" size="s" />
                    <b className="tiny">Conectores</b>
                  </div>
                  <div className="skel" style={{ width: "60%" }} />
                  <div className="skel" style={{ width: "75%" }} />
                </div>
                <div className={`col ${s.illMain}`} style={gap(12)}>
                  <div className="skel" style={{ width: "40%", height: 12, background: "var(--ink)", opacity: 0.8 }} />
                  <div className="skel" style={{ width: "85%" }} />
                  <div className={`btn btn-secondary ill-hi ${s.illBtn}`}>
                    <Icon name="plus" size="s" />
                    {gpt ? "Criar conector" : "Adicionar conector personalizado"}
                  </div>
                </div>
              </div>
            </Ill>
          </div>

          <div className="card pad col" style={gap(16)}>
            <div className="row" style={gap(14)}>
              <span className="dot dot-now">3</span>
              <h2 className="h3">Cole o endereço e confirme</h2>
            </div>
            <p className="muted">
              Cole o endereço que você copiou no passo 1 e confirme. A sua IA vai abrir uma página do Solver pedindo a sua autorização: entre com a mesma conta que você usa aqui.
            </p>
            <Ill>
              <div className="col" style={{ ...gap(12), padding: 18 }}>
                <div className="skel" style={{ width: "45%", height: 12, background: "var(--ink)", opacity: 0.8 }} />
                <div className="row card-flat ill-hi" style={{ padding: "10px 12px", borderRadius: 10 }}>
                  <span className="mono tiny trunc">{url || "…"}</span>
                </div>
                <div className="row" style={{ ...gap(8), justifyContent: "flex-end" }}>
                  <span className="btn btn-ghost" style={{ minHeight: 40 }}>
                    Cancelar
                  </span>
                  <span className="btn btn-primary" style={{ minHeight: 40 }}>
                    {gpt ? "Criar" : "Adicionar"}
                  </span>
                </div>
              </div>
            </Ill>
            <div>
              <Button variant="secondary" onClick={() => setAdded(true)} disabled={added} icon={added ? "check" : undefined}>
                {added ? "Anotado, obrigado" : "Já colei e confirmei"}
              </Button>
            </div>
          </div>

          <div className="card pad col" style={gap(16)}>
            <div className="row" style={gap(14)}>
              <span className="dot dot-now">4</span>
              <h2 className="h3">Faça um teste</h2>
            </div>
            <p className="muted">Abra uma conversa nova e peça algo simples. Se a sua IA responder citando o especialista, deu certo.</p>
            <div className="card-flat pad-s row between" style={gap(12)}>
              <span className="grow">{agent ? `“Use o ${agent.name} e me diga como ele pode me ajudar.”` : "“Quais especialistas do Solver eu tenho?”"}</span>
            </div>
          </div>
        </div>

        <aside className="sticky col" style={gap(16)}>
          <div className="card pad col" style={gap(16)}>
            <h2 className="h3">Checklist de requisitos</h2>
            {checks.map((k) => (
              <div key={k.key} className="row start" style={gap(12)}>
                <span className={`dot ${k.ok ? "dot-ok" : k.optional ? "" : "dot-now"}`} aria-hidden>
                  {k.ok ? "✓" : "•"}
                </span>
                <div className="grow col" style={{ ...gap(8), minWidth: 0, alignItems: "flex-start" }}>
                  <div>
                    <b>{k.label}</b>
                    <div className={`small ${k.ok ? "ok" : k.optional ? "muted" : "warn"}`} aria-live={k.key === "test" ? "polite" : undefined}>
                      {k.ok ? k.statusOk : k.statusNo}
                    </div>
                    {!k.ok && k.howTo ? (
                      <div className="small muted" style={{ marginTop: 4, overflowWrap: "anywhere" }}>
                        {k.howTo}
                      </div>
                    ) : null}
                    {!k.ok && k.helpUrl ? (
                      <a className="link small" href={k.helpUrl} target="_blank" rel="noopener noreferrer">
                        Ajuda oficial
                      </a>
                    ) : null}
                  </div>
                  {!k.ok && k.act ? (
                    <Button variant="secondary" size="sm" loading={k.acting} onClick={k.act}>
                      {k.actLabel}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          {allDone ? (
            <div className="card pad row" style={{ ...gap(14), borderColor: "var(--mint)" }} role="status">
              <span className="dot dot-ok">
                <Icon name="check" />
              </span>
              <div className="grow">
                <b>Tudo pronto!</b>
                <div className="small muted">{agent ? "Seu especialista já pode ser usado na sua IA." : "Seus especialistas já podem ser usados na sua IA."}</div>
                {agent && trial?.owned ? (
                  <div className="tiny faint" style={{ marginTop: 4 }}>
                    Depois de usar,{" "}
                    <Link className="link" href={`/especialistas/${agent.slug}#avaliar`}>
                      conte como foi
                    </Link>
                    .
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="card-flat pad-s row start" style={gap(12)}>
            <Icon name="message" />
            <span className="small grow">
              {creator ? (
                <>
                  Travou em algum passo? Confira o endereço do passo 1 ou{" "}
                  {logged && agent ? (
                    <button type="button" className={`link ${s.helpLink}`} onClick={() => setHelping(true)}>
                      peça ajuda a {creator.name}
                    </button>
                  ) : (
                    <Link className="link" href={`/criadores/${creator.id}`}>
                      veja quem é {creator.name}
                    </Link>
                  )}
                  .
                </>
              ) : (
                <>
                  Travou em algum passo? Confira se o endereço do passo 1 foi colado inteiro e se você autorizou com a mesma conta. <Link className="link" href="/biblioteca">Ver minha biblioteca</Link>
                </>
              )}
            </span>
          </div>
        </aside>
      </div>
      {helping && agent && creator ? <HelpDialog slug={agent.slug} creatorName={creator.name} onClose={() => setHelping(false)} /> : null}
    </section>
  );
}
