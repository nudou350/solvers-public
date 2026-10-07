"use client";
// Instalação guiada (design: instalacao-guiada). Endereço único do conector (getConfig().connectorUrl),
// passo a passo para Claude e ChatGPT e checklist com o teste real da conexão (getConnector()).
import type { AgentDetail, ConnectorStatus } from "@solvers/api-client";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { useErrorText } from "@/lib/error-text";
import { copyText, useFormat } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import s from "./checkout.module.css";
import { HelpDialog } from "./HelpDialog";
import { useTxErrorMessage } from "@/lib/tx";

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


function Ill({ children }: { children: ReactNode }) {
  const t = useTranslations("install");
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
        {t("setup.ill.caption")}
      </div>
    </div>
  );
}

export function InstallView({ detail }: { detail: AgentDetail | null }) {
  const { api, config, status, me, login, loggingIn } = useSession();
  const toast = useToast();
  const t = useTranslations("install");
  const f = useFormat();
  const locale = useLocale();
  const errorText = useErrorText();
  const txError = useTxErrorMessage();
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
          const info = txError(e);
          toast({ tone: "bad", title: info.title, text: info.text });
        }
      } finally {
        setTesting(false);
      }
    },
    [api, toast, txError],
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

  const doLogin = () => login().catch((e: unknown) => toast({ tone: "bad", title: t("setup.checklist.loginFailed"), text: errorText(e) }));

  const planReq = agent?.requirements.find((r) => r.type === "plan");
  const connectorReqs = agent?.requirements.filter((r) => r.type === "connector") ?? [];
  const logged = status === "authed" && !!me;
  const first = mine[0];
  const otherNames = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format([...new Set(others.map((c) => c.clientName))]);
  // O que muda sem um conector opcional. Figma tem texto próprio; os demais, um genérico.
  const optionalHint = (key: string | undefined, name: string) =>
    (key ?? name).toLowerCase() === "figma" ? t("setup.checklist.connector.optionalFigma") : t("setup.checklist.connector.optionalGeneric", { name });

  const checks: Check[] = [
    {
      key: "plan",
      label: t("setup.checklist.plan.label", { client: clientName }),
      ok: plan,
      statusOk: t("setup.checklist.plan.ok"),
      statusNo: planReq ? t("setup.checklist.plan.noWithReq", { label: planReq.label }) : t("setup.checklist.plan.no"),
      actLabel: t("setup.checklist.plan.act"),
      act: () => setPlan(true),
    },
    ...connectorReqs.map<Check>((r) => {
      const n = f.connectorName(r.label);
      return {
        key: `conn-${r.key ?? r.label}`,
        label: r.optional ? t("setup.checklist.connector.labelOptional", { name: n }) : t("setup.checklist.connector.label", { name: n }),
        ok: !!conns[r.label],
        statusOk: t("setup.checklist.connector.ok"),
        statusNo: r.optional ? optionalHint(r.key, n) : t("setup.checklist.connector.no", { name: n }),
        actLabel: t("setup.checklist.connector.act"),
        act: () => setConns((c) => ({ ...c, [r.label]: true })),
        optional: r.optional,
        howTo: r.howTo,
        helpUrl: r.helpUrl,
      };
    }),
    {
      key: "added",
      label: t("setup.checklist.added.label"),
      ok: added,
      statusOk: t("setup.checklist.added.ok"),
      statusNo: t("setup.checklist.added.no"),
      actLabel: t("setup.checklist.added.act"),
      act: () => setAdded(true),
    },
    {
      key: "test",
      label: t("setup.checklist.test.label"),
      ok: connected,
      statusOk: first ? t("setup.checklist.test.ok", { client: first.clientName, ago: f.ago(first.authorizedAt) }) : t("setup.checklist.test.okNoClient"),
      statusNo: !logged
        ? t("setup.checklist.test.noLogin")
        : others.length
          ? t("setup.checklist.test.noOthers", { names: otherNames, client: clientName })
          : testedEmpty
            ? t("setup.checklist.test.noEmpty", { client: clientName })
            : added
              ? t("setup.checklist.test.ready")
              : t("setup.checklist.test.doStep3"),
      actLabel: !logged ? t("setup.checklist.test.actLogin") : t("setup.checklist.test.actTest"),
      act: !logged ? doLogin : () => void test(false),
      acting: !logged ? loggingIn : testing,
    },
  ];
  const required = checks.filter((k) => !k.optional);
  const doneCount = required.filter((k) => k.ok).length;
  const allDone = doneCount === required.length;
  const name = agent?.name ?? "Solvers";

  return (
    <section className="wrap" style={{ paddingTop: 36, paddingBottom: 56 }}>
      <div className="col" style={{ ...gap(12), marginBottom: 32 }}>
        <span className="eyebrow">{t("setup.eyebrow")}</span>
        <h1 className="display h1s">{t("setup.title", { name })}</h1>
        <p className="lead" style={{ maxWidth: 660 }}>
          {agent ? t("setup.leadAgent") : t("setup.leadGeneric")}
        </p>
        {trial && !trial.owned && trial.trialUsesLeft > 0 ? (
          <div>
            <Chip tone="brand" icon="gift">
              {t("setup.trial", { n: trial.trialUsesLeft })}
            </Chip>
          </div>
        ) : null}
        <div className="row" style={{ ...gap(14), marginTop: 6, maxWidth: 460 }}>
          <div className="bar mint grow" role="progressbar" aria-valuemin={0} aria-valuemax={required.length} aria-valuenow={doneCount} aria-label={t("setup.progressLabel")}>
            <i style={{ width: `${(doneCount / required.length) * 100}%` }} />
          </div>
          <b className="small num">
            {t("setup.progress", { done: doneCount, total: required.length })}
          </b>
        </div>
      </div>

      <div className="split">
        <div className="col" style={gap(22)}>
          <Tabs<Client>
            aria-label={t("setup.tabsLabel")}
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
              <h2 className="h3">{t("setup.step1.title")}</h2>
            </div>
            <p className="muted">
              {t("setup.step1.body")}
            </p>
            <div className="row m-col" style={gap(10)}>
              <input className="input mono" readOnly value={url} placeholder={t("setup.step1.loading")} aria-label={t("setup.step1.inputLabel")} style={{ flex: 1, minWidth: 0 }} onFocus={(e) => e.currentTarget.select()} />
              <Button size="lg" icon={copied ? "check" : "copy"} onClick={copy} disabled={!url}>
                {copied ? t("setup.step1.copied") : t("setup.step1.copy")}
              </Button>
            </div>
          </div>

          <div className="card pad col" style={gap(16)}>
            <div className="row" style={gap(14)}>
              <span className="dot dot-now">2</span>
              <h2 className="h3">{gpt ? t("setup.step2.titleGpt") : t("setup.step2.titleClaude")}</h2>
            </div>
            <p className="muted">
              {gpt ? t("setup.step2.bodyGpt") : t("setup.step2.bodyClaude")}
            </p>
            <Ill>
              <div className={s.illGrid}>
                <div className={`col ${s.illSide}`} style={gap(8)}>
                  <div className="skel" style={{ width: "70%" }} />
                  <div className="ill-hi row" style={{ ...gap(8), padding: "8px 10px" }}>
                    <Icon name="plug" size="s" />
                    <b className="tiny">{gpt ? t("setup.step2.sidebarGpt") : t("setup.step2.sidebarClaude")}</b>
                  </div>
                  <div className="skel" style={{ width: "60%" }} />
                  <div className="skel" style={{ width: "75%" }} />
                </div>
                <div className={`col ${s.illMain}`} style={gap(12)}>
                  <div className="skel" style={{ width: "40%", height: 12, background: "var(--ink)", opacity: 0.8 }} />
                  <div className="skel" style={{ width: "85%" }} />
                  <div className={`btn btn-secondary ill-hi ${s.illBtn}`}>
                    <Icon name="plus" size="s" />
                    {gpt ? t("setup.step2.buttonGpt") : t("setup.step2.buttonClaude")}
                  </div>
                </div>
              </div>
            </Ill>
          </div>

          <div className="card pad col" style={gap(16)}>
            <div className="row" style={gap(14)}>
              <span className="dot dot-now">3</span>
              <h2 className="h3">{t("setup.step3.title")}</h2>
            </div>
            <p className="muted">
              {t("setup.step3.body")}
            </p>
            <Ill>
              <div className="col" style={{ ...gap(12), padding: 18 }}>
                <div className="skel" style={{ width: "45%", height: 12, background: "var(--ink)", opacity: 0.8 }} />
                <div className="row card-flat ill-hi" style={{ padding: "10px 12px", borderRadius: 10 }}>
                  <span className="mono tiny trunc">{url || "…"}</span>
                </div>
                <div className="row" style={{ ...gap(8), justifyContent: "flex-end" }}>
                  <span className="btn btn-ghost" style={{ minHeight: 40 }}>
                    {t("setup.step3.cancel")}
                  </span>
                  <span className="btn btn-primary" style={{ minHeight: 40 }}>
                    {gpt ? t("setup.step3.confirmGpt") : t("setup.step3.confirmClaude")}
                  </span>
                </div>
              </div>
            </Ill>
            <div>
              <Button variant="secondary" onClick={() => setAdded(true)} disabled={added} icon={added ? "check" : undefined}>
                {added ? t("setup.step3.doneNoted") : t("setup.step3.done")}
              </Button>
            </div>
          </div>

          <div className="card pad col" style={gap(16)}>
            <div className="row" style={gap(14)}>
              <span className="dot dot-now">4</span>
              <h2 className="h3">{t("setup.step4.title")}</h2>
            </div>
            <p className="muted">{t("setup.step4.body")}</p>
            <div className="card-flat pad-s row between" style={gap(12)}>
              <span className="grow">{agent ? t("setup.step4.promptAgent", { name: agent.name }) : t("setup.step4.promptGeneric")}</span>
            </div>
          </div>
        </div>

        <aside className="sticky col" style={gap(16)}>
          <div className="card pad col" style={gap(16)}>
            <h2 className="h3">{t("setup.checklist.title")}</h2>
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
                        {t("setup.checklist.officialHelp")}
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
                <b>{t("setup.allDone.title")}</b>
                <div className="small muted">{agent ? t("setup.allDone.agent") : t("setup.allDone.generic")}</div>
                {agent && trial?.owned ? (
                  <div className="tiny faint" style={{ marginTop: 4 }}>
                    {t.rich("setup.allDone.review", {
                      link: (chunks) => (
                        <Link className="link" href={`/solvers/${agent.slug}#avaliar`}>
                          {chunks}
                        </Link>
                      ),
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="card-flat pad-s row start" style={gap(12)}>
            <Icon name="message" />
            <span className="small grow">
              {creator ? (
                logged && agent ? (
                  t.rich("setup.stuck.askCreator", {
                    name: creator.name,
                    action: (chunks) => (
                      <button type="button" className={`link ${s.helpLink}`} onClick={() => setHelping(true)}>
                        {chunks}
                      </button>
                    ),
                  })
                ) : (
                  t.rich("setup.stuck.seeCreator", {
                    name: creator.name,
                    action: (chunks) => (
                      <Link className="link" href={`/creators/${creator.id}`}>
                        {chunks}
                      </Link>
                    ),
                  })
                )
              ) : (
                <>
                  {t("setup.stuck.generic")} <Link className="link" href="/library">{t("setup.stuck.library")}</Link>
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
