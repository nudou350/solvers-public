"use client";
import type { Agent, License } from "@solvers/api-client";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { setTheme } from "@/components/layout/ThemeToggle";
import {
  Avatar,
  Button,
  Card,
  Chip,
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
import { ago, countdown, date, repLevel, short, usdc } from "@/lib/format";
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
    const r = await tx.run(() => api.buildPurchase(agent.id, "permanent"));
    if (r) {
      setLastAsset(typeof r.meta?.asset === "string" ? r.meta.asset : null);
      toast({ tone: "ok", title: "Compra concluída", text: `${agent.name}: licença registrada.` });
      await reload();
    }
  };

  return (
    <Card>
      <div className="col" style={{ "--gap": "18px" } as CSSProperties}>
        <div className="row between wrapx">
          <div className="col" style={{ "--gap": "4px" } as CSSProperties}>
            <span className="eyebrow">Sessão ({walletKind === "privy" ? "Privy" : "carteira de desenvolvimento"})</span>
            <span className="h4" data-testid="session-status">
              {status === "loading" ? "Carregando…" : me ? `Logado: ${short(me.wallet)}` : "Não logado"}
            </span>
            {me ? (
              <span className="mono faint" data-testid="session-wallet">
                {me.wallet}
              </span>
            ) : null}
            {me && !wallet ? <span className="small warn">A carteira desta sessão não está neste navegador. Entre de novo para assinar.</span> : null}
          </div>
          <div className="row wrapx">
            {me ? (
              <Button variant="secondary" onClick={() => void logout()} data-testid="logout">
                Sair
              </Button>
            ) : null}
            {!me || !wallet ? (
              <Button loading={loggingIn} onClick={() => login().catch((e: unknown) => toast({ tone: "bad", title: "Não deu para entrar", text: (e as Error).message }))} data-testid="login">
                Entrar com a carteira
              </Button>
            ) : null}
          </div>
        </div>
        {config ? (
          <p className="small faint">
            Rede {config.cluster} · R$ {config.brlPerUsd.toLocaleString("pt-BR")} por dólar · faucet {config.faucetEnabled ? `${config.faucetAmountUsdc} USDC` : "desligado"}
          </p>
        ) : null}
        {me ? (
          <>
            <hr className="divider" />
            <div className="row between wrapx">
              <span>
                Saldo:{" "}
                <b className="num" data-testid="balance">
                  {balance == null ? "…" : usdc(balance)}
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
                    if (got != null) toast({ tone: "ok", title: `Você recebeu ${usdc(got)} de teste` });
                    await reload().catch(() => {});
                  }}
                >
                  Receber USDC de teste
                </Button>
              ) : null}
            </div>
            {faucet.error ? <Notice tone="warn" title={faucet.error.title}>{faucet.error.text}</Notice> : null}
            <div className="row wrapx m-col" style={{ alignItems: "flex-end" }}>
              <label className="field grow">
                <span className="label">Especialista (compra de teste)</span>
                <select className="select" value={slug} onChange={(e) => setSlug(e.target.value)} data-testid="agent-select">
                  {agents.map((a) => (
                    <option key={a.id} value={a.slug}>
                      {a.name} · {usdc(a.priceUsdc)} {owned.has(a.id) ? "(já tem)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <Button icon="bag" loading={tx.pending} onClick={() => void buy()} disabled={!agent} data-testid="buy">
                Comprar licença
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
                      Receber USDC de teste
                    </Button>
                  ) : null
                }
              >
                {tx.error.text}
              </Notice>
            ) : null}
            {tx.result ? (
              <Notice tone="ok" title="Transação confirmada">
                <span className="mono" data-testid="tx-signature">
                  {tx.result.signature}
                </span>
              </Notice>
            ) : null}
            <div>
              <span className="label">Minhas licenças</span>
              <ul className="col small" style={{ "--gap": "4px", marginTop: 6 } as CSSProperties} data-testid="licenses">
                {licenses == null ? <li className="faint">…</li> : null}
                {licenses?.length === 0 ? <li className="faint">Nenhuma ainda.</li> : null}
                {licenses?.map((l) => (
                  <li key={l.id} data-asset={l.id} className={l.id === lastAsset ? "ok bold" : undefined}>
                    {agents.find((a) => a.id === l.agentId)?.name ?? l.agentId} · {l.type} · {date(l.acquiredAt)} · <span className="mono">{short(l.id)}</span>
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
  const rate = useRate();
  const toast = useToast();
  const [tab, setTab] = useState<"lic" | "mem" | "hist">("lic");
  const soon = new Date(Date.now() + 5 * 3600_000 + 12 * 60_000).toISOString();

  return (
    <div className="wrap sec col" style={{ "--gap": "48px" } as CSSProperties}>
      <header className="col" style={{ "--gap": "10px" } as CSSProperties}>
        <span className="eyebrow">Desenvolvimento</span>
        <h1 className="display h2">Kit de componentes</h1>
        <p className="muted">Base visual (sv.css), componentes de src/components/ui e o login com a carteira.</p>
        <div className="row wrapx">
          <Button variant="secondary" icon="sun" onClick={() => setTheme("light")} data-testid="theme-light">
            Tema claro
          </Button>
          <Button variant="secondary" icon="moon" onClick={() => setTheme("dark")} data-testid="theme-dark">
            Tema escuro
          </Button>
        </div>
      </header>

      <Section title="Sessão e compra">
        <SessionPanel />
      </Section>

      <Section title="Tipografia">
        <div className="col" style={{ "--gap": "8px" } as CSSProperties}>
          <span className="display h1s">Display serif</span>
          <span className="h3">Título h3</span>
          <span className="h4">Título h4</span>
          <p className="lead">Texto de abertura (lead).</p>
          <p>Texto normal com <a className="link" href="#">um link</a>.</p>
          <p className="small muted">Pequeno e suave. <span className="ok">ok</span> · <span className="warn">atenção</span> · <span className="bad">erro</span></p>
        </div>
      </Section>

      <Section title="Botões">
        <div className="row wrapx">
          <Button>Primário</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="ok" icon="check">Ok</Button>
          <Button variant="danger" icon="trash">Apagar</Button>
          <Button loading>Carregando</Button>
          <Button disabled>Desabilitado</Button>
          <Button size="lg" iconRight="arrow-right">Grande</Button>
          <Button size="sm" variant="secondary">Pequeno</Button>
        </div>
      </Section>

      <Section title="Chips, selos e reputação">
        <div className="row wrapx">
          <Chip>Padrão</Chip>
          <Chip tone="ok" icon="shield-check">Garantia</Chip>
          <Chip tone="brand">Novo</Chip>
          <Chip tone="warn">Em análise</Chip>
          <Chip tone="red">Contestada</Chip>
          <Chip tone="plain">Simples</Chip>
          {[97, 92, 85, 70, 40].map((s) => (
            <RepBadge key={s} score={s} />
          ))}
          <Verified />
          <span className="trend up"><Icon name="trend-up" size="s" />+4,2%</span>
          <span className="trend down"><Icon name="trend-down" size="s" />−1,3%</span>
        </div>
      </Section>

      <Section title="Cartões, estrelas e preço">
        <div className="g3">
          <Card>
            <div className="col">
              <div className="row">
                <Tile category="Desenvolvimento" />
                <div className="col grow" style={{ "--gap": "2px" } as CSSProperties}>
                  <span className="h4">Front-end React</span>
                  <span className="small faint">Desenvolvimento</span>
                </div>
              </div>
              <Stars rating={4.7} showValue count={128} />
              <Price usdc={19} rate={rate} round />
            </div>
          </Card>
          <Card flat>
            <div className="col">
              <span className="h4">Cartão plano</span>
              <Price usdc={0.9} rate={rate} size="s" suffix="por uso" inline />
              <Price usdc={24} rate={rate} size="xl" />
            </div>
          </Card>
          <Card href="/dev/kit" pad="s">
            <div className="col">
              <span className="h4">Cartão com link</span>
              <span className="small muted">Passe o mouse.</span>
              <div className="row">
                <Avatar name="Ana Souza" size="s" />
                <Avatar name="Bruno Lima" />
                <Avatar name="Carla" size="l" />
              </div>
            </div>
          </Card>
        </div>
        <div className="row wrapx">
          {["Desenvolvimento", "Design", "Dia a dia", "Escrita", "Negócios", "Categoria nova"].map((c) => (
            <Tile key={c} category={c} size="s" />
          ))}
        </div>
      </Section>

      <Section title="Abas">
        <Tabs
          aria-label="Exemplo"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "lic", label: "Especialistas" },
            { id: "mem", label: "Memórias", count: 3 },
            { id: "hist", label: "Histórico" },
          ]}
        />
        <p className="small muted">Aba ativa: {tab}</p>
      </Section>

      <Section title="Formulário">
        <div className="g2">
          <label className="field">
            <span className="label">Título da tarefa</span>
            <input className="input" placeholder="Ex: landing page da minha loja" />
            <span className="hint">Até 80 caracteres.</span>
          </label>
          <label className="field">
            <span className="label">Descrição</span>
            <textarea className="textarea" placeholder="Conte o que você precisa" />
          </label>
        </div>
      </Section>

      <Section title="Avisos, vazio e carregamento">
        <div className="col">
          <Notice title="Informação">Pix aparece como “em breve” até a fase B.</Notice>
          <Notice tone="ok" title="Tudo certo">A licença já está na sua biblioteca.</Notice>
          <Notice tone="warn" title="Atenção" actions={<Button size="sm" variant="secondary">Receber USDC de teste</Button>}>
            Seu saldo não cobre esta compra.
          </Notice>
          <Notice tone="bad" title="Erro">{txErrorMessage(new Error("Falha de rede")).text}</Notice>
          <div className="row wrapx">
            <Button variant="secondary" onClick={() => toast({ tone: "ok", title: "Compra concluída", text: "A licença foi registrada na rede." })}>Toast ok</Button>
            <Button variant="secondary" onClick={() => toast({ tone: "bad", title: "Não deu para concluir", text: "Tente de novo.", action: { label: "Tentar de novo", onClick: () => {} } })}>Toast erro</Button>
          </div>
          <div className="g2">
            <Empty icon="library" title="Sua biblioteca está vazia" action={<Button href="/">Explorar especialistas</Button>}>
              Os especialistas que você comprar aparecem aqui, prontos para usar no Claude ou no ChatGPT.
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

      <Section title="Formatação (lib/format)">
        <ul className="col small mono" style={{ "--gap": "4px" } as CSSProperties}>
          <li>ago(3 dias atrás) = {ago(new Date(Date.now() - 3 * 86400_000).toISOString())}</li>
          <li>date(hoje) = {date(new Date().toISOString())}</li>
          <li>countdown(+5h12) = {countdown(soon).text} · urgente: {String(countdown(soon).urgent)}</li>
          <li>repLevel(91) = {repLevel(91).label}</li>
          <li>short(carteira) = {short("J4riUZWJELvMbYwcXuQ3iDHcF6LaFFEmSXDLH618AGy4")}</li>
        </ul>
      </Section>

      <Section title={`Ícones (${Object.keys(ICONS).length})`}>
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
