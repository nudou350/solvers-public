"use client";
import type { Agent, License } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { setTheme } from "@/components/layout/ThemeToggle";
import {
  Avatar,
  Button,
  Card,
  Chip,
  Dialog,
  Empty,
  Icon,
  ICONS,
  Loading,
  Notice,
  Price,
  RepBadge,
  Spinner,
  Stars,
  Tabs,
  Tile,
  useToast,
  Verified,
  type IconName,
} from "@/components/ui";
import { useErrorText } from "@/lib/error-text";
import { short, useFormat } from "@/lib/format";
import { useRate, useSession } from "@/lib/session";
import { txErrorMessage, useFaucet, useTx } from "@/lib/tx";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="col" style={{ "--gap": "16px" } as CSSProperties}>
      <h2 className="h3">{title}</h2>
      {children}
    </section>
  );
}

function SessionPanel() {
  const t = useTranslations("devkit.session");
  const f = useFormat();
  const errorText = useErrorText();
  const { status, me, wallet, walletKind, login, logout, loggingIn, api, config } = useSession();
  const toast = useToast();
  const faucet = useFaucet();
  const tx = useTx();
  const [balance, setBalance] = useState<number | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [slug, setSlug] = useState("");
  const [licenses, setLicenses] = useState<License[] | null>(null);
  const [lastAsset, setLastAsset] = useState<string | null>(null);

  useEffect(() => {
    api.getAgents({ sort: "rating" }).then((a) => {
      setAgents(a);
      setSlug((s) => s || a[a.length - 1]?.slug || "");
    }, () => {});
  }, [api]);

  const reload = async () => {
    const [b, l] = await Promise.all([api.getBalance(), api.getMyLicenses()]);
    setBalance(b.usdc);
    setLicenses(l);
  };

  useEffect(() => {
    if (me) void reload().catch(() => {});
    else {
      setBalance(null);
      setLicenses(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const agent = agents.find((a) => a.slug === slug);
  const owned = new Set(licenses?.map((l) => l.agentId));

  const buy = async () => {
    if (!agent) return;
    const r = await tx.run(() => api.buildPurchase(agent.id));
    if (r) {
      setLastAsset(typeof r.meta?.asset === "string" ? r.meta.asset : null);
      toast({ tone: "ok", title: t("purchaseDone"), text: t("purchaseDoneText", { name: agent.name }) });
      await reload();
    }
  };

  return (
    <Card>
      <div className="col" style={{ "--gap": "18px" } as CSSProperties}>
        <div className="row between wrapx">
          <div className="col" style={{ "--gap": "4px" } as CSSProperties}>
            <span className="eyebrow">{t("title", { kind: walletKind === "privy" ? t("kindPrivy") : t("kindDev") })}</span>
            <span className="h4" data-testid="session-status">
              {status === "loading" ? t("loading") : me ? t("loggedIn", { wallet: short(me.wallet) }) : t("loggedOut")}
            </span>
            {me ? (
              <span className="mono faint" data-testid="session-wallet">
                {me.wallet}
              </span>
            ) : null}
            {me && !wallet ? <span className="small warn">{t("walletMissing")}</span> : null}
          </div>
          <div className="row wrapx">
            {me ? (
              <Button variant="secondary" onClick={() => void logout()} data-testid="logout">
                {t("signOut")}
              </Button>
            ) : null}
            {!me || !wallet ? (
              <Button loading={loggingIn} onClick={() => login().catch((e: unknown) => toast({ tone: "bad", title: t("signInFailed"), text: errorText(e) }))} data-testid="login">
                {t("signInWallet")}
              </Button>
            ) : null}
          </div>
        </div>
        {config ? (
          <p className="small faint">
            {t("network", {
              cluster: config.cluster,
              rate: f.num(config.brlPerUsd, 0, 4),
              faucet: config.faucetEnabled ? t("faucetAmount", { amount: config.faucetAmountUsdc }) : t("faucetOff"),
            })}
          </p>
        ) : null}
        {me ? (
          <>
            <hr className="divider" />
            <div className="row between wrapx">
              <span>
                {t("balance")}{" "}
                <b className="num" data-testid="balance">
                  {balance == null ? "…" : f.usdc(balance)}
                </b>
              </span>
              {faucet.enabled ? (
                <Button
                  variant="secondary"
                  icon="gift"
                  loading={faucet.pending}
                  data-testid="faucet"
                  onClick={async () => {
                    const got = await faucet.receive();
                    if (got != null) toast({ tone: "ok", title: t("gotTestUsdc", { amount: f.usdc(got) }) });
                    await reload().catch(() => {});
                  }}
                >
                  {t("getTestUsdc")}
                </Button>
              ) : null}
            </div>
            {faucet.error ? <Notice tone="warn" title={faucet.error.title}>{faucet.error.text}</Notice> : null}
            <div className="row wrapx m-col" style={{ alignItems: "flex-end" }}>
              <label className="field grow">
                <span className="label">{t("pickSolver")}</span>
                <select className="select" value={slug} onChange={(e) => setSlug(e.target.value)} data-testid="agent-select">
                  {agents.map((a) => (
                    <option key={a.id} value={a.slug}>
                      {a.name} · {f.usdc(a.priceUsdc)} {owned.has(a.id) ? t("alreadyOwned") : ""}
                    </option>
                  ))}
                </select>
              </label>
              <Button icon="bag" loading={tx.pending} onClick={() => void buy()} disabled={!agent} data-testid="buy">
                {t("buy")}
              </Button>
            </div>
            {tx.error ? (
              <Notice
                tone="bad"
                role="alert"
                title={tx.error.title}
                actions={
                  tx.error.action === "faucet" && faucet.enabled ? (
                    <Button size="sm" variant="secondary" onClick={() => void faucet.receive().then(reload)}>
                      {t("getTestUsdc")}
                    </Button>
                  ) : null
                }
              >
                {tx.error.text}
              </Notice>
            ) : null}
            {tx.result ? (
              <Notice tone="ok" title={t("txConfirmed")}>
                <span className="mono" data-testid="tx-signature">
                  {tx.result.signature}
                </span>
              </Notice>
            ) : null}
            <div>
              <span className="label">{t("myLicenses")}</span>
              <ul className="col small" style={{ "--gap": "4px", marginTop: 6 } as CSSProperties} data-testid="licenses">
                {licenses == null ? <li className="faint">…</li> : null}
                {licenses?.length === 0 ? <li className="faint">{t("noLicenses")}</li> : null}
                {licenses?.map((l) => (
                  <li key={l.id} data-asset={l.id} className={l.id === lastAsset ? "ok bold" : undefined}>
                    {agents.find((a) => a.id === l.agentId)?.name ?? l.agentId} · {l.type} · {f.date(l.acquiredAt)} · <span className="mono">{short(l.id)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </div>
    </Card>
  );
}

export function Kit() {
  const t = useTranslations("devkit");
  const f = useFormat();
  const rate = useRate();
  const toast = useToast();
  const [tab, setTab] = useState<"lic" | "mem" | "hist">("lic");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogLocked, setDialogLocked] = useState(false);
  const soon = new Date(Date.now() + 5 * 3600_000 + 12 * 60_000).toISOString();

  return (
    <div className="wrap sec col" style={{ "--gap": "48px" } as CSSProperties}>
      <header className="col" style={{ "--gap": "10px" } as CSSProperties}>
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className="display h2">{t("title")}</h1>
        <p className="muted">{t("intro")}</p>
        <div className="row wrapx">
          <Button variant="secondary" icon="sun" onClick={() => setTheme("light")} data-testid="theme-light">
            {t("themeLight")}
          </Button>
          <Button variant="secondary" icon="moon" onClick={() => setTheme("dark")} data-testid="theme-dark">
            {t("themeDark")}
          </Button>
        </div>
      </header>

      <Section title={t("sections.session")}>
        <SessionPanel />
      </Section>

      <Section title={t("sections.typography")}>
        <div className="col" style={{ "--gap": "8px" } as CSSProperties}>
          <span className="display h1s">{t("typography.display")}</span>
          <span className="h3">{t("typography.h3")}</span>
          <span className="h4">{t("typography.h4")}</span>
          <p className="lead">{t("typography.lead")}</p>
          <p>{t.rich("typography.normal", { link: (c) => <a className="link" href="#">{c}</a> })}</p>
          <p className="small muted">{t("typography.small")} <span className="ok">{t("typography.ok")}</span> · <span className="warn">{t("typography.warn")}</span> · <span className="bad">{t("typography.bad")}</span></p>
        </div>
      </Section>

      <Section title={t("sections.buttons")}>
        <div className="row wrapx">
          <Button>{t("buttons.primary")}</Button>
          <Button variant="secondary">{t("buttons.secondary")}</Button>
          <Button variant="ghost">{t("buttons.ghost")}</Button>
          <Button variant="ok" icon="check">{t("buttons.ok")}</Button>
          <Button variant="danger" icon="trash">{t("buttons.delete")}</Button>
          <Button loading>{t("buttons.loading")}</Button>
          <Button disabled>{t("buttons.disabled")}</Button>
          <Button size="lg" iconRight="arrow-right">{t("buttons.large")}</Button>
          <Button size="sm" variant="secondary">{t("buttons.small")}</Button>
        </div>
      </Section>

      <Section title={t("sections.chips")}>
        <div className="row wrapx">
          <Chip>{t("chips.default")}</Chip>
          <Chip tone="ok" icon="shield-check">{t("chips.guarantee")}</Chip>
          <Chip tone="brand">{t("chips.new")}</Chip>
          <Chip tone="warn">{t("chips.review")}</Chip>
          <Chip tone="red">{t("chips.disputed")}</Chip>
          <Chip tone="plain">{t("chips.plain")}</Chip>
          {[97, 92, 85, 70, 40].map((s) => (
            <RepBadge key={s} score={s} />
          ))}
          <Verified />
          <span className="trend up"><Icon name="trend-up" size="s" />{f.pct(4.2)}</span>
          <span className="trend down"><Icon name="trend-down" size="s" />{f.pct(-1.3)}</span>
        </div>
      </Section>

      <Section title={t("sections.cards")}>
        <div className="g3">
          <Card>
            <div className="col">
              <div className="row">
                <Tile category="Desenvolvimento" />
                <div className="col grow" style={{ "--gap": "2px" } as CSSProperties}>
                  <span className="h4">{t("cards.solverName")}</span>
                  <span className="small faint">{f.categoryLabel("Desenvolvimento")}</span>
                </div>
              </div>
              <Stars rating={4.7} showValue count={128} />
              <Price usdc={19} rate={rate} round />
            </div>
          </Card>
          <Card flat>
            <div className="col">
              <span className="h4">{t("cards.flat")}</span>
              <Price usdc={4} rate={rate} size="s" suffix={t("cards.perTask")} inline />
              <Price usdc={24} rate={rate} size="xl" />
            </div>
          </Card>
          <Card href="/dev/kit" pad="s">
            <div className="col">
              <span className="h4">{t("cards.link")}</span>
              <span className="small muted">{t("cards.hover")}</span>
              <div className="row">
                <Avatar name="Ana Souza" size="s" />
                <Avatar name="Bruno Lima" />
                <Avatar name="Carla" size="l" />
              </div>
            </div>
          </Card>
        </div>
        <div className="row wrapx">
          {["Desenvolvimento", "Design", "Dia a dia", "Escrita", "Negócios", "New category"].map((c) => (
            <Tile key={c} category={c} size="s" />
          ))}
        </div>
      </Section>

      <Section title={t("sections.tabs")}>
        <Tabs
          aria-label={t("tabs.example")}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "lic", label: t("tabs.solvers") },
            { id: "mem", label: t("tabs.memories"), count: 3 },
            { id: "hist", label: t("tabs.history") },
          ]}
        />
        <p className="small muted">{t("tabs.active", { tab })}</p>
      </Section>

      <Section title={t("sections.form")}>
        <div className="g2">
          <label className="field">
            <span className="label">{t("form.taskTitle")}</span>
            <input className="input" placeholder={t("form.taskPlaceholder")} />
            <span className="hint">{t("form.hint")}</span>
          </label>
          <label className="field">
            <span className="label">{t("form.description")}</span>
            <textarea className="textarea" placeholder={t("form.descriptionPlaceholder")} />
          </label>
        </div>
      </Section>

      <Section title={t("sections.notices")}>
        <div className="col">
          <Notice title={t("notices.infoTitle")}>{t("notices.infoText")}</Notice>
          <Notice tone="ok" title={t("notices.okTitle")}>{t("notices.okText")}</Notice>
          <Notice tone="warn" title={t("notices.warnTitle")} actions={<Button size="sm" variant="secondary">{t("session.getTestUsdc")}</Button>}>
            {t("notices.warnText")}
          </Notice>
          <Notice tone="bad" title={t("notices.badTitle")}>{txErrorMessage(new Error(t("notices.networkFailure")), f.locale).text}</Notice>
          <div className="row wrapx">
            <Button variant="secondary" onClick={() => toast({ tone: "ok", title: t("notices.toastOkTitle"), text: t("notices.toastOkText") })}>{t("notices.toastOk")}</Button>
            <Button variant="secondary" onClick={() => toast({ tone: "bad", title: t("notices.toastErrorTitle"), text: t("notices.toastErrorText"), action: { label: t("notices.toastRetry"), onClick: () => {} } })}>{t("notices.toastError")}</Button>
          </div>
          <div className="g2">
            <Empty icon="library" title={t("notices.emptyTitle")} action={<Button href="/">{t("notices.emptyAction")}</Button>}>
              {t("notices.emptyText")}
            </Empty>
            <Card>
              <Loading />
              <div className="row" style={{ justifyContent: "center" }}>
                <Spinner size="s" /> <Spinner /> <Spinner size="l" />
              </div>
            </Card>
          </div>
        </div>
      </Section>

      <Section title={t("sections.dialog")}>
        <div className="row wrapx">
          <Button variant="secondary" icon="tag" onClick={() => setDialogOpen(true)}>
            {t("dialog.open")}
          </Button>
        </div>
        {dialogOpen ? (
          <Dialog title={t("dialog.title")} onClose={() => setDialogOpen(false)} locked={dialogLocked}>
            <p className="muted">
              {t("dialog.body")}
            </p>
            <label className="field">
              <span className="label">{t("dialog.field")}</span>
              <input className="input" data-autofocus placeholder={t("dialog.placeholder")} />
            </label>
            <div className="row end wrapx">
              <Button variant="secondary" onClick={() => setDialogLocked((v) => !v)}>
                {dialogLocked ? t("dialog.unlock") : t("dialog.lock")}
              </Button>
              <Button onClick={() => setDialogOpen(false)} disabled={dialogLocked}>{t("dialog.close")}</Button>
            </div>
          </Dialog>
        ) : null}
      </Section>

      <Section title={t("sections.format")}>
        <ul className="col small mono" style={{ "--gap": "4px" } as CSSProperties}>
          <li>{t("format.ago", { value: f.ago(new Date(Date.now() - 3 * 86400_000).toISOString()) })}</li>
          <li>{t("format.date", { value: f.date(new Date().toISOString()) })}</li>
          <li>{t("format.countdown", { text: f.countdown(soon).text, urgent: String(f.countdown(soon).urgent) })}</li>
          <li>{t("format.repLevel", { label: f.repLevel(91).label })}</li>
          <li>{t("format.short", { value: short("J4riUZWJELvMbYwcXuQ3iDHcF6LaFFEmSXDLH618AGy4") })}</li>
        </ul>
      </Section>

      <Section title={t("sections.icons", { n: Object.keys(ICONS).length })}>
        <div className="g6 m2" style={{ "--gap": "10px" } as CSSProperties}>
          {(Object.keys(ICONS) as IconName[]).map((n) => (
            <div key={n} className="row card-flat pad-s" style={{ "--gap": "10px", padding: "10px 12px", borderRadius: 14 } as CSSProperties}>
              <Icon name={n} />
              <span className="tiny trunc">{n}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
