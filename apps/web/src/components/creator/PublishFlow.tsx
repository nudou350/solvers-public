"use client";
// Fluxo real de publicação (/criador/publicar), em cinco etapas: entrar, cadastro, montar o pacote, enviar o ZIP, acompanhar.
// Substitui o assistente de pré-visualização antigo: aqui tudo vai para o servidor (PACKAGE_SPEC.md 14 e 22, fase P8).
// O estado de cada etapa vem do servidor (GET /creator/me), não de rascunhos locais.
import type { CreatorMe } from "@solvers/api-client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Empty } from "@/components/ui/Empty";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Loading } from "@/components/ui/Spinner";
import { Notice, useToast } from "@/components/ui/Toast";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { CREATOR_SOLVER_SLUG, fileSizeText, loadErrorText, MAX_ZIP_BYTES } from "@/lib/submissions-ui";
import { CreatorHead } from "./CreatorHead";
import { CreatorProfileForm } from "./CreatorProfileForm";
import { Timeline } from "./SubmissionParts";
import { ZipUploader } from "./ZipUploader";
import s from "./creator.module.css";

const STEPS = [
  { title: "Entrar", text: "Entre com o seu e-mail. A conta é a sua identidade de criador." },
  { title: "Cadastro", text: "Convite, nome, apresentação, termos e contato." },
  { title: "Montar o pacote", text: "Use o Criador de Solvers para preparar o ZIP." },
  { title: "Enviar o ZIP", text: "Envie o pacote para a conferência e a revisão." },
  { title: "Acompanhar", text: "Veja onde o envio está e o que falta." },
] as const;

type Load = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; me: CreatorMe };

export function PublishFlow() {
  const { api, status, me: user, login, loggingIn } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "idle" });
  const [rechecking, setRechecking] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);

  const fetchMe = useCallback(async () => {
    try {
      const me = await api.getCreatorMe();
      setLoad({ kind: "ok", me });
      return me;
    } catch (e) {
      setLoad({ kind: "error", message: loadErrorText(e) });
      return null;
    }
  }, [api]);

  useEffect(() => {
    if (status !== "authed") {
      setLoad({ kind: "idle" });
      return;
    }
    setLoad({ kind: "loading" });
    void fetchMe();
  }, [status, user?.wallet, fetchMe]);

  const creator = load.kind === "ok" ? load.me : null;
  // Etapa sugerida pelo estado do servidor; quem clica numa etapa liberada passa a mandar.
  const auto = status !== "authed" ? 1 : !creator || !creator.canSubmit ? 2 : 3;
  const unlocked = [true, status === "authed", status === "authed" && !!creator?.hasProfile, !!creator?.canSubmit, status === "authed"];
  const step = picked !== null && unlocked[picked - 1] ? picked : auto;
  const go = (n: number) => {
    setPicked(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const doLogin = () => login().catch((e: unknown) => toast({ tone: "bad", title: "Não deu para entrar", text: (e as Error).message }));

  async function recheck() {
    setRechecking(true);
    const me = await fetchMe();
    setRechecking(false);
    if (me?.contactVerified) toast({ tone: "ok", title: "Telegram vinculado", text: "Seu contato foi confirmado." });
    else if (me) toast({ tone: "info", title: "Ainda não vimos o vínculo", text: "Envie o comando ao bot e tente de novo em alguns segundos." });
  }

  const info = STEPS[step - 1]!;

  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <CreatorHead tab="publish" />

      <ol className={s.steps} aria-label="Etapas para publicar" style={{ marginBottom: 28 }}>
        {STEPS.map((st, i) => {
          const n = i + 1;
          const done = (n === 1 && status === "authed") || (n === 2 && !!creator?.canSubmit);
          return (
            <li key={st.title}>
              <button type="button" className={s.step} aria-current={step === n ? "step" : undefined} disabled={!unlocked[i]} onClick={() => go(n)}>
                <span className={["dot", done ? "dot-ok" : step === n ? "dot-now" : ""].join(" ")} aria-hidden style={{ width: 28, height: 28, fontSize: 12.5, borderWidth: 1.5 }}>
                  {done ? <Icon name="check" size="s" /> : n}
                </span>
                <span className={s.stepTitle}>
                  {st.title}
                  {done ? <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}> (concluída)</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="card pad-l col" style={gap(24)}>
        <div className="col" style={gap(4)}>
          <span className="eyebrow">
            Etapa {step} de {STEPS.length}
          </span>
          <h2 className="display h2s">{info.title}</h2>
          <p className="muted">{info.text}</p>
        </div>

        {step === 1 ? <StepSignIn authed={status === "authed"} loading={status === "loading"} loggingIn={loggingIn} onLogin={doLogin} email={user?.email ?? null} onNext={() => go(2)} /> : null}

        {step >= 2 && step <= 4 && load.kind === "loading" ? <Loading text="Carregando o seu cadastro…" /> : null}
        {step >= 2 && step <= 4 && load.kind === "error" ? (
          <Empty bare icon="warning" title="Não deu para carregar o seu cadastro" action={<Button onClick={() => void fetchMe()}>Tentar de novo</Button>}>
            {load.message}
          </Empty>
        ) : null}

        {step === 2 && creator ? (
          <CreatorProfileForm
            key={`${creator.wallet}-${creator.hasProfile}`}
            creator={creator}
            rechecking={rechecking}
            onRecheck={() => void recheck()}
            onSaved={(me) => {
              setLoad({ kind: "ok", me });
              toast({ tone: "ok", title: "Cadastro salvo" });
              go(3);
            }}
          />
        ) : null}

        {step === 3 ? <StepBuild onNext={() => go(4)} canSend={!!creator?.canSubmit} /> : null}

        {step === 4 && creator ? (
          creator.canSubmit ? (
            <ZipUploader onDone={(id) => router.push(`/criador/envios/${encodeURIComponent(id)}`)} />
          ) : (
            <Notice tone="warn" title="Falta completar o cadastro" actions={<Button variant="secondary" size="sm" onClick={() => go(2)}>Voltar ao cadastro</Button>}>
              {!creator.invited
                ? "Seu convite ainda não foi confirmado."
                : !creator.hasProfile || !creator.termsAccepted
                  ? "Falta salvar o nome, a apresentação e aceitar os termos."
                  : !creator.contactVerified
                    ? "Falta vincular o seu Telegram."
                    : "Seu cadastro ainda não está liberado para enviar."}
            </Notice>
          )
        ) : null}

        {step === 5 ? <StepTrack /> : null}

        {step > 1 ? (
          <div>
            <Button variant="ghost" icon="arrow-left" onClick={() => go(step - 1)}>
              Voltar
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StepSignIn({ authed, loading, loggingIn, onLogin, email, onNext }: { authed: boolean; loading: boolean; loggingIn: boolean; onLogin: () => void; email: string | null; onNext: () => void }) {
  if (loading) return <Loading />;
  if (authed)
    return (
      <div className="col" style={gap(16)}>
        <Notice tone="ok" title="Você já entrou">
          {email ? `Conta: ${email}.` : "Sua conta está ativa."} Não precisa de carteira nem de saldo: o Solvers cuida disso.
        </Notice>
        <div>
          <Button size="lg" iconRight="arrow-right" onClick={onNext}>
            Continuar para o cadastro
          </Button>
        </div>
      </div>
    );
  return (
    <div className="col" style={gap(16)}>
      <ul className="col" style={gap(12)}>
        <Point icon="mail">Entre com o seu e-mail. Mandamos um código de acesso e criamos a sua conta na hora.</Point>
        <Point icon="gift">Publicar é grátis, sem depósito e sem mensalidade.</Point>
        <Point icon="shield-check">Cada versão passa pela conferência automática e pela revisão da equipe antes de ir ao ar.</Point>
      </ul>
      <div>
        <Button size="lg" loading={loggingIn} onClick={onLogin}>
          Entrar
        </Button>
      </div>
    </div>
  );
}

function StepBuild({ onNext, canSend }: { onNext: () => void; canSend: boolean }) {
  return (
    <div className="col" style={gap(22)}>
      <div className="card-flat pad col" style={gap(14)}>
        <div className="row" style={gap(12)}>
          <span className="tile tile-s" style={{ "--h": 300 } as CSSProperties} aria-hidden>
            <Icon name="sparkles" />
          </span>
          <div className="col" style={gap(2)}>
            <h3 className="h3">Use o Criador de Solvers</h3>
            <span className="small muted">Especialista gratuito, incluído na plataforma</span>
          </div>
        </div>
        <p>
          Ele conversa com você em sete etapas: a promessa e o público, os diferenciais, o processo, o conhecimento, as ferramentas, a primeira conversa e os casos de teste. No fim, entrega o pacote pronto e já conferido pelo mesmo validador do site.
        </p>
        <div className="row wrapx" style={gap(10)}>
          <Button href={`/instalar?agent=${CREATOR_SOLVER_SLUG}`} iconRight="arrow-right">
            Instalar na minha IA
          </Button>
          <Button variant="secondary" href={`/especialistas/${CREATOR_SOLVER_SLUG}`}>
            Conhecer o Criador de Solvers
          </Button>
        </div>
        <p className="small muted">
          Instalar leva uns dois minutos e vale para o Claude e o ChatGPT. Depois é só pedir: “Use o Criador de Solvers para montar um especialista de [o seu tema]”.
        </p>
      </div>

      <div className="g2" style={gap(16)}>
        <div className="card pad-s col" style={gap(10)}>
          <b>Como o ZIP deve ficar</b>
          <pre className={s.raw} style={{ maxHeight: "none" }} aria-label="Estrutura de pastas do pacote">
            {"meu-especialista.zip\n├─ manifest.json\n├─ steps/       (3 a 6 etapas, .md)\n├─ knowledge/   (conhecimento, .md)\n├─ templates/   (modelos prontos)\n└─ evals/cases/ (casos de teste, .json)"}
          </pre>
          <span className="small muted">O manifest.json fica na raiz, não dentro de uma pasta extra. Até {fileSizeText(MAX_ZIP_BYTES)}.</span>
        </div>
        <div className="card pad-s col" style={gap(10)}>
          <b>Se a sua IA não gerar o ZIP</b>
          <p className="small muted">
            Algumas IAs só mostram os arquivos na conversa. Nesse caso, o Criador entrega cada arquivo em um bloco, com o passo a passo para você salvar cada um numa pasta e compactar. O site confere tudo de novo no envio.
          </p>
          <b>Referências</b>
          <ul className="col small" style={gap(6)}>
            <li>
              <a className="link" href="/api/spec/manifest.schema.json" target="_blank" rel="noopener noreferrer">
                Esquema do manifest.json (JSON)
              </a>
            </li>
            <li>
              <a className="link" href={`/especialistas/${CREATOR_SOLVER_SLUG}`}>
                Guia completo do formato, dentro do Criador de Solvers
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="row wrapx" style={gap(12)}>
        {canSend ? (
          <Button size="lg" iconRight="arrow-right" onClick={onNext}>
            Já tenho o ZIP, enviar
          </Button>
        ) : (
          <Chip tone="warn" icon="warning">
            O envio abre quando o cadastro e o contato estiverem completos
          </Chip>
        )}
      </div>
    </div>
  );
}

function StepTrack() {
  return (
    <div className="col" style={gap(20)}>
      <p>
        Depois do envio, cada pacote passa por estas etapas. Você acompanha tudo em <b>Meus envios</b> e recebe aviso quando a equipe responder.
      </p>
      <Timeline status="submitted" />
      <div className="row wrapx" style={gap(12)}>
        <Button size="lg" href="/criador/envios" iconRight="arrow-right">
          Ver meus envios
        </Button>
      </div>
    </div>
  );
}

function Point({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <li className="row start" style={gap(12)}>
      <span className="brand">
        <Icon name={icon} />
      </span>
      <span className="grow">{children}</span>
    </li>
  );
}
