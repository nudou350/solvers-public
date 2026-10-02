"use client";
// Co-assinatura do criador depois da aprovação do revisor (PACKAGE_SPEC.md 15.2). O servidor diz o que falta
// (GET /tx/publication/:id -> `step`): a tela mostra o botão do passo certo, em vez de tentar uma rota e ignorar o erro.
// Cada passo: o servidor monta (/tx/<passo>), a carteira assina, /tx/submit envia (com meta) e /tx/publication/confirm
// liga a assinatura à submissão e avança o fluxo.
import type { CreatorSigningStep, PublicationPlan, SubmissionView } from "@solvers/api-client";
import { CREATOR_SIGNING_STEPS } from "@solvers/api-client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Notice, useToast } from "@/components/ui/Toast";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { runTx, txErrorMessage, useFaucet, type TxErrorInfo } from "@/lib/tx";
import { loadErrorText } from "@/lib/submissions-ui";

const isSigning = (step: PublicationPlan["step"]): step is CreatorSigningStep => step !== null && (CREATOR_SIGNING_STEPS as readonly string[]).includes(step);

const BUTTON: Record<CreatorSigningStep, string> = {
  "register-agent": "Confirmar o cadastro",
  "update-version": "Confirmar a atualização",
  "update-pricing": "Confirmar o novo preço",
};

const usdc = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

export function CoSign({ sub, onDone }: { sub: SubmissionView; onDone: () => Promise<void> }) {
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
      setPlanError(loadErrorText(e));
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
      toast({ tone: "ok", title: "Confirmação registrada", text: "A equipe faz o resto. Acompanhe por aqui." });
    } catch (e) {
      setError(txErrorMessage(e));
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
      <Notice tone="warn" title="Não deu para ver o que falta" role="status" actions={<Button size="sm" onClick={() => void loadPlan()}>Tentar de novo</Button>}>
        {planError}
      </Notice>
    );
  }
  if (!plan) return <div className="card pad small muted">Conferindo o que falta para publicar…</div>;

  if (step === "blocked") {
    return (
      <Notice tone="bad" title="Este especialista está bloqueado na rede" role="alert">
        Ele está suspenso ou registrado por outra conta. Fale com a equipe.
      </Notice>
    );
  }
  if (!isSigning(step)) {
    return (
      <div className="card pad col" style={gap(6)}>
        <h2 className="h3">{step === "await-admin-approval" ? "Falta a aprovação final da equipe" : "Tudo certo na rede"}</h2>
        <p className="muted">
          {step === "await-admin-approval"
            ? "Você já confirmou. Assim que a equipe fizer a aprovação final, o especialista entra na vitrine."
            : "A publicação está sendo concluída. Esta página se atualiza sozinha."}
        </p>
      </div>
    );
  }

  const isRegister = step === "register-agent";
  return (
    <div className="card pad col" style={gap(16, { borderColor: "var(--amber)" })}>
      <div className="col" style={gap(4)}>
        <h2 className="h3">{plan.label ?? (isRegister ? "Confirme o cadastro do especialista" : step === "update-pricing" ? "Confirme o novo preço" : "Confirme a nova versão")}</h2>
        <p className="muted">
          {isRegister
            ? "A equipe aprovou o pacote. Falta você confirmar com a sua conta, uma única vez, para registrar o especialista como seu."
            : step === "update-pricing"
              ? "A versão já está na rede. Falta confirmar o preço aprovado."
              : "A equipe aprovou a nova versão. Falta você confirmar a atualização com a sua conta."}
        </p>
      </div>
      <ul className="col small" style={gap(8)}>
        <Li>A taxa da rede é do Solvers.</Li>
        <Li>
          Preço, nome e versão vêm do que a equipe aprovou
          {plan.approved ? ` (${plan.approved.name} v${plan.approved.version}, ${usdc(plan.approved.priceUsdc)} USDC)` : ""}. Você não precisa digitar nada.
        </Li>
        {register ? (
          <Li>
            O programa cobra um depósito de {usdc(register.stakeUsdc)} USDC no cadastro. Seu saldo: {usdc(register.balanceUsdc)} USDC.
          </Li>
        ) : null}
        {isRegister ? <Li>Depois da sua confirmação, a equipe faz a aprovação final e o especialista entra na vitrine.</Li> : <Li>Depois da sua confirmação, a nova versão entra no ar.</Li>}
      </ul>
      {missing ? (
        <Notice
          tone="warn"
          title="Saldo de USDC insuficiente para o depósito"
          role="status"
          actions={
            register.faucetEnabled ? (
              <Button size="sm" loading={faucet.pending} onClick={() => void receiveFaucet()}>
                Receber USDC de teste
              </Button>
            ) : null
          }
        >
          Faltam {usdc(register.stakeUsdc - register.balanceUsdc)} USDC para o depósito.
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
                Entrar de novo
              </Button>
            ) : error.action === "faucet" && faucet.enabled ? (
              <Button size="sm" loading={faucet.pending} onClick={() => void receiveFaucet()}>
                Receber USDC de teste
              </Button>
            ) : null
          }
        >
          {error.text}
        </Notice>
      ) : null}
      <div className="row wrapx" style={gap(12)}>
        <Button size="lg" loading={pending} disabled={!!missing} onClick={() => void sign()}>
          {error?.action === "retry" ? "Tentar de novo" : BUTTON[step]}
        </Button>
      </div>
      <p className="tiny faint">Uma janela do seu login pode abrir para você confirmar. A confirmação vale por poucos minutos: se demorar, é só tentar de novo.</p>
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
