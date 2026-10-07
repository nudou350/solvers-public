"use client";
// Saque privado do criador (Cloak, rede real): move USDC da carteira para outro endereço sem o explorador ligar os dois, e
// gera a "chave do contador" (leitura do histórico). Ver docs/cloak-privacidade.md.
import { formatUsdcBase, parseUsdcInput, PRIVATE_WITHDRAW_PROBLEM_TEXT, planPrivateWithdraw } from "@solvers/shared";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { short } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { CreatorHead } from "./CreatorHead";

const STEPS: { id: WithdrawStep; label: string }[] = [
  { id: "keys", label: "Preparando as suas chaves" },
  { id: "deposit", label: "Protegendo o valor (leva cerca de 1 minuto)" },
  { id: "withdraw", label: "Enviando ao endereço de destino" },
  { id: "done", label: "Concluído" },
];

const usdc = (v: bigint) => `${formatUsdcBase(v)} USDC`;
const sol = (v: bigint) => `${(Number(v) / 1e9).toFixed(4).replace(".", ",")} SOL`;

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
  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <CreatorHead tab="private" title="Sacar em privado" />
      <AuthGate icon="lock" title="Entre para sacar em privado" text="Use a mesma conta do painel do criador.">
        <Panel />
      </AuthGate>
    </section>
  );
}

function Panel() {
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

  const refreshHistory = useCallback(() => setHistory(address ? loadHistory(address) : []), [address]);
  const refreshBalances = useCallback(async () => {
    if (!address) return;
    setBalanceError(null);
    try {
      setBalances(await getMainnetBalances(address));
    } catch (e) {
      setBalances(null);
      setBalanceError(friendlyError(e));
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
      setError("Não deu para copiar. Selecione o texto e copie à mão.");
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
      setError(friendlyError(e));
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
      setError(friendlyError(e));
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
            Rede real · dinheiro de verdade
          </Chip>
          <Chip icon="lock">Cloak</Chip>
        </div>
        <p className="lead" style={{ maxWidth: 720 }}>
          Seus ganhos chegam à sua carteira e qualquer pessoa pode ver. Aqui você move uma parte para outro endereço <b>sem que o explorador mostre a ligação entre os dois</b>.
        </p>
        <p className="small muted" style={{ maxWidth: 720 }}>
          Funciona na rede real, separada da rede de teste usada no resto do Solvers. As vendas continuam públicas de propósito: é o que dá confiança aos compradores. O que fica protegido é o que você faz com o dinheiro depois.
        </p>
      </div>

      <div className="card pad-l col" style={gap(14)}>
        <div className="row between wrapx" style={gap(12)}>
          <b>Sua carteira na rede real</b>
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => void refreshBalances()}>
            Atualizar
          </Button>
        </div>
        <div className="row wrapx" style={gap(10)}>
          <code className="mono small" style={{ wordBreak: "break-all" }}>
            {address}
          </code>
          <Button size="sm" variant="secondary" icon="copy" onClick={() => void copy("addr", address)}>
            {copied === "addr" ? "Copiado" : "Copiar"}
          </Button>
        </div>
        {balanceError ? (
          <Notice tone="bad" role="alert" title="Não deu para ler os saldos">
            {balanceError}
            {CLOAK_RPC_URL.includes("api.mainnet-beta") ? " O endereço de leitura padrão limita navegadores: configure NEXT_PUBLIC_CLOAK_RPC_URL." : ""}
          </Notice>
        ) : balances ? (
          <div className="row wrapx" style={gap(24)}>
            <span>
              <span className="small muted">USDC</span>
              <br />
              <b>{usdc(balances.usdc)}</b>
            </span>
            <span>
              <span className="small muted">SOL (taxas de rede)</span>
              <br />
              <b>{sol(balances.sol)}</b>
            </span>
          </div>
        ) : (
          <span className="small muted">Lendo os saldos…</span>
        )}
        {balances && balances.usdc === 0n ? (
          <Notice tone="info" title="Sem saldo na rede real">
            Para sacar, envie USDC e uns 0,005 SOL (para as taxas de rede) para o endereço acima, na rede real. O USDC de teste do Solvers não vale aqui.
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
        <b>Novo saque</b>
        <div className="field">
          <label className="label" htmlFor="pw-valor">
            Valor (USDC)
          </label>
          <input id="pw-valor" className="input" inputMode="decimal" placeholder="2" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} autoComplete="off" />
          <span className="hint">Mínimo de 1 USDC. Taxa do Cloak: 0,45 USDC + 0,3%.</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="pw-destino">
            Endereço de destino
          </label>
          <input id="pw-destino" className="input mono" placeholder="Cole o endereço que vai receber" value={destination} onChange={(e) => setDestination(e.target.value)} disabled={busy} autoComplete="off" spellCheck={false} />
          <span className="hint">Use um endereço só para isso: o relatório do contador lista os saques que chegaram nele.</span>
        </div>
        {typed && !plan.ok ? (
          <span className="hint" style={{ color: "var(--red)" }} role="alert">
            {PRIVATE_WITHDRAW_PROBLEM_TEXT[plan.problem]}
          </span>
        ) : null}
        {plan.ok ? (
          <div className="card-flat pad-s row wrapx" style={gap(24)}>
            <span>
              <span className="small muted">Você retira</span>
              <br />
              <b>{usdc(plan.amount)}</b>
            </span>
            <span>
              <span className="small muted">Taxa estimada</span>
              <br />
              <b>{usdc(plan.fee)}</b>
            </span>
            <span>
              <span className="small muted">O destino recebe</span>
              <br />
              <b>{usdc(plan.net)}</b>
            </span>
          </div>
        ) : null}
        <div className="row wrapx" style={gap(12)}>
          <Button type="submit" size="lg" icon="lock" loading={busy} disabled={!plan.ok}>
            Sacar em privado
          </Button>
        </div>

        {step ? (
          <ol className="col small" style={gap(8, { listStyle: "none", padding: 0, margin: 0 })} aria-live="polite">
            {STEPS.map((s, i) => {
              const at = STEPS.findIndex((x) => x.id === step);
              const state = i < at || step === "done" ? "ok" : i === at ? "now" : "todo";
              return (
                <li key={s.id} className="row" style={gap(8, { opacity: state === "todo" ? 0.5 : 1 })}>
                  <Icon name={state === "ok" ? "check-circle" : state === "now" ? "clock" : "minus"} size="s" />
                  <span style={{ fontWeight: state === "now" ? 600 : 400 }}>{s.label}</span>
                </li>
              );
            })}
          </ol>
        ) : null}
        {error ? (
          <Notice tone="bad" role="alert" title="O saque não terminou">
            {error} Se o valor já tinha sido protegido, ele aparece abaixo para você concluir.
          </Notice>
        ) : null}
      </form>

      {pending.length ? (
        <Notice tone="warn" title="Saque pela metade">
          <span className="col" style={gap(8)}>
            {pending.map((p) => (
              <span key={p.id} className="row wrapx" style={gap(10)}>
                <span>
                  {usdc(BigInt(p.amount))} para {short(p.destination)}
                </span>
                <Button size="sm" onClick={() => void resume(p.id)} loading={busy}>
                  Concluir saque
                </Button>
              </span>
            ))}
          </span>
        </Notice>
      ) : null}

      {done.length ? (
        <div className="card pad-l col" style={gap(12)}>
          <b>Saques feitos neste navegador</b>
          <ul className="col small" style={gap(10, { listStyle: "none", padding: 0, margin: 0 })}>
            {done.map((h) => (
              <li key={h.id} className="row wrapx" style={gap(12)}>
                <span>{new Date(h.createdAt).toLocaleString("pt-BR")}</span>
                <b>{usdc(BigInt(h.amount))}</b>
                <span className="muted">→ {short(h.destination)}</span>
                {h.depositSignature ? (
                  <a href={solscanTx(h.depositSignature)} target="_blank" rel="noopener noreferrer">
                    depósito
                  </a>
                ) : null}
                {h.withdrawSignature ? (
                  <a href={solscanTx(h.withdrawSignature)} target="_blank" rel="noopener noreferrer">
                    saque
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
          <span className="small muted">
            No explorador, o depósito aparece na sua carteira e o saque aparece no destino ({" "}
            <a href={solscanAccount(done[0]!.destination)} target="_blank" rel="noopener noreferrer">
              ver destino
            </a>
            ), sem nada que ligue um ao outro.
          </span>
        </div>
      ) : null}

      <Accountant history={done} onError={setError} copy={copy} copied={copied === "key"} />

      <details className="card pad-l">
        <summary className="bold" style={{ cursor: "pointer" }}>
          O que isso esconde, e o que não esconde
        </summary>
        <ul className="col small" style={gap(8, { marginTop: 12 })}>
          <Bullet>
            <b>Escondido:</b> a ligação entre a sua carteira e o endereço de destino, e o saldo que você guarda.
          </Bullet>
          <Bullet>
            <b>De quem:</b> de concorrentes, clientes e qualquer pessoa olhando o explorador.
          </Bullet>
          <Bullet>
            <b>Não escondido:</b> suas vendas e receita (são públicas de propósito), o fato de você usar o Cloak, o valor e o horário (num pool pequeno, valor e horário parecidos podem sugerir a ligação) e o que o Cloak enxerga: ele recebe a chave do contador ao registrar a carteira.
          </Bullet>
          <Bullet>
            <b>Ganho:</b> você escolhe quem vê o histórico. Dê a chave ao contador e ele enxerga tudo; o público, nada.
          </Bullet>
          <Bullet>O Cloak é novo (alfa), o código não é aberto e a auditoria não foi publicada. Comece com valores pequenos.</Bullet>
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
      onError(friendlyError(e));
    } finally {
      setWorking(null);
    }
  }

  async function report() {
    if (!chosen) return;
    onError(null);
    setWorking("report");
    setStatus("Lendo o histórico (leva alguns minutos)…");
    try {
      const k = await keys();
      const expectSignatures = history.filter((h) => h.destination === chosen).flatMap((h) => [h.depositSignature, h.withdrawSignature].filter((s): s is string => Boolean(s)));
      const { csv, summary, missing } = await buildReport({
        nk: k.nk,
        destination: chosen,
        ownerPublicKey: k.owner.publicKey,
        expectSignatures,
        onStatus: (t) => setStatus(t.startsWith("Scanned") ? "Lendo o histórico (leva alguns minutos)…" : t),
      });
      download("comprovante-saques-privados.csv", csv, "text/csv");
      setStatus(
        missing.length
          ? `Arquivo gerado, mas ${missing.length} movimentação(ões) não apareceram (a rede recusou algumas leituras). Tente de novo em instantes.`
          : `Pronto: ${summary.transactionCount} movimentações no arquivo.`,
      );
    } catch (e) {
      onError(friendlyError(e));
      setStatus(null);
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="card pad-l col" style={gap(14)}>
      <div className="row wrapx" style={gap(10)}>
        <Icon name="key" />
        <b>Chave do contador</b>
      </div>
      <p className="small muted" style={{ maxWidth: 720 }}>
        É uma chave só de leitura: quem a tem enxerga o histórico dos seus saques privados, mas não consegue mexer no dinheiro. Ela é refeita a partir da sua carteira, então você não precisa guardá-la.
      </p>
      <div className="row wrapx" style={gap(12)}>
        <Button variant="secondary" icon="copy" loading={working === "key"} onClick={() => void copyKey()}>
          {copied ? "Chave copiada" : "Copiar chave do contador"}
        </Button>
        {destinations.length > 1 ? (
          <select className="input" style={{ maxWidth: 260 }} value={chosen} onChange={(e) => setDest(e.target.value)} aria-label="Destino do relatório">
            {destinations.map((d) => (
              <option key={d} value={d}>
                {short(d)}
              </option>
            ))}
          </select>
        ) : null}
        <Button variant="secondary" icon="download" loading={working === "report"} disabled={!chosen} onClick={() => void report()}>
          Baixar relatório (CSV)
        </Button>
      </div>
      {!chosen ? <span className="small muted">O relatório fica disponível depois do primeiro saque.</span> : null}
      {status ? (
        <span className="small" aria-live="polite">
          {status}
        </span>
      ) : null}
    </div>
  );
}
