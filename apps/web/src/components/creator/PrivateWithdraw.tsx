"use client";
// Saque privado do criador (Cloak, rede real): move USDC da carteira para outro endereço sem o explorador ligar os dois, e
// gera a "chave do contador" (leitura do histórico). Ver docs/cloak-privacidade.md.
import { planPrivateWithdraw } from "@solvers/shared";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { AuthGate } from "@/components/ui/AuthGate";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Toast";
import { CLOAK_RPC_URL, solscanAccount, solscanTx } from "@/lib/cloak/config";
import { loadHistory, type WithdrawEntry } from "@/lib/cloak/history";
import {
  buildReport,
  deriveKeys,
  friendlyError,
  getMainnetBalances,
  privateWithdraw,
  resumeWithdraw,
  viewingKeyHex,
  type MainnetBalances,
  type WithdrawStep,
} from "@/lib/cloak/withdraw";
import { short, useFormat, type Format } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { CreatorHead } from "./CreatorHead";

const STEPS: WithdrawStep[] = ["keys", "deposit", "withdraw", "done"];

/** Valores em unidades base (USDC com 6 casas, SOL com 9), no formato do idioma da página. */
const usdcText = (f: Format, v: bigint) => `${f.num(Number(v) / 1e6, 2, 6)} USDC`;
const solText = (f: Format, v: bigint) => `${f.num(Number(v) / 1e9, 4)} SOL`;

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Painel do saque privado (/creator/private-withdraw). Exige login; fala com a rede real por conta própria. */
export function PrivateWithdrawView() {
  const t = useTranslations("creator.cloak");
  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <CreatorHead tab="private" title={t("title")} />
      <AuthGate icon="lock" title={t("gateTitle")} text={t("gateText")}>
        <Panel />
      </AuthGate>
    </section>
  );
}

function Panel() {
  const t = useTranslations("creator.cloak");
  const f = useFormat();
  const usdc = (v: bigint) => usdcText(f, v);
  const friendly = (e: unknown) => friendlyError(e, (k) => t(`errors.${k}`));
  const { wallet, me, requireWallet } = useSession();
  const address = me?.wallet ?? "";
  const [balances, setBalances] = useState<MainnetBalances | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [step, setStep] = useState<WithdrawStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<WithdrawEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  // Tradutor por ref: muda a cada render e não deve refazer a leitura dos saldos.
  const friendlyErrorRef = useRef(friendly);
  friendlyErrorRef.current = friendly;

  const refreshHistory = useCallback(() => setHistory(address ? loadHistory(address) : []), [address]);
  const refreshBalances = useCallback(async () => {
    if (!address) return;
    setBalanceError(null);
    try {
      setBalances(await getMainnetBalances(address));
    } catch (e) {
      setBalances(null);
      setBalanceError(friendlyErrorRef.current(e));
    }
  }, [address]);

  useEffect(() => {
    refreshHistory();
    void refreshBalances();
  }, [refreshHistory, refreshBalances]);

  const plan = useMemo(() => planPrivateWithdraw({ amount, destination, ownAddress: address, balances }), [amount, destination, address, balances]);
  const busy = step !== null && step !== "done";
  const typed = amount.trim() !== "" || destination.trim() !== "";

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } catch {
      setError(t("copyFail"));
    }
  }

  async function submit() {
    if (!plan.ok || busy) return;
    setError(null);
    setStep("keys");
    try {
      const w = wallet ?? (await requireWallet());
      await privateWithdraw({ wallet: w, amount: plan.amount, destination: plan.destination, hooks: { onStep: setStep } });
      setAmount("");
    } catch (e) {
      setError(friendly(e));
      setStep(null);
    } finally {
      refreshHistory();
      void refreshBalances();
    }
  }

  async function resume(id: string) {
    setError(null);
    setStep("keys");
    try {
      const w = wallet ?? (await requireWallet());
      await resumeWithdraw(w, id, { onStep: setStep });
    } catch (e) {
      setError(friendly(e));
      setStep(null);
    } finally {
      refreshHistory();
      void refreshBalances();
    }
  }

  const done = history.filter((h) => h.status === "done");
  const pending = history.filter((h) => h.status === "deposited");

  return (
    <div className="col" style={gap(20)}>
      <div className="card pad-l col" style={gap(14)}>
        <div className="row wrapx" style={gap(10)}>
          <Chip tone="warn" icon="warning">
            {t("liveBadge")}
          </Chip>
          <Chip icon="lock">Cloak</Chip>
        </div>
        <p className="lead" style={{ maxWidth: 720 }}>
          {t.rich("lead", { b: (c) => <b>{c}</b> })}
        </p>
        <p className="small muted" style={{ maxWidth: 720 }}>
          {t("leadNote")}
        </p>
      </div>

      <div className="card pad-l col" style={gap(14)}>
        <div className="row between wrapx" style={gap(12)}>
          <b>{t("walletTitle")}</b>
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => void refreshBalances()}>
            {t("refresh")}
          </Button>
        </div>
        <div className="row wrapx" style={gap(10)}>
          <code className="mono small" style={{ wordBreak: "break-all" }}>
            {address}
          </code>
          <Button size="sm" variant="secondary" icon="copy" onClick={() => void copy("addr", address)}>
            {copied === "addr" ? t("copied") : t("copy")}
          </Button>
        </div>
        {balanceError ? (
          <Notice tone="bad" role="alert" title={t("balanceFailTitle")}>
            {balanceError}
            {CLOAK_RPC_URL.includes("api.mainnet-beta") ? t("rpcHint") : ""}
          </Notice>
        ) : balances ? (
          <div className="row wrapx" style={gap(24)}>
            <span>
              <span className="small muted">USDC</span>
              <br />
              <b>{usdc(balances.usdc)}</b>
            </span>
            <span>
              <span className="small muted">{t("solLabel")}</span>
              <br />
              <b>{solText(f, balances.sol)}</b>
            </span>
          </div>
        ) : (
          <span className="small muted">{t("reading")}</span>
        )}
        {balances && balances.usdc === 0n ? (
          <Notice tone="info" title={t("emptyTitle")}>
            {t("emptyText")}
          </Notice>
        ) : null}
      </div>

      <form
        className="card pad-l col"
        style={gap(16)}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <b>{t("newWithdrawal")}</b>
        <div className="field">
          <label className="label" htmlFor="pw-valor">
            {t("amountLabel")}
          </label>
          <input id="pw-valor" className="input" inputMode="decimal" placeholder="2" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} autoComplete="off" />
          <span className="hint">{t("amountHint")}</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="pw-destino">
            {t("destLabel")}
          </label>
          <input id="pw-destino" className="input mono" placeholder={t("destPlaceholder")} value={destination} onChange={(e) => setDestination(e.target.value)} disabled={busy} autoComplete="off" spellCheck={false} />
          <span className="hint">{t("destHint")}</span>
        </div>
        {typed && !plan.ok ? (
          <span className="hint" style={{ color: "var(--red)" }} role="alert">
            {t(`problems.${plan.problem}`)}
          </span>
        ) : null}
        {plan.ok ? (
          <div className="card-flat pad-s row wrapx" style={gap(24)}>
            <span>
              <span className="small muted">{t("youWithdraw")}</span>
              <br />
              <b>{usdc(plan.amount)}</b>
            </span>
            <span>
              <span className="small muted">{t("estFee")}</span>
              <br />
              <b>{usdc(plan.fee)}</b>
            </span>
            <span>
              <span className="small muted">{t("destReceives")}</span>
              <br />
              <b>{usdc(plan.net)}</b>
            </span>
          </div>
        ) : null}
        <div className="row wrapx" style={gap(12)}>
          <Button type="submit" size="lg" icon="lock" loading={busy} disabled={!plan.ok}>
            {t("submit")}
          </Button>
        </div>

        {step ? (
          <ol className="col small" style={gap(8, { listStyle: "none", padding: 0, margin: 0 })} aria-live="polite">
            {STEPS.map((id, i) => {
              const at = STEPS.indexOf(step);
              const state = i < at || step === "done" ? "ok" : i === at ? "now" : "todo";
              return (
                <li key={id} className="row" style={gap(8, { opacity: state === "todo" ? 0.5 : 1 })}>
                  <Icon name={state === "ok" ? "check-circle" : state === "now" ? "clock" : "minus"} size="s" />
                  <span style={{ fontWeight: state === "now" ? 600 : 400 }}>{t(`steps.${id}`)}</span>
                </li>
              );
            })}
          </ol>
        ) : null}
        {error ? (
          <Notice tone="bad" role="alert" title={t("failTitle")}>
            {error}
            {t("failNote")}
          </Notice>
        ) : null}
      </form>

      {pending.length ? (
        <Notice tone="warn" title={t("halfTitle")}>
          <span className="col" style={gap(8)}>
            {pending.map((p) => (
              <span key={p.id} className="row wrapx" style={gap(10)}>
                <span>
                  {t("halfLine", { amount: usdc(BigInt(p.amount)), dest: short(p.destination) })}
                </span>
                <Button size="sm" onClick={() => void resume(p.id)} loading={busy}>
                  {t("finish")}
                </Button>
              </span>
            ))}
          </span>
        </Notice>
      ) : null}

      {done.length ? (
        <div className="card pad-l col" style={gap(12)}>
          <b>{t("doneTitle")}</b>
          <ul className="col small" style={gap(10, { listStyle: "none", padding: 0, margin: 0 })}>
            {done.map((h) => (
              <li key={h.id} className="row wrapx" style={gap(12)}>
                <span>{f.dateTime(h.createdAt)}</span>
                <b>{usdc(BigInt(h.amount))}</b>
                <span className="muted">→ {short(h.destination)}</span>
                {h.depositSignature ? (
                  <a href={solscanTx(h.depositSignature)} target="_blank" rel="noopener noreferrer">
                    {t("deposit")}
                  </a>
                ) : null}
                {h.withdrawSignature ? (
                  <a href={solscanTx(h.withdrawSignature)} target="_blank" rel="noopener noreferrer">
                    {t("withdrawal")}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
          <span className="small muted">
            {t.rich("doneNote", {
              a: (c) => (
                <a href={solscanAccount(done[0]!.destination)} target="_blank" rel="noopener noreferrer">
                  {c}
                </a>
              ),
            })}
          </span>
        </div>
      ) : null}

      <Accountant history={done} onError={setError} copy={copy} copied={copied === "key"} />

      <details className="card pad-l">
        <summary className="bold" style={{ cursor: "pointer" }}>
          {t("hides.title")}
        </summary>
        <ul className="col small" style={gap(8, { marginTop: 12 })}>
          <Bullet>{t.rich("hides.hidden", { b: (c) => <b>{c}</b> })}</Bullet>
          <Bullet>{t.rich("hides.from", { b: (c) => <b>{c}</b> })}</Bullet>
          <Bullet>{t.rich("hides.notHidden", { b: (c) => <b>{c}</b> })}</Bullet>
          <Bullet>{t.rich("hides.gain", { b: (c) => <b>{c}</b> })}</Bullet>
          <Bullet>{t("hides.alpha")}</Bullet>
        </ul>
      </details>
    </div>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="row start" style={gap(8)}>
      <Icon name="check" size="s" />
      <span>{children}</span>
    </li>
  );
}

/** Chave do contador: derivada da carteira (nada guardado), só lê o histórico. */
function Accountant({ history, onError, copy, copied }: { history: WithdrawEntry[]; onError: (m: string | null) => void; copy: (k: string, t: string) => Promise<void>; copied: boolean }) {
  const t = useTranslations("creator.cloak");
  const f = useFormat();
  const friendly = (e: unknown) => friendlyError(e, (k) => t(`errors.${k}`));
  const { wallet, requireWallet } = useSession();
  const destinations = useMemo(() => [...new Set(history.map((h) => h.destination))], [history]);
  const [dest, setDest] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState<"key" | "report" | null>(null);
  const chosen = dest || destinations[0] || "";

  async function keys() {
    const w = wallet ?? (await requireWallet());
    return deriveKeys(w);
  }

  async function copyKey() {
    onError(null);
    setWorking("key");
    try {
      await copy("key", viewingKeyHex((await keys()).nk));
    } catch (e) {
      onError(friendly(e));
    } finally {
      setWorking(null);
    }
  }

  async function report() {
    if (!chosen) return;
    onError(null);
    setWorking("report");
    setStatus(t("acct.reading"));
    try {
      const k = await keys();
      const expectSignatures = history.filter((h) => h.destination === chosen).flatMap((h) => [h.depositSignature, h.withdrawSignature].filter((s): s is string => Boolean(s)));
      const { csv, summary, missing } = await buildReport({
        nk: k.nk,
        destination: chosen,
        ownerPublicKey: k.owner.publicKey,
        expectSignatures,
        onStatus: (text) => setStatus(text.startsWith("Scanned") ? t("acct.reading") : text),
        onRetry: ({ missing: n, attempt, attempts }) => setStatus(t("acct.retrying", { missing: n, attempt, attempts })),
      });
      download(t("acct.fileName"), csv, "text/csv");
      setStatus(missing.length ? t("acct.partial", { missing: missing.length }) : t("acct.ready", { count: f.int(summary.transactionCount) }));
    } catch (e) {
      onError(friendly(e));
      setStatus(null);
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="card pad-l col" style={gap(14)}>
      <div className="row wrapx" style={gap(10)}>
        <Icon name="key" />
        <b>{t("acct.title")}</b>
      </div>
      <p className="small muted" style={{ maxWidth: 720 }}>
        {t("acct.text")}
      </p>
      <div className="row wrapx" style={gap(12)}>
        <Button variant="secondary" icon="copy" loading={working === "key"} onClick={() => void copyKey()}>
          {copied ? t("acct.keyCopied") : t("acct.copyKey")}
        </Button>
        {destinations.length > 1 ? (
          <select className="input" style={{ maxWidth: 260 }} value={chosen} onChange={(e) => setDest(e.target.value)} aria-label={t("acct.destLabel")}>
            {destinations.map((d) => (
              <option key={d} value={d}>
                {short(d)}
              </option>
            ))}
          </select>
        ) : null}
        <Button variant="secondary" icon="download" loading={working === "report"} disabled={!chosen} onClick={() => void report()}>
          {t("acct.download")}
        </Button>
      </div>
      {!chosen ? <span className="small muted">{t("acct.afterFirst")}</span> : null}
      {status ? (
        <span className="small" aria-live="polite">
          {status}
        </span>
      ) : null}
    </div>
  );
}
