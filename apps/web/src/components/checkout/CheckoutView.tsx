"use client";
// Checkout: licença permanente ou tarefa com garantia (design: checkout-licenca e checkout-com-garantia).
// Entrar → (garantia: descrever a tarefa) → forma de pagamento (saldo em USDC ou Pix) → revisar e pagar.
import type { AgentDetail, GuaranteeStatus, PixCharge, SodaxQuote } from "@solvers/api-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SwitchAccount } from "@/components/layout/SwitchAccount";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Tile } from "@/components/ui/Tile";
import { Notice, useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api";
import { brl, durationText, GUARANTEE_LEVEL_LABEL, initials, short, usdc } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { txErrorMessage, useFaucet, useTx, type TxErrorInfo } from "@/lib/tx";
import { PixPanel } from "./PixPanel";
import { SodaxPanel } from "./SodaxPanel";
import { SodaxQuoteCard } from "./SodaxQuote";
import s from "./checkout.module.css";
import type { CheckoutType } from "./util";

type PayMethod = "wallet" | "pix" | "sodax";

const TITLE_MIN = 3;
const TITLE_MAX = 120;
const DESC_MIN = 10;
const DESC_MAX = 4000;
/** Prazo de entrega da garantia, em dias (o servidor assume 14 se não vier). */
const DELIVERY_OPTIONS = [7, 14, 30, 60];

function StepDot({ n, done }: { n: number; done?: boolean }) {
  return <span className={`dot ${done ? "dot-ok" : "dot-now"}`}>{done ? "✓" : n}</span>;
}

export function CheckoutView({ detail, type }: { detail: AgentDetail; type: CheckoutType }) {
  const router = useRouter();
  const toast = useToast();
  const { api, config, status, me, walletKind, loggingIn, login, requireWallet } = useSession();
  // O preço pode mudar enquanto a pessoa está aqui (409 price_changed): guardamos a versão relida do especialista.
  const [fresh, setFresh] = useState<AgentDetail | null>(null);
  const cur = fresh ?? detail;
  const { agent, creator, guarantee } = cur;
  const rate = config?.brlPerUsd ?? null;
  const tx = useTx();
  const faucet = useFaucet();

  const isG = type === "guarantee";
  const total = isG ? (guarantee?.priceUsdc ?? agent.priceUsdc) : agent.priceUsdc;
  const money = (v: number) => (rate != null ? brl(v, rate) : usdc(v));
  const totalText = money(total);

  // ----- dados da conta -----
  const [balance, setBalance] = useState<number | null>(null);
  const [limits, setLimits] = useState<GuaranteeStatus | null>(null);
  const [limitsFailed, setLimitsFailed] = useState(false);
  const [owned, setOwned] = useState(false);
  // Cada carga tem um número: respostas atrasadas (ex: de antes de "Trocar conta") são descartadas.
  const loadSeq = useRef(0);
  const loadAccount = useCallback(async () => {
    const seq = ++loadSeq.current;
    if (!me) return;
    const [b, g, acc] = await Promise.allSettled([api.getBalance(), isG ? api.getMyGuarantee() : Promise.resolve(null), api.getMyAccess(agent.slug)]);
    if (seq !== loadSeq.current) return;
    if (b.status === "fulfilled") setBalance(b.value.usdc);
    if (g.status === "fulfilled") setLimits(g.value);
    setLimitsFailed(isG && g.status === "rejected");
    if (acc.status === "fulfilled") setOwned(!!acc.value.license);
  }, [api, me, isG, agent.slug]);

  useEffect(() => {
    setBalance(null);
    setLimits(null);
    setLimitsFailed(false);
    setOwned(false);
    void loadAccount();
  }, [loadAccount]);

  // ----- forma de pagamento -----
  const pixOn = !!config?.pix.enabled;
  // SODAX (demo): opção para quem já tem cripto em outra rede; só aparece quando o servidor liga. Fica fora do padrão.
  const sodaxCfg = config?.sodax?.enabled ? config.sodax : null;
  const [sodaxPick, setSodaxPick] = useState<string | null>(null);
  const sodaxSource = sodaxPick ?? sodaxCfg?.sources[0]?.key ?? "";
  const [sodaxQuote, setSodaxQuote] = useState<SodaxQuote | null>(null);
  const [method, setMethod] = useState<PayMethod | null>(null);
  const enough = balance != null && balance + 1e-9 >= total;
  const effMethod: PayMethod = method ?? (pixOn && balance != null && !enough ? "pix" : "wallet");

  // ----- tarefa (garantia) -----
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [deliveryDays, setDeliveryDays] = useState(14);
  const [touched, setTouched] = useState(false);
  const titleOk = title.trim().length >= TITLE_MIN && title.trim().length <= TITLE_MAX;
  const descOk = desc.trim().length >= DESC_MIN && desc.trim().length <= DESC_MAX;
  const overLimit = isG && limits != null && limits.availableUsdc + 1e-9 < total;
  // Mesma regra do servidor: no nível limitado, garantias acima de singleMilestoneMaxUsdc precisam de 2 etapas ou mais.
  const singleTooBig =
    isG && limits != null && limits.level === "limited" && (guarantee?.milestones.length ?? 0) < 2 && total > limits.singleMilestoneMaxUsdc;
  // Garantia: só paga (inclusive por Pix) depois de conferir o limite; assim o Pix não cobra uma garantia que seria recusada.
  const limitsOk = !isG || (limits != null && !overLimit && !singleTooBig);

  const [agree, setAgree] = useState(false);

  // ----- Pix -----
  const [charge, setCharge] = useState<PixCharge | null>(null);
  // Carteira que gerou a cobrança: o Pix só vale para ela; trocar de conta fecha o QR.
  const [chargeWallet, setChargeWallet] = useState<string | null>(null);
  const meWallet = me?.wallet ?? null;
  const meWalletRef = useRef(meWallet);
  meWalletRef.current = meWallet;
  const [pixPending, setPixPending] = useState(false);
  const [pixError, setPixError] = useState<TxErrorInfo | null>(null);
  const creditedOnce = useRef<string | null>(null);

  useEffect(() => {
    // Trocar o tipo desfaz a cobrança em andamento (ela foi calculada para outro valor).
    setCharge(null);
    setChargeWallet(null);
    setPixError(null);
    setAgree(false);
    tx.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // Entrou outra conta: o QR aberto era da anterior. Fecha, para ninguém pagar um Pix que credita a carteira errada.
  useEffect(() => {
    if (!charge || !chargeWallet || !meWallet || meWallet === chargeWallet) return;
    setCharge(null);
    setChargeWallet(null);
    setPixError(null);
    creditedOnce.current = null;
    toast({ tone: "info", title: "A cobrança anterior foi fechada", text: "Ela era de outra conta. Gere uma nova para esta." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meWallet, chargeWallet, charge]);

  // Aviso de preço alterado (vem do erro da compra direta ou do Pix). Some sozinho na próxima tentativa, que limpa o erro.
  const priceChange = tx.error?.priceChange ?? pixError?.priceChange ?? null;
  const priceErr = tx.error?.code === "price_changed" || pixError?.code === "price_changed";

  const purchase = useCallback(async () => {
    const r = await tx.run(() =>
      isG ? api.buildEscrow(agent.id, { title: title.trim(), description: desc.trim(), deliveryDays }) : api.buildPurchase(agent.id),
    );
    if (!r) {
      void loadAccount();
      return;
    }
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    const kind = isG ? "escrow" : "purchase";
    const q = new URLSearchParams({ agent: agent.slug, sig: r.signature, kind });
    if (typeof meta.escrowId === "string") q.set("escrow", meta.escrowId);
    if (typeof meta.asset === "string") q.set("asset", meta.asset);
    const paid = typeof meta.priceUsdc === "number" ? meta.priceUsdc : typeof meta.totalUsdc === "number" ? meta.totalUsdc : total;
    q.set("usdc", String(paid));
    if (r.explorerUrl) q.set("explorer", r.explorerUrl);
    router.push(`/checkout/concluido?${q}`);
  }, [tx, isG, api, agent.id, agent.slug, title, desc, deliveryDays, total, router, loadAccount]);

  const chargeWalletRef = useRef(chargeWallet);
  chargeWalletRef.current = chargeWallet;

  useEffect(() => {
    if (!priceErr) return;
    // Mostra já o novo valor, relê o especialista e pede a confirmação de novo (nada é repetido sozinho).
    if (priceChange) setFresh((f) => ({ ...(f ?? detail), agent: { ...(f ?? detail).agent, priceUsdc: priceChange.usdc } }));
    setAgree(false);
    let alive = true;
    api.getAgent(detail.agent.slug).then(
      (d) => alive && setFresh(d),
      () => {},
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.error, pixError]);

  const onCredited = useCallback(
    (c: PixCharge) => {
      if (creditedOnce.current === c.id) return;
      // Resposta atrasada de outra conta: não compra nada nesta.
      if (!chargeWalletRef.current || chargeWalletRef.current !== meWalletRef.current) return;
      creditedOnce.current = c.id;
      void loadAccount();
      void purchase();
    },
    [loadAccount, purchase],
  );

  /** Abre a cobrança (Pix ou SODAX) para a carteira atual; o painel de cada uma segue dali. */
  async function startCharge(create: () => Promise<PixCharge>) {
    setPixPending(true);
    setPixError(null);
    try {
      const w = await requireWallet();
      const c = await create();
      // A conta mudou enquanto a cobrança era criada: não mostra o QR de outra carteira.
      if (meWalletRef.current && meWalletRef.current !== w.address) return;
      setChargeWallet(w.address);
      setCharge(c);
    } catch (e) {
      if (e instanceof ApiError && e.code === "balance_sufficient") {
        // O saldo já cobre: pula o Pix e compra direto.
        setMethod("wallet");
        void loadAccount();
        toast({ tone: "info", title: "Seu saldo já cobre esta compra", text: "Seguimos direto com o saldo em USDC." });
        await purchase();
      } else setPixError(txErrorMessage(e));
    } finally {
      setPixPending(false);
    }
  }

  async function getFaucet() {
    const got = await faucet.receive();
    if (got != null) {
      toast({ tone: "ok", title: `Você recebeu ${usdc(got)} de teste` });
      await loadAccount();
    }
  }

  const alreadyOwned = owned && type === "permanent";
  // SODAX só segue com uma cotação ao vivo na tela: é ela que a pessoa está aceitando.
  const sodaxReady = effMethod !== "sodax" || (!!sodaxCfg && sodaxQuote != null);
  const canPay = !!config && agree && !alreadyOwned && limitsOk && sodaxReady && (!isG || (titleOk && descOk)) && !tx.pending && !pixPending;
  function pay() {
    setTouched(true);
    if (!canPay) return;
    if (effMethod === "pix") void startCharge(() => api.createPixCharge({ agentId: agent.id, type }));
    else if (effMethod === "sodax") void startCharge(() => api.createSodaxCharge({ agentId: agent.id, type, source: sodaxSource }));
    else void purchase();
  }

  const doLogin = () => login().catch((e: unknown) => toast({ tone: "bad", title: "Não deu para entrar", text: (e as Error).message }));
  const switchType = (t: CheckoutType) => router.replace(`/checkout?agent=${encodeURIComponent(agent.slug)}&type=${t}`, { scroll: false });

  const modes: { id: CheckoutType; label: string }[] = [
    { id: "permanent", label: "Licença" },
    ...(guarantee ? [{ id: "guarantee" as const, label: "Com garantia" }] : []),
  ];

  const reviewWin = guarantee ? durationText(guarantee.reviewWindowSecs) : "";
  const lineLabel = isG ? "Tarefa com garantia" : "Licença permanente";
  const agreeText = isG
    ? `Li e concordo com os critérios combinados e com a liberação automática em ${reviewWin}.`
    : "Concordo com os termos de uso e com a emissão da licença em meu nome.";

  let n = 1;
  const stepLogin = n++;
  const stepTask = isG ? n++ : 0;
  const stepPay = n++;
  const stepReview = n++;
  const logged = status === "authed" && !!me;
  const busy = tx.pending || pixPending;
  const showCharge = !!charge;
  const showSodax = charge?.provider === "sodax";
  const restartCharge = () => {
    setCharge(null);
    setChargeWallet(null);
    creditedOnce.current = null;
    tx.reset();
  };

  return (
    <>
      <div className="wrap" style={{ paddingTop: 28 }}>
        <Link className="link-btn" href={`/especialistas/${agent.slug}`}>
          <Icon name="arrow-left" size="s" />
          Voltar para o especialista
        </Link>
      </div>
      <section className="wrap" style={{ paddingTop: 8, paddingBottom: 56 }}>
        <h1 className="display h2" style={{ marginBottom: 28 }}>
          Finalizar compra
        </h1>
        <div className="split">
          <div className="col" style={gap(22)}>
            {/* 1. Entrar */}
            <div className="card pad col" style={gap(18)}>
              <div className="row" style={gap(14)}>
                <StepDot n={stepLogin} done={logged} />
                <h2 className="h3">Entrar</h2>
              </div>
              {status === "loading" ? (
                <div className="skel-box" style={{ height: 72 }} aria-hidden />
              ) : logged && me ? (
                <div className="row wrapx card-flat pad-s" style={gap(14)}>
                  <span className="av">{me.displayName ? initials(me.displayName) : me.wallet.slice(0, 2).toUpperCase()}</span>
                  <div className={`grow ${s.idLine}`}>
                    <b>{me.displayName ?? `Carteira ${short(me.wallet)}`}</b>
                    <div className="small muted">{me.email ?? (me.displayName ? `Carteira ${short(me.wallet)}` : "Conectada")}</div>
                  </div>
                  <div className="col" style={gap(4, { alignItems: "flex-end" })}>
                    <SwitchAccount disabled={busy || showCharge} />
                    {showCharge ? <span className="tiny faint">Cancele o pagamento para trocar de conta.</span> : null}
                  </div>
                </div>
              ) : walletKind === "privy" ? (
                <PrivyLogin loading={loggingIn} onLogin={doLogin} />
              ) : (
                <div className="col" style={gap(14)}>
                  <p className="muted">Entre para receber a licença na sua carteira. Nesta versão de teste, o navegador cria uma carteira de desenvolvimento para você.</p>
                  <div>
                    <Button size="lg" icon="wallet" loading={loggingIn} onClick={doLogin}>
                      Entrar
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {alreadyOwned ? (
              <Notice
                tone="ok"
                title="Você já tem este especialista"
                actions={
                  <>
                    <Button size="sm" href={`/instalar?agent=${agent.slug}`}>
                      Conectar à minha IA
                    </Button>
                    <Button size="sm" variant="secondary" href="/biblioteca">
                      Ver minha biblioteca
                    </Button>
                  </>
                }
              >
                A licença permanente já está na sua conta. Não é preciso comprar de novo.
              </Notice>
            ) : null}

            {/* 2. Garantia: tarefa e critérios */}
            {isG && guarantee ? (
              <>
                <div className="card pad col" style={gap(20)}>
                  <div className="row" style={gap(14)}>
                    <StepDot n={stepTask} done={titleOk && descOk} />
                    <h2 className="h3">Descreva a tarefa e os critérios</h2>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="tarefa-titulo">
                      Título da tarefa
                    </label>
                    <input
                      id="tarefa-titulo"
                      className="input"
                      value={title}
                      maxLength={TITLE_MAX}
                      placeholder="Ex: Formulário de login acessível"
                      onChange={(e) => setTitle(e.target.value)}
                      aria-invalid={touched && !titleOk}
                      aria-describedby="tarefa-titulo-ajuda"
                      disabled={busy || showCharge}
                    />
                    <span id="tarefa-titulo-ajuda" className={`tiny ${touched && !titleOk ? "warn" : "faint"}`}>
                      De {TITLE_MIN} a {TITLE_MAX} caracteres.
                    </span>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="tarefa">
                      O que você quer receber
                    </label>
                    <textarea
                      id="tarefa"
                      className="textarea"
                      value={desc}
                      maxLength={DESC_MAX}
                      placeholder="Conte o que o componente precisa fazer, para quem é e qualquer detalhe que importe."
                      onChange={(e) => setDesc(e.target.value)}
                      aria-invalid={touched && !descOk}
                      aria-describedby="tarefa-ajuda"
                      disabled={busy || showCharge}
                    />
                    <span id="tarefa-ajuda" className={`tiny num ${s.counter} ${touched && !descOk ? "warn" : "faint"}`}>
                      {desc.trim().length < DESC_MIN ? `Mínimo de ${DESC_MIN} caracteres · ` : ""}
                      {desc.length}/{DESC_MAX}
                    </span>
                  </div>
                  <div className="field">
                    <span className="label" id="tarefa-prazo">
                      Prazo de entrega
                    </span>
                    <div className="seg" role="radiogroup" aria-labelledby="tarefa-prazo" style={{ alignSelf: "flex-start" }}>
                      {DELIVERY_OPTIONS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          role="radio"
                          aria-checked={deliveryDays === d}
                          className={deliveryDays === d ? "on" : undefined}
                          onClick={() => setDeliveryDays(d)}
                          disabled={busy || showCharge}
                        >
                          {d} dias
                        </button>
                      ))}
                    </div>
                    <span className="tiny faint">
                      Se o especialista não entregar dentro do prazo, você pode cancelar a etapa e receber o valor dela de volta, sem taxa.
                    </span>
                  </div>
                  <div className="col" style={gap(12)}>
                    <span className="label">Critérios combinados, etapa por etapa</span>
                    {guarantee.milestones.map((ms, i) => (
                      <div key={ms.title} className="row start card-flat pad-s" style={gap(12)}>
                        <span className="dot" style={{ width: 28, height: 28 }}>
                          {i + 1}
                        </span>
                        <div className="grow col" style={{ ...gap(6), minWidth: 0 }}>
                          <div className="row between start wrapx" style={gap(8)}>
                            <div className="row wrapx" style={gap(8)}>
                              <b>{ms.title}</b>
                              {ms.verify === "manual" ? (
                                <Chip tone="brand" icon="eye">
                                  Revisão manual
                                </Chip>
                              ) : (
                                <Chip tone="ok" icon="check-circle">
                                  Verificada por testes
                                </Chip>
                              )}
                            </div>
                            <span className={s.msAmount}>
                              <b className="num">{money(ms.amountUsdc)}</b> <span className="tiny faint num">· {usdc(ms.amountUsdc)}</span>
                            </span>
                          </div>
                          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                            {ms.criteria.map((c) => (
                              <li key={c}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}
                    <p className="tiny faint">As etapas e os critérios são definidos pelo criador do especialista e valem para toda tarefa com garantia.</p>
                  </div>
                </div>

                <div className="card pad col" style={{ ...gap(20), borderColor: "color-mix(in oklab,var(--mint) 35%,var(--line))" }}>
                  <div className="row" style={gap(12)}>
                    <span className="ok">
                      <Icon name="shield-check" size="l" />
                    </span>
                    <h2 className="h3">Como a garantia funciona</h2>
                  </div>
                  <p className="muted" style={{ maxWidth: 640 }}>
                    Seu pagamento fica guardado e só é liberado para o criador quando o resultado passa nos critérios combinados acima. Assim você só paga por resultado.
                  </p>
                  <div className="steps">
                    <GStep icon="lock" title="1. Você paga e o valor fica guardado">
                      O dinheiro ainda não vai para o criador. Ele fica protegido até o fim da tarefa.
                    </GStep>
                    <GStep icon="layers" title="2. O especialista entrega por etapas">
                      Cada etapa é conferida contra os critérios que você viu. As de revisão manual, como o plano, você mesmo confere.
                    </GStep>
                    <GStep icon="eye" title="3. Você confere uma prévia">
                      A prévia vem com marca d&apos;água. A versão final só é liberada depois da sua aprovação.
                    </GStep>
                    <GStep icon="check" title="4. Aprovou? O pagamento é liberado. Não passou? Você contesta.">
                      Ao contestar, você aponta qual critério falhou. Se a contestação for procedente, o valor volta para você. Sem resposta em {reviewWin}, a aprovação é automática.
                    </GStep>
                  </div>
                  <GuaranteeLevelInfo limits={limits} logged={logged} totalUsdc={total} />
                  {singleTooBig && limits ? (
                    <Notice tone="warn" title="Esta garantia precisa de pelo menos 2 etapas">
                      Contas no nível limitado só abrem garantias de uma etapa até {usdc(limits.singleMilestoneMaxUsdc)}, e esta custa {usdc(total)}. Faça mais compras para chegar ao nível completo.
                    </Notice>
                  ) : null}
                  {logged && limitsFailed ? (
                    <Notice
                      tone="bad"
                      role="alert"
                      title="Não deu para conferir seu limite de garantias"
                      actions={
                        <Button size="sm" variant="secondary" icon="refresh" onClick={() => void loadAccount()}>
                          Tentar de novo
                        </Button>
                      }
                    >
                      O pagamento fica liberado assim que o limite for conferido.
                    </Notice>
                  ) : null}
                </div>
              </>
            ) : null}

            {/* Forma de pagamento */}
            <div className="card pad col" style={gap(18)}>
              <div className="row" style={gap(14)}>
                <StepDot n={stepPay} done={showCharge && charge?.status === "credited"} />
                <h2 className="h3">Como você quer pagar</h2>
              </div>
              {pixOn ? (
                <button type="button" className={`opt ${effMethod === "pix" ? "on" : ""}`} onClick={() => setMethod("pix")} aria-pressed={effMethod === "pix"} disabled={busy || showCharge}>
                  <span className="dot-r" />
                  <span className="col grow" style={gap(2)}>
                    <span className="row wrapx" style={gap(8)}>
                      <b>Pix</b>
                      {config?.pix.provider === "simulated" || config?.cluster !== "mainnet-beta" ? <Chip tone="warn">Teste</Chip> : null}
                    </span>
                    <span className="small muted">Você paga em reais e nós convertemos para USDC automaticamente.</span>
                  </span>
                </button>
              ) : (
                <div className="opt" aria-disabled style={{ opacity: 0.6 }}>
                  <span className="dot-r" />
                  <span className="col" style={gap(2)}>
                    <b>Pix (em breve)</b>
                    <span className="small muted">Em breve você poderá pagar em reais.</span>
                  </span>
                </div>
              )}
              <button type="button" className={`opt ${effMethod === "wallet" ? "on" : ""}`} onClick={() => setMethod("wallet")} aria-pressed={effMethod === "wallet"} disabled={busy || showCharge}>
                <span className="dot-r" />
                <span className="col grow" style={gap(2)}>
                  <b>Saldo em USDC</b>
                  <span className="small muted">Use o saldo da sua carteira, se você já tiver.</span>
                  {logged && balance != null ? (
                    <span className="small num" style={{ marginTop: 4 }}>
                      Seu saldo: <b>{usdc(balance)}</b>
                      {rate != null ? <span className="muted"> ({brl(balance, rate)})</span> : null}
                    </span>
                  ) : null}
                </span>
              </button>
              {sodaxCfg ? (
                <>
                  <button type="button" className={`opt ${effMethod === "sodax" ? "on" : ""}`} onClick={() => setMethod("sodax")} aria-pressed={effMethod === "sodax"} disabled={busy || showCharge}>
                    <span className="dot-r" />
                    <span className="col grow" style={gap(2)}>
                      <span className="row wrapx" style={gap(8)}>
                        <b>SODAX</b>
                        <Chip tone="warn">Teste</Chip>
                      </span>
                      <span className="small muted">Para quem já tem cripto em outra rede (como Ethereum, Base ou Arbitrum). Você vê a cotação e o valor chega aqui em USDC.</span>
                    </span>
                  </button>
                  {effMethod === "sodax" && !showCharge ? (
                    <SodaxQuoteCard
                      agentId={agent.id}
                      type={type}
                      sources={sodaxCfg.sources}
                      source={sodaxSource}
                      onSource={setSodaxPick}
                      onQuote={setSodaxQuote}
                      disabled={busy}
                    />
                  ) : null}
                </>
              ) : null}
              {logged && effMethod === "wallet" && balance != null && !enough ? (
                <Notice
                  tone="warn"
                  title="Saldo de USDC insuficiente"
                  actions={
                    <>
                      {faucet.enabled ? (
                        <Button size="sm" icon="coin" loading={faucet.pending} onClick={getFaucet}>
                          Receber {faucet.amountUsdc != null ? usdc(faucet.amountUsdc) : "USDC"} de teste
                        </Button>
                      ) : null}
                      {pixOn ? (
                        <Button size="sm" variant="secondary" onClick={() => setMethod("pix")}>
                          Pagar com Pix
                        </Button>
                      ) : null}
                    </>
                  }
                >
                  Você tem {usdc(balance)} e esta compra custa {usdc(total)}.
                </Notice>
              ) : null}
              {faucet.error ? (
                <Notice tone="bad" role="alert" title={faucet.error.title}>
                  {faucet.error.text}
                </Notice>
              ) : null}
            </div>

            {/* Revisar e pagar */}
            <div className="card pad col" style={gap(16)}>
              <div className="row" style={gap(14)}>
                <StepDot n={stepReview} />
                <h2 className="h3">{showSodax ? "Pague com SODAX" : showCharge ? "Pague com Pix" : "Revisar e pagar"}</h2>
              </div>
              {showCharge && charge ? (
                showSodax ? (
                  <SodaxPanel charge={charge} quote={sodaxQuote} ownerWallet={chargeWallet ?? ""} onUpdate={setCharge} onCredited={onCredited} onRestart={restartCharge} />
                ) : (
                  <PixPanel charge={charge} ownerWallet={chargeWallet ?? ""} totalUsdc={total} onUpdate={setCharge} onCredited={onCredited} onRestart={restartCharge} />
                )
              ) : (
                <>
                  <button
                    type="button"
                    className="row start"
                    onClick={() => setAgree((v) => !v)}
                    style={{ ...gap(12), background: "none", border: 0, textAlign: "left", padding: 0, minHeight: 44, color: "inherit" }}
                    role="checkbox"
                    aria-checked={agree}
                    disabled={busy}
                  >
                    <span className={`check ${agree ? "on" : ""}`}>
                      <Icon name="check" size="s" />
                    </span>
                    <span className="small grow">{agreeText}</span>
                  </button>
                  {touched && isG && (!titleOk || !descOk) ? (
                    <p className="small warn" role="alert">
                      Dê um título e descreva o que você quer receber (mínimo de {DESC_MIN} caracteres).
                    </p>
                  ) : null}
                  <Button size="lg" block iconRight="arrow-right" loading={busy} disabled={!canPay} className={canPay ? "" : "off"} onClick={pay}>
                    Pagar {totalText}
                  </Button>
                  <p className="tiny faint center">
                    <Icon name="lock" size="s" /> Pagamento protegido.{" "}
                    {isG ? "O valor fica guardado até você aprovar cada etapa." : "Você recebe a licença assim que ele for confirmado."}
                  </p>
                </>
              )}
              {priceErr ? (
                <Notice
                  tone="warn"
                  role="alert"
                  title="O preço do especialista mudou"
                  actions={
                    // Pix já pago e creditado: a compra só segue quando a pessoa confirma o novo valor.
                    showCharge && charge?.status === "credited" ? (
                      <Button size="sm" loading={tx.pending} onClick={() => void purchase()}>
                        Confirmar e pagar {totalText}
                      </Button>
                    ) : null
                  }
                >
                  {priceChange
                    ? `O preço do especialista mudou de ${money(priceChange.previousUsdc)} para ${money(priceChange.usdc)}. Confira o novo valor e confirme de novo.`
                    : "O preço do especialista mudou. Confira o novo valor e confirme de novo."}
                </Notice>
              ) : null}
              {pixError && pixError.code !== "price_changed" ? (
                <Notice tone="bad" role="alert" title={pixError.title}>
                  {pixError.text}
                </Notice>
              ) : null}
              <p className={tx.pending ? "small muted center" : "sr-only"} role="status" aria-live="polite">
                {tx.pending ? "Assinando e registrando a compra na rede…" : ""}
              </p>
              {tx.error && tx.error.code !== "price_changed" ? (
                <Notice
                  tone="bad"
                  role="alert"
                  title={tx.error.title}
                  actions={
                    tx.error.action === "faucet" && faucet.enabled ? (
                      <Button size="sm" icon="coin" loading={faucet.pending} onClick={getFaucet}>
                        Receber USDC de teste
                      </Button>
                    ) : tx.error.action === "login" ? (
                      <Button size="sm" onClick={doLogin}>
                        Entrar de novo
                      </Button>
                    ) : tx.error.action === "retry" || (showCharge && charge?.status === "credited") ? (
                      <Button size="sm" icon="refresh" onClick={() => void purchase()}>
                        Tentar de novo
                      </Button>
                    ) : null
                  }
                >
                  {tx.error.text}
                </Notice>
              ) : null}
            </div>
          </div>

          {/* Resumo */}
          <aside className="sticky">
            <div className="card pad col" style={gap(18)}>
              {modes.length > 1 ? (
                <div className="seg" role="tablist" aria-label="Tipo de compra" style={{ alignSelf: "stretch", display: "flex" }}>
                  {modes.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="tab"
                      aria-selected={m.id === type}
                      className={m.id === type ? "on" : undefined}
                      style={{ flex: 1, justifyContent: "center", whiteSpace: "nowrap", paddingInline: 10 }}
                      onClick={() => switchType(m.id)}
                      disabled={busy || showCharge}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="row" style={gap(14)}>
                <Tile category={agent.category} />
                <div className="grow">
                  <b style={{ fontSize: 17 }}>{agent.name}</b>
                  <div className="small muted trunc">por {creator.name}</div>
                </div>
              </div>
              <div className="divider" />
              <div className="col small" style={gap(10)}>
                <div className="row between" style={gap(12)}>
                  <span className="muted grow">{lineLabel}</span>
                  <b className="num flex-none">{totalText}</b>
                </div>
                <div className="row between">
                  <span className="muted">Taxa de rede</span>
                  <b className="num ok">Por conta do Solvers</b>
                </div>
              </div>
              <div className="divider" />
              <div className="col" style={gap(2)}>
                <div className="row between" style={{ alignItems: "baseline" }}>
                  <span className="bold">Total</span>
                  <span className="display num" style={{ fontSize: 44 }}>
                    {totalText}
                  </span>
                </div>
                <div className="row between small">
                  <span className="muted">Preço em USDC</span>
                  <b className="num">{usdc(total)}</b>
                </div>
                {rate != null ? (
                  <div className="tiny faint" style={{ marginTop: 6 }}>
                    Valor em reais pela cotação de referência. 1 USDC = R$ {rate.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.
                  </div>
                ) : null}
              </div>
              <div>
              {isG ? (
                <Chip tone="ok" icon="lock">
                  O valor fica guardado até você aprovar
                </Chip>
              ) : (
                <Chip tone="ok" icon="shield-check">
                  Licença registrada em seu nome
                </Chip>
              )}
              </div>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}

function GStep({ icon, title, children }: { icon: "lock" | "layers" | "eye" | "check"; title: string; children: ReactNode }) {
  return (
    <div className="step">
      <span className="dot dot-ok">
        <Icon name={icon} />
      </span>
      <div>
        <b>{title}</b>
        <p className="small muted">{children}</p>
      </div>
    </div>
  );
}

function GuaranteeLevelInfo({ limits, logged, totalUsdc }: { limits: GuaranteeStatus | null; logged: boolean; totalUsdc: number }) {
  const { config } = useSession();
  const L = config?.guaranteeLimitsUsdc;
  if (!logged || !limits)
    return (
      <div className="row card-flat pad-s" style={gap(12)}>
        <Icon name="info" />
        <span className="small grow">
          {L ? (
            <>
              Contas novas podem ter até <b>{usdc(L.limited)}</b> em garantias abertas. O nível completo vai até <b>{usdc(L.full)}</b> e sobe conforme você compra e conclui tarefas sem disputas.
            </>
          ) : (
            "Seu limite de garantias sobe conforme você compra e conclui tarefas sem disputas."
          )}
        </span>
      </div>
    );
  if (limits.availableUsdc + 1e-9 < totalUsdc)
    return (
      <Notice tone="warn" title="Esta tarefa passa do seu limite de garantias">
        Seu nível é <b>{GUARANTEE_LEVEL_LABEL[limits.level].toLowerCase()}</b>: até {usdc(limits.limitUsdc)} em garantias abertas, e você já tem {usdc(limits.openUsdc)} em andamento. Cabem mais {usdc(Math.max(0, limits.availableUsdc))} e esta tarefa custa {usdc(totalUsdc)}.
        {limits.purchasesToFull > 0 && L
          ? ` Faltam ${limits.purchasesToFull} ${limits.purchasesToFull === 1 ? "compra" : "compras"} para o nível completo (até ${usdc(L.full)}).`
          : limits.disputesLost > limits.maxDisputesLost
            ? " O limite fica reduzido por causa de disputas perdidas."
            : " Espere uma tarefa em andamento terminar para abrir outra."}
      </Notice>
    );
  return (
    <div className="row card-flat pad-s" style={gap(12)}>
      <Icon name="info" />
      <span className="small grow">
        Seu nível de garantia é <b>{GUARANTEE_LEVEL_LABEL[limits.level].toLowerCase()}</b>: até <b>{usdc(limits.limitUsdc)}</b> em garantias abertas (cabem mais {usdc(limits.availableUsdc)}). Ele sobe conforme você compra e conclui tarefas sem disputas.
        {limits.purchasesToFull > 0 ? ` Faltam ${limits.purchasesToFull} ${limits.purchasesToFull === 1 ? "compra" : "compras"} para o nível completo.` : ""}
      </span>
    </div>
  );
}

function PrivyLogin({ loading, onLogin }: { loading: boolean; onLogin: () => void }) {
  // Só e-mail por enquanto: carteira externa (Phantom etc.) fica para depois.
  return (
    <div className="col" style={gap(14)}>
      <div>
        <Button size="lg" icon="mail" loading={loading} onClick={onLogin}>
          Continuar com e-mail
        </Button>
      </div>
      <p className="small muted">Enviamos um código de acesso. Sem carteira? Criamos uma para você automaticamente, e você pode exportá-la depois.</p>
    </div>
  );
}
