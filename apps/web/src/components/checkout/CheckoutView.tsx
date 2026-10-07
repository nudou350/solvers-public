"use client";
// Checkout: licença permanente ou tarefa com garantia (design: checkout-licenca e checkout-com-garantia).
// Entrar → (garantia: descrever a tarefa) → forma de pagamento (saldo em USDC ou Pix) → revisar e pagar.
// Com `listing` é a compra de uma licença usada do mercado de revenda (/checkout?listing=<licença>): só saldo em USDC.
import type { AgentDetail, GuaranteeStatus, PixCharge, ResaleListing, SodaxQuote } from "@solvers/api-client";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { Link, useRouter } from "@/i18n/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SwitchAccount } from "@/components/layout/SwitchAccount";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Tile } from "@/components/ui/Tile";
import { Notice, useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api";
import { useErrorText } from "@/lib/error-text";
import { initials, short, useFormat } from "@/lib/format";
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

export function CheckoutView({ detail, type, listing = null }: { detail: AgentDetail; type: CheckoutType; listing?: ResaleListing | null }) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("checkout.view");
  const f = useFormat();
  const errorText = useErrorText();
  const { api, config, status, me, walletKind, loggingIn, login, requireWallet } = useSession();
  const lang = useLocale() as Locale;
  // O preço pode mudar enquanto a pessoa está aqui (409 price_changed): guardamos a versão relida do especialista.
  const [fresh, setFresh] = useState<AgentDetail | null>(null);
  const cur = fresh ?? detail;
  const { agent, creator, guarantee } = cur;
  const rate = config?.brlPerUsd ?? null;
  const tx = useTx();
  const faucet = useFaucet();

  const isG = type === "guarantee";
  // Licença usada: o preço é o do anúncio (muda com 409 listing_changed) e o anúncio pode sumir (listing_not_found).
  const isR = !!listing;
  const [listingPrice, setListingPrice] = useState(listing?.priceUsdc ?? 0);
  const [listingGone, setListingGone] = useState(false);
  const total = isR ? listingPrice : isG ? (guarantee?.priceUsdc ?? agent.priceUsdc) : agent.priceUsdc;
  // Em inglês o preço local é o dólar (1:1 com o USDC); em português, reais pela cotação.
  const money = (v: number) => (f.locale === "en" ? f.brl(v, 1) : rate != null ? f.brl(v, rate) : f.usdc(v));
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
  const pixOn = !isR && !!config?.pix.enabled;
  // SODAX (demo): opção para quem já tem cripto em outra rede; só aparece quando o servidor liga. Fica fora do padrão.
  const sodaxCfg = !isR && config?.sodax?.enabled ? config.sodax : null;
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
    toast({ tone: "info", title: t("toast.chargeClosed.title"), text: t("toast.chargeClosed.text") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meWallet, chargeWallet, charge]);

  // Aviso de preço alterado (vem do erro da compra direta ou do Pix). Some sozinho na próxima tentativa, que limpa o erro.
  const priceChange = tx.error?.priceChange ?? pixError?.priceChange ?? null;
  const priceErr = tx.error?.code === "price_changed" || pixError?.code === "price_changed";

  const purchase = useCallback(async () => {
    const r = await tx.run(() =>
      listing
        ? api.buildBuyListing(listing.id, listingPrice)
        : isG
          ? api.buildEscrow(agent.id, { title: title.trim(), description: desc.trim(), deliveryDays })
          : api.buildPurchase(agent.id),
    );
    if (!r) {
      void loadAccount();
      return;
    }
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    const kind = isG ? "escrow" : "purchase";
    const q = new URLSearchParams({ agent: agent.slug, sig: r.signature, kind });
    if (typeof meta.escrowId === "string") q.set("escrow", meta.escrowId);
    if (listing) q.set("resale", "1");
    if (typeof meta.asset === "string") q.set("asset", meta.asset);
    else if (listing) q.set("asset", listing.id);
    const paid = typeof meta.priceUsdc === "number" ? meta.priceUsdc : typeof meta.totalUsdc === "number" ? meta.totalUsdc : total;
    q.set("usdc", String(paid));
    if (r.explorerUrl) q.set("explorer", r.explorerUrl);
    router.push(`/checkout/done?${q}`);
  }, [tx, isG, listing, listingPrice, api, agent.id, agent.slug, title, desc, deliveryDays, total, router, loadAccount]);

  const chargeWalletRef = useRef(chargeWallet);
  chargeWalletRef.current = chargeWallet;

  useEffect(() => {
    if (!priceErr) return;
    // Mostra já o novo valor, relê o especialista e pede a confirmação de novo (nada é repetido sozinho).
    if (priceChange) setFresh((f) => ({ ...(f ?? detail), agent: { ...(f ?? detail).agent, priceUsdc: priceChange.usdc } }));
    setAgree(false);
    let alive = true;
    api.getAgent(detail.agent.slug, lang).then(
      (d) => alive && setFresh(d),
      () => {},
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.error, pixError]);

  // Vagas esgotadas durante a compra: relê o especialista para a tela mostrar "Esgotado" já.
  useEffect(() => {
    if (tx.error?.code !== "sold_out" && pixError?.code !== "sold_out") return;
    let alive = true;
    api.getAgent(detail.agent.slug, lang).then(
      (d) => alive && setFresh(d),
      () => {},
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.error, pixError]);

  // Licença usada: o preço do anúncio mudou ou ele sumiu. Mostra o valor novo, zera o aceite e pede a confirmação de novo.
  useEffect(() => {
    if (!listing) return;
    const code = tx.error?.code;
    if (code === "listing_not_found") {
      setListingGone(true);
      return;
    }
    if (code !== "listing_changed") return;
    setAgree(false);
    // O 409 já traz o preço atual do anúncio; sem ele, relê a lista.
    if (tx.error?.listingPriceUsdc != null) {
      setListingPrice(tx.error.listingPriceUsdc);
      return;
    }
    let alive = true;
    api.getResaleListing(listing.id, lang).then(
      (now) => {
        if (!alive) return;
        if (now) setListingPrice(now.priceUsdc);
        else setListingGone(true);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.error]);

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
        toast({ tone: "info", title: t("toast.balanceCovers.title"), text: t("toast.balanceCovers.text") });
        await purchase();
      } else setPixError(txErrorMessage(e, f.locale));
    } finally {
      setPixPending(false);
    }
  }

  async function getFaucet() {
    const got = await faucet.receive();
    if (got != null) {
      toast({ tone: "ok", title: t("toast.faucetGot", { amount: f.usdc(got) }) });
      await loadAccount();
    }
  }

  const alreadyOwned = owned && type === "permanent";
  // Teto de licenças: sem vagas, a licença nova não pode ser comprada (a revenda é outro caminho). Garantia não ocupa vaga.
  const soldOut = !isR && type === "permanent" && !alreadyOwned && (agent.supply?.left === 0 || tx.error?.code === "sold_out" || pixError?.code === "sold_out");
  // Pix/SODAX já pagos e creditados: o valor virou saldo em USDC na carteira e continua lá.
  const paidBeforeSoldOut = soldOut && charge?.status === "credited";
  const myListing = isR && !!meWallet && listing?.sellerWallet === meWallet;
  const listingBlocked = listingGone || myListing;
  // SODAX só segue com uma cotação ao vivo na tela: é ela que a pessoa está aceitando.
  const sodaxReady = effMethod !== "sodax" || (!!sodaxCfg && sodaxQuote != null);
  const canPay = !!config && agree && !alreadyOwned && !soldOut && !listingBlocked && limitsOk && sodaxReady && (!isG || (titleOk && descOk)) && !tx.pending && !pixPending;
  function pay() {
    setTouched(true);
    if (!canPay) return;
    if (effMethod === "pix") void startCharge(() => api.createPixCharge({ agentId: agent.id, type }));
    else if (effMethod === "sodax") void startCharge(() => api.createSodaxCharge({ agentId: agent.id, type, source: sodaxSource }));
    else void purchase();
  }

  const doLogin = () => login().catch((e: unknown) => toast({ tone: "bad", title: t("login.failed"), text: errorText(e) }));
  const switchType = (next: CheckoutType) => router.replace(`/checkout?agent=${encodeURIComponent(agent.slug)}&type=${next}`, { scroll: false });

  const modes: { id: CheckoutType; label: string }[] = [
    { id: "permanent", label: t("summary.license") },
    ...(guarantee ? [{ id: "guarantee" as const, label: t("summary.withGuarantee") }] : []),
  ];

  const reviewWin = guarantee ? f.durationText(guarantee.reviewWindowSecs) : "";
  const lineLabel = isR ? t("summary.usedLicense") : isG ? t("summary.guaranteeTask") : t("summary.permanent");
  const agreeText = isG ? t("review.agreeGuarantee", { window: reviewWin }) : isR ? t("review.agreeUsed") : t("review.agreeNew");

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

  // Opções de pagamento. Em português o Pix vem primeiro; em inglês, USDC e cripto vêm antes do Pix.
  const pixOption = isR ? null : pixOn ? (
    <button type="button" key="pix" className={`opt ${effMethod === "pix" ? "on" : ""}`} onClick={() => setMethod("pix")} aria-pressed={effMethod === "pix"} disabled={busy || showCharge}>
      <span className="dot-r" />
      <span className="col grow" style={gap(2)}>
        <span className="row wrapx" style={gap(8)}>
          <b>{t("pay.pixName")}</b>
          {config?.pix.provider === "simulated" || config?.cluster !== "mainnet-beta" ? <Chip tone="warn">{t("pay.test")}</Chip> : null}
        </span>
        <span className="small muted">{t("pay.pixText")}</span>
      </span>
    </button>
  ) : f.locale === "pt" ? (
    <div className="opt" key="pix" aria-disabled style={{ opacity: 0.6 }}>
      <span className="dot-r" />
      <span className="col" style={gap(2)}>
        <b>{t("pay.pixSoonName")}</b>
        <span className="small muted">{t("pay.pixSoonText")}</span>
      </span>
    </div>
  ) : null;
  const walletOption = (
    <div className="col" key="wallet" style={gap(18)}>
      <button type="button" className={`opt ${effMethod === "wallet" ? "on" : ""}`} onClick={() => setMethod("wallet")} aria-pressed={effMethod === "wallet"} disabled={busy || showCharge}>
        <span className="dot-r" />
        <span className="col grow" style={gap(2)}>
          <b>{t("pay.walletName")}</b>
          <span className="small muted">{t("pay.walletText")}</span>
          {logged && balance != null ? (
            <span className="small num" style={{ marginTop: 4 }}>
              {t("pay.balance")}
              <b>{f.usdc(balance)}</b>
              {rate != null && f.locale === "pt" ? <span className="muted"> ({f.brl(balance, rate)})</span> : null}
            </span>
          ) : null}
        </span>
      </button>
      {isR ? <p className="tiny faint">{t("pay.usedOnly")}</p> : null}
    </div>
  );
  const sodaxOption = sodaxCfg ? (
    <div className="col" key="sodax" style={gap(18)}>
      <button type="button" className={`opt ${effMethod === "sodax" ? "on" : ""}`} onClick={() => setMethod("sodax")} aria-pressed={effMethod === "sodax"} disabled={busy || showCharge}>
        <span className="dot-r" />
        <span className="col grow" style={gap(2)}>
          <span className="row wrapx" style={gap(8)}>
            <b>SODAX</b>
            <Chip tone="warn">{t("pay.test")}</Chip>
          </span>
          <span className="small muted">{t("pay.sodaxText")}</span>
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
    </div>
  ) : null;
  const payOptions = f.locale === "en" ? [walletOption, sodaxOption, pixOption] : [pixOption, walletOption, sodaxOption];

  return (
    <>
      <div className="wrap" style={{ paddingTop: 28 }}>
        <Link className="link-btn" href={isR ? "/resale" : `/solvers/${agent.slug}`}>
          <Icon name="arrow-left" size="s" />
          {isR ? t("back.resale") : t("back.solver")}
        </Link>
      </div>
      <section className="wrap" style={{ paddingTop: 8, paddingBottom: 56 }}>
        <h1 className="display h2" style={{ marginBottom: 28 }}>
          {isR ? t("title.used") : t("title.new")}
        </h1>
        <div className="split">
          <div className="col" style={gap(22)}>
            {/* 1. Entrar */}
            <div className="card pad col" style={gap(18)}>
              <div className="row" style={gap(14)}>
                <StepDot n={stepLogin} done={logged} />
                <h2 className="h3">{t("login.title")}</h2>
              </div>
              {status === "loading" ? (
                <div className="skel-box" style={{ height: 72 }} aria-hidden />
              ) : logged && me ? (
                <div className="row wrapx card-flat pad-s" style={gap(14)}>
                  <span className="av">{me.displayName ? initials(me.displayName) : me.wallet.slice(0, 2).toUpperCase()}</span>
                  <div className={`grow ${s.idLine}`}>
                    <b>{me.displayName ?? t("login.wallet", { wallet: short(me.wallet) })}</b>
                    <div className="small muted">{me.email ?? (me.displayName ? t("login.wallet", { wallet: short(me.wallet) }) : t("login.connected"))}</div>
                  </div>
                  <div className="col" style={gap(4, { alignItems: "flex-end" })}>
                    <SwitchAccount disabled={busy || showCharge} />
                    {showCharge ? <span className="tiny faint">{t("login.cancelToSwitch")}</span> : null}
                  </div>
                </div>
              ) : walletKind === "privy" ? (
                <PrivyLogin loading={loggingIn} onLogin={doLogin} />
              ) : (
                <div className="col" style={gap(14)}>
                  <p className="muted">{t("login.devText")}</p>
                  <div>
                    <Button size="lg" icon="wallet" loading={loggingIn} onClick={doLogin}>
                      {t("login.devButton")}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {alreadyOwned ? (
              <Notice
                tone="ok"
                title={t("owned.title")}
                actions={
                  <>
                    <Button size="sm" href={`/install?agent=${agent.slug}`}>
                      {t("owned.connect")}
                    </Button>
                    <Button size="sm" variant="secondary" href="/library">
                      {t("owned.library")}
                    </Button>
                  </>
                }
              >
                {t("owned.text")}
              </Notice>
            ) : null}

            {soldOut ? (
              <Notice
                tone="warn"
                role="alert"
                title={t("soldOut.title")}
                actions={
                  config?.resaleEnabled ? (
                    <Button size="sm" href="/resale">
                      {t("soldOut.viewUsed")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" href="/solvers">
                      {t("soldOut.viewOthers")}
                    </Button>
                  )
                }
              >
                {paidBeforeSoldOut ? t("soldOut.paid") : t("soldOut.none")}
              </Notice>
            ) : null}

            {listingGone && tx.error?.code !== "listing_not_found" ? (
              <Notice
                tone="warn"
                role="alert"
                title={t("listingGone.title")}
                actions={
                  <Button size="sm" href="/resale">
                    {t("listingGone.viewOthers")}
                  </Button>
                }
              >
                {t("listingGone.text")}
              </Notice>
            ) : null}
            {myListing ? (
              <Notice
                tone="info"
                title={t("myListing.title")}
                actions={
                  <Button size="sm" variant="secondary" href="/library">
                    {t("myListing.library")}
                  </Button>
                }
              >
                {t("myListing.text")}
              </Notice>
            ) : null}

            {/* 2. Garantia: tarefa e critérios */}
            {isG && guarantee ? (
              <>
                <div className="card pad col" style={gap(20)}>
                  <div className="row" style={gap(14)}>
                    <StepDot n={stepTask} done={titleOk && descOk} />
                    <h2 className="h3">{t("task.title")}</h2>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="tarefa-titulo">
                      {t("task.titleLabel")}
                    </label>
                    <input
                      id="tarefa-titulo"
                      className="input"
                      value={title}
                      maxLength={TITLE_MAX}
                      placeholder={t("task.titlePlaceholder")}
                      onChange={(e) => setTitle(e.target.value)}
                      aria-invalid={touched && !titleOk}
                      aria-describedby="tarefa-titulo-ajuda"
                      disabled={busy || showCharge}
                    />
                    <span id="tarefa-titulo-ajuda" className={`tiny ${touched && !titleOk ? "warn" : "faint"}`}>
                      {t("task.titleHelp", { min: TITLE_MIN, max: TITLE_MAX })}
                    </span>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="tarefa">
                      {t("task.descLabel")}
                    </label>
                    <textarea
                      id="tarefa"
                      className="textarea"
                      value={desc}
                      maxLength={DESC_MAX}
                      placeholder={t("task.descPlaceholder")}
                      onChange={(e) => setDesc(e.target.value)}
                      aria-invalid={touched && !descOk}
                      aria-describedby="tarefa-ajuda"
                      disabled={busy || showCharge}
                    />
                    <span id="tarefa-ajuda" className={`tiny num ${s.counter} ${touched && !descOk ? "warn" : "faint"}`}>
                      {desc.trim().length < DESC_MIN ? t("task.descMin", { min: DESC_MIN }) : ""}
                      {desc.length}/{DESC_MAX}
                    </span>
                  </div>
                  <div className="field">
                    <span className="label" id="tarefa-prazo">
                      {t("task.deliveryLabel")}
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
                          {t("task.deliveryDays", { n: d })}
                        </button>
                      ))}
                    </div>
                    <span className="tiny faint">
                      {t("task.deliveryHelp")}
                    </span>
                  </div>
                  <div className="col" style={gap(12)}>
                    <span className="label">{t("task.criteriaLabel")}</span>
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
                                  {t("task.manual")}
                                </Chip>
                              ) : (
                                <Chip tone="ok" icon="check-circle">
                                  {t("task.tested")}
                                </Chip>
                              )}
                            </div>
                            <span className={s.msAmount}>
                              <b className="num">{money(ms.amountUsdc)}</b> <span className="tiny faint num">· {f.usdc(ms.amountUsdc)}</span>
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
                    <p className="tiny faint">{t("task.criteriaNote")}</p>
                  </div>
                </div>

                <div className="card pad col" style={{ ...gap(20), borderColor: "color-mix(in oklab,var(--mint) 35%,var(--line))" }}>
                  <div className="row" style={gap(12)}>
                    <span className="ok">
                      <Icon name="shield-check" size="l" />
                    </span>
                    <h2 className="h3">{t("how.title")}</h2>
                  </div>
                  <p className="muted" style={{ maxWidth: 640 }}>
                    {t("how.intro")}
                  </p>
                  <div className="steps">
                    <GStep icon="lock" title={t("how.s1.title")}>
                      {t("how.s1.text")}
                    </GStep>
                    <GStep icon="layers" title={t("how.s2.title")}>
                      {t("how.s2.text")}
                    </GStep>
                    <GStep icon="eye" title={t("how.s3.title")}>
                      {t("how.s3.text")}
                    </GStep>
                    <GStep icon="check" title={t("how.s4.title")}>
                      {t("how.s4.text", { window: reviewWin })}
                    </GStep>
                  </div>
                  <GuaranteeLevelInfo limits={limits} logged={logged} totalUsdc={total} />
                  {singleTooBig && limits ? (
                    <Notice tone="warn" title={t("singleTooBig.title")}>
                      {t("singleTooBig.text", { max: f.usdc(limits.singleMilestoneMaxUsdc), total: f.usdc(total) })}
                    </Notice>
                  ) : null}
                  {logged && limitsFailed ? (
                    <Notice
                      tone="bad"
                      role="alert"
                      title={t("limitsFailed.title")}
                      actions={
                        <Button size="sm" variant="secondary" icon="refresh" onClick={() => void loadAccount()}>
                          {t("limitsFailed.retry")}
                        </Button>
                      }
                    >
                      {t("limitsFailed.text")}
                    </Notice>
                  ) : null}
                </div>
              </>
            ) : null}

            {/* Forma de pagamento */}
            <div className="card pad col" style={gap(18)}>
              <div className="row" style={gap(14)}>
                <StepDot n={stepPay} done={showCharge && charge?.status === "credited"} />
                <h2 className="h3">{t("pay.title")}</h2>
              </div>
              {payOptions}
              {logged && effMethod === "wallet" && balance != null && !enough ? (
                <Notice
                  tone="warn"
                  title={t("pay.lowTitle")}
                  actions={
                    <>
                      {faucet.enabled ? (
                        <Button size="sm" icon="coin" loading={faucet.pending} onClick={getFaucet}>
                          {t("pay.faucet", { amount: faucet.amountUsdc != null ? f.usdc(faucet.amountUsdc) : t("pay.faucetAnyAmount") })}
                        </Button>
                      ) : null}
                      {pixOn ? (
                        <Button size="sm" variant="secondary" onClick={() => setMethod("pix")}>
                          {t("pay.payWithPix")}
                        </Button>
                      ) : null}
                    </>
                  }
                >
                  {t("pay.lowText", { balance: f.usdc(balance), total: f.usdc(total) })}
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
                <h2 className="h3">{showSodax ? t("review.titleSodax") : showCharge ? t("review.titlePix") : t("review.title")}</h2>
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
                      {t("review.needTask", { min: DESC_MIN })}
                    </p>
                  ) : null}
                  <Button size="lg" block iconRight="arrow-right" loading={busy} disabled={!canPay} className={canPay ? "" : "off"} onClick={pay}>
                    {isR ? t("review.payUsed", { price: totalText }) : t("review.pay", { price: totalText })}
                  </Button>
                  <p className="tiny faint center">
                    <Icon name="lock" size="s" /> {t("review.protected")} {isG ? t("review.protectedGuarantee") : t("review.protectedLicense")}
                  </p>
                </>
              )}
              {priceErr ? (
                <Notice
                  tone="warn"
                  role="alert"
                  title={t("review.priceTitle")}
                  actions={
                    // Pix já pago e creditado: a compra só segue quando a pessoa confirma o novo valor.
                    showCharge && charge?.status === "credited" ? (
                      <Button size="sm" loading={tx.pending} onClick={() => void purchase()}>
                        {t("review.confirmPay", { price: totalText })}
                      </Button>
                    ) : null
                  }
                >
                  {priceChange
                    ? t("review.priceChanged", { from: money(priceChange.previousUsdc), to: money(priceChange.usdc) })
                    : t("review.priceChangedGeneric")}
                </Notice>
              ) : null}
              {tx.error?.code === "listing_changed" ? (
                <Notice tone="warn" role="alert" title={tx.error.title}>
                  {tx.error.listingPriceUsdc != null
                    ? t("review.listingChanged", { price: money(tx.error.listingPriceUsdc), usdc: f.usdc(tx.error.listingPriceUsdc) })
                    : tx.error.text}
                </Notice>
              ) : null}
              {pixError && pixError.code !== "price_changed" && pixError.code !== "sold_out" ? (
                <Notice tone="bad" role="alert" title={pixError.title}>
                  {pixError.text}
                </Notice>
              ) : null}
              <p className={tx.pending ? "small muted center" : "sr-only"} role="status" aria-live="polite">
                {tx.pending ? t("review.signing") : ""}
              </p>
              {tx.error && tx.error.code !== "price_changed" && tx.error.code !== "listing_changed" && tx.error.code !== "sold_out" ? (
                <Notice
                  tone="bad"
                  role="alert"
                  title={tx.error.title}
                  actions={
                    tx.error.code === "listing_not_found" ? (
                      <Button size="sm" href="/resale">
                        {t("review.viewOthers")}
                      </Button>
                    ) : tx.error.action === "faucet" && faucet.enabled ? (
                      <Button size="sm" icon="coin" loading={faucet.pending} onClick={getFaucet}>
                        {t("review.getFaucet")}
                      </Button>
                    ) : tx.error.action === "login" ? (
                      <Button size="sm" onClick={doLogin}>
                        {t("review.loginAgain")}
                      </Button>
                    ) : tx.error.action === "retry" || (showCharge && charge?.status === "credited") ? (
                      <Button size="sm" icon="refresh" onClick={() => void purchase()}>
                        {t("review.retry")}
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
              {!isR && modes.length > 1 ? (
                <div className="seg" role="tablist" aria-label={t("summary.typeLabel")} style={{ alignSelf: "stretch", display: "flex" }}>
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
                  <div className="small muted trunc">{t("summary.by", { creator: creator.name })}</div>
                </div>
              </div>
              <div className="divider" />
              <div className="col small" style={gap(10)}>
                <div className="row between" style={gap(12)}>
                  <span className="muted grow">{lineLabel}</span>
                  <b className="num flex-none">{totalText}</b>
                </div>
                {isR && listing ? (
                  <>
                    <div className="row between" style={gap(12)}>
                      <span className="muted">{t("summary.soldBy")}</span>
                      <b className="num flex-none">{short(listing.sellerWallet)}</b>
                    </div>
                    <div className="row between" style={gap(12)}>
                      <span className="muted">{t("summary.newPrice")}</span>
                      <span className="num flex-none">{money(agent.priceUsdc)}</span>
                    </div>
                  </>
                ) : null}
                <div className="row between">
                  <span className="muted">{t("summary.networkFee")}</span>
                  <b className="num ok">{t("summary.networkFeeValue")}</b>
                </div>
              </div>
              <div className="divider" />
              <div className="col" style={gap(2)}>
                <div className="row between" style={{ alignItems: "baseline" }}>
                  <span className="bold">{t("summary.total")}</span>
                  <span className="display num" style={{ fontSize: 44 }}>
                    {totalText}
                  </span>
                </div>
                <div className="row between small">
                  <span className="muted">{t("summary.usdcPrice")}</span>
                  <b className="num">{f.usdc(total)}</b>
                </div>
                {f.locale === "en" || rate != null ? (
                  <div className="tiny faint" style={{ marginTop: 6 }}>
                    {t("summary.rateNote", { rate: f.num(rate ?? 0, 2) })}
                  </div>
                ) : null}
              </div>
              {isR ? (
                <p className="small muted">{t("summary.usedNote")}</p>
              ) : null}
              <div>
              {isG ? (
                <Chip tone="ok" icon="lock">
                  {t("summary.chipGuarantee")}
                </Chip>
              ) : (
                <Chip tone="ok" icon="shield-check">
                  {t("summary.chipLicense")}
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
  const t = useTranslations("checkout.view.level");
  const f = useFormat();
  const bold = (c: ReactNode) => <b>{c}</b>;
  const L = config?.guaranteeLimitsUsdc;
  if (!logged || !limits)
    return (
      <div className="row card-flat pad-s" style={gap(12)}>
        <Icon name="info" />
        <span className="small grow">{L ? t.rich("newAccounts", { limited: f.usdc(L.limited), full: f.usdc(L.full), b: bold }) : t("generic")}</span>
      </div>
    );
  const level = f.guaranteeLevel(limits.level).toLowerCase();
  if (limits.availableUsdc + 1e-9 < totalUsdc)
    return (
      <Notice tone="warn" title={t("overTitle")}>
        {t.rich("overText", {
          level,
          limit: f.usdc(limits.limitUsdc),
          open: f.usdc(limits.openUsdc),
          available: f.usdc(Math.max(0, limits.availableUsdc)),
          total: f.usdc(totalUsdc),
          b: bold,
        })}
        {limits.purchasesToFull > 0 && L
          ? t("toFullMax", { n: limits.purchasesToFull, full: f.usdc(L.full) })
          : limits.disputesLost > limits.maxDisputesLost
            ? t("reduced")
            : t("wait")}
      </Notice>
    );
  return (
    <div className="row card-flat pad-s" style={gap(12)}>
      <Icon name="info" />
      <span className="small grow">
        {t.rich("info", { level, limit: f.usdc(limits.limitUsdc), available: f.usdc(limits.availableUsdc), b: bold })}
        {limits.purchasesToFull > 0 ? t("toFull", { n: limits.purchasesToFull }) : ""}
      </span>
    </div>
  );
}

function PrivyLogin({ loading, onLogin }: { loading: boolean; onLogin: () => void }) {
  const t = useTranslations("checkout.view.login");
  // Só e-mail por enquanto: carteira externa (Phantom etc.) fica para depois.
  return (
    <div className="col" style={gap(14)}>
      <div>
        <Button size="lg" icon="mail" loading={loading} onClick={onLogin}>
          {t("privyButton")}
        </Button>
      </div>
      <p className="small muted">{t("privyText")}</p>
    </div>
  );
}
