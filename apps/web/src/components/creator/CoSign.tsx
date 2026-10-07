"use client";
// Co-assinatura do criador depois da aprovação do revisor (PACKAGE_SPEC.md 15.2). O servidor diz o que falta
// (GET /tx/publication/:id -> `step`): a tela mostra o botão do passo certo, em vez de tentar uma rota e ignorar o erro.
// Cada passo: o servidor monta (/tx/<passo>), a carteira assina, /tx/submit envia (com meta) e /tx/publication/confirm
// liga a assinatura à submissão e avança o fluxo.
import type { CreatorSigningStep, PublicationPlan, SubmissionView } from "@solvers/api-client";
import { CREATOR_SIGNING_STEPS } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Notice, useToast } from "@/components/ui/Toast";
import { useErrorText } from "@/lib/error-text";
import { useFormat } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { runTx, useFaucet, useTxErrorMessage, type TxErrorInfo } from "@/lib/tx";
import { loadErrorText } from "@/lib/submissions-ui";

const isSigning = (step: PublicationPlan["step"]): step is CreatorSigningStep => step !== null && (CREATOR_SIGNING_STEPS as readonly string[]).includes(step);

export function CoSign({ sub, onDone }: { sub: SubmissionView; onDone: () => Promise<void> }) {
  const t = useTranslations("creator.cosign");
  const tSub = useTranslations("submissions");
  const f = useFormat();
  const errorText = useErrorText();
  const txError = useTxErrorMessage();
  const usdc = (n: number) => f.num(n, 0, 2);
  // Tradutores por ref: mudam a cada render e não devem refazer a busca do plano.
  const loadMsg = useRef((e: unknown) => String(e));
  loadMsg.current = (e) => loadErrorText(tSub, e, errorText);
  const { api, requireWallet, login } = useSession();
  const toast = useToast();
  const faucet = useFaucet();
  const [plan, setPlan] = useState<PublicationPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TxErrorInfo | null>(null);

  const loadPlan = useCallback(async () => {
    try {
      setPlan(await api.getPublicationPlan(sub.id));
      setPlanError(null);
    } catch (e) {
      setPlanError(loadMsg.current(e));
    }
  }, [api, sub.id]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan, sub.status]);

  const build = (step: CreatorSigningStep) =>
    step === "register-agent" ? api.buildRegisterAgent(sub.id) : step === "update-version" ? api.buildUpdateVersion(sub.id) : api.buildUpdatePricing(sub.id);

  async function sign() {
    if (!plan || !isSigning(plan.step)) return;
    setPending(true);
    setError(null);
    try {
      const wallet = await requireWallet();
      let step: PublicationPlan["step"] = plan.step;
      // Registro ou atualização e, se o preço mudou, o passo do preço logo em seguida: o servidor diz qual é o próximo.
      for (let i = 0; i < CREATOR_SIGNING_STEPS.length && isSigning(step); i++) {
        const done: CreatorSigningStep = step;
        const tx = await runTx(api, wallet, () => build(done));
        await api.confirmPublication(sub.id, tx.signature, done);
        const next = await api.getPublicationPlan(sub.id);
        setPlan(next);
        step = next.step;
      }
      toast({ tone: "ok", title: t("toast.title"), text: t("toast.text") });
    } catch (e) {
      setError(txError(e));
    } finally {
      setPending(false);
      await onDone();
      await loadPlan();
    }
  }

  const step = plan?.step ?? null;
  const register = plan?.register ?? null;
  const missing = register && register.balanceUsdc < register.stakeUsdc;

  async function receiveFaucet() {
    if (await faucet.receive()) await loadPlan();
  }

  if (planError) {
    return (
      <Notice tone="warn" title={t("planFailTitle")} role="status" actions={<Button size="sm" onClick={() => void loadPlan()}>{t("retry")}</Button>}>
        {planError}
      </Notice>
    );
  }
  if (!plan) return <div className="card pad small muted">{t("checking")}</div>;

  if (step === "blocked") {
    return (
      <Notice tone="bad" title={t("blockedTitle")} role="alert">
        {t("blockedText")}
      </Notice>
    );
  }
  if (!isSigning(step)) {
    return (
      <div className="card pad col" style={gap(6)}>
        <h2 className="h3">{step === "await-admin-approval" ? t("awaitTitle") : t("doneTitle")}</h2>
        <p className="muted">{step === "await-admin-approval" ? t("awaitText") : t("doneText")}</p>
      </div>
    );
  }

  const isRegister = step === "register-agent";
  return (
    <div className="card pad col" style={gap(16, { borderColor: "var(--amber)" })}>
      <div className="col" style={gap(4)}>
        <h2 className="h3">{plan.label ?? (isRegister ? t("title.register") : step === "update-pricing" ? t("title.pricing") : t("title.version"))}</h2>
        <p className="muted">
          {isRegister ? t("text.register") : step === "update-pricing" ? t("text.pricing") : t("text.version")}
        </p>
      </div>
      <ul className="col small" style={gap(8)}>
        <Li>{t("li.fee")}</Li>
        <Li>
          {plan.approved
            ? t("li.approved", { name: plan.approved.name, version: plan.approved.version, price: usdc(plan.approved.priceUsdc) })
            : t("li.approvedShort")}
        </Li>
        {register ? (
          <Li>
            {t("li.stake", { stake: usdc(register.stakeUsdc), balance: usdc(register.balanceUsdc) })}
          </Li>
        ) : null}
        {isRegister ? <Li>{t("li.afterRegister")}</Li> : <Li>{t("li.afterUpdate")}</Li>}
      </ul>
      {missing ? (
        <Notice
          tone="warn"
          title={t("lowTitle")}
          role="status"
          actions={
            register.faucetEnabled ? (
              <Button size="sm" loading={faucet.pending} onClick={() => void receiveFaucet()}>
                {t("faucet")}
              </Button>
            ) : null
          }
        >
          {t("lowText", { missing: usdc(register.stakeUsdc - register.balanceUsdc) })}
        </Notice>
      ) : null}
      {error ? (
        <Notice
          tone="bad"
          role="alert"
          title={error.title}
          actions={
            error.action === "login" ? (
              <Button size="sm" onClick={() => void login().catch(() => {})}>
                {t("relogin")}
              </Button>
            ) : error.action === "faucet" && faucet.enabled ? (
              <Button size="sm" loading={faucet.pending} onClick={() => void receiveFaucet()}>
                {t("faucet")}
              </Button>
            ) : null
          }
        >
          {error.text}
        </Notice>
      ) : null}
      <div className="row wrapx" style={gap(12)}>
        <Button size="lg" loading={pending} disabled={!!missing} onClick={() => void sign()}>
          {error?.action === "retry" ? t("retryBtn") : t(`button.${step}`)}
        </Button>
      </div>
      <p className="tiny faint">{t("footnote")}</p>
    </div>
  );
}

function Li({ children }: { children: ReactNode }) {
  return (
    <li className="row start" style={gap(10)}>
      <span className="ok">
        <Icon name="check-circle" size="s" />
      </span>
      <span className="grow">{children}</span>
    </li>
  );
}
