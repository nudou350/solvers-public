"use client";
// Fluxo real de publicação (/creator/publish), em cinco etapas: entrar, cadastro, montar o pacote, enviar o ZIP, acompanhar.
// Substitui o assistente de pré-visualização antigo: aqui tudo vai para o servidor (PACKAGE_SPEC.md 14 e 22, fase P8).
// O estado de cada etapa vem do servidor (GET /creator/me), não de rascunhos locais.
import type { CreatorMe } from "@solvers/api-client";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Empty } from "@/components/ui/Empty";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Loading } from "@/components/ui/Spinner";
import { Notice, useToast } from "@/components/ui/Toast";
import { useErrorText } from "@/lib/error-text";
import { useFormat } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { CREATOR_SOLVER_SLUG, loadErrorText, MAX_ZIP_BYTES } from "@/lib/submissions-ui";
import { CreatorHead } from "./CreatorHead";
import { CreatorProfileForm } from "./CreatorProfileForm";
import { Timeline } from "./SubmissionParts";
import { TelegramLinkPanel } from "./TelegramLinkPanel";
import { ZipUploader } from "./ZipUploader";
import s from "./creator.module.css";

const STEPS = ["signIn", "profile", "build", "upload", "track"] as const;

type Load = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; me: CreatorMe };

export function PublishFlow() {
  const t = useTranslations("creator.publish");
  const tSub = useTranslations("submissions");
  const errorText = useErrorText();
  const { api, status, me: user, login, loggingIn } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "idle" });
  const [rechecking, setRechecking] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);

  // Tradutor por ref: muda a cada render e não deve refazer a busca do cadastro.
  const loadMsg = useRef((e: unknown) => String(e));
  loadMsg.current = (e) => loadErrorText(tSub, e, errorText);

  const fetchMe = useCallback(async () => {
    try {
      const me = await api.getCreatorMe();
      setLoad({ kind: "ok", me });
      return me;
    } catch (e) {
      setLoad({ kind: "error", message: loadMsg.current(e) });
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

  const doLogin = () => login().catch((e: unknown) => toast({ tone: "bad", title: t("loginFail"), text: (e as Error).message }));

  async function recheck() {
    setRechecking(true);
    const me = await fetchMe();
    setRechecking(false);
    if (me?.contactVerified) toast({ tone: "ok", title: t("linked.title"), text: t("linked.text") });
    else if (me) toast({ tone: "info", title: t("notYet.title"), text: t("notYet.text") });
  }

  // O painel de vínculo viu o Telegram vinculado (conferência a cada 4 s): atualiza o estado e avisa.
  const linked = useCallback(
    (me: CreatorMe) => {
      setLoad({ kind: "ok", me });
      toast({ tone: "ok", title: t("linked.title"), text: t("linked.text") });
    },
    [toast, t],
  );

  const info = STEPS[step - 1]!;
  const reason = !creator
    ? ""
    : !creator.invited
      ? t("incomplete.notInvited")
      : !creator.hasProfile || !creator.termsAccepted
        ? t("incomplete.needProfile")
        : !creator.contactVerified
          ? t("incomplete.needContact")
          : t("incomplete.notReady");

  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <CreatorHead tab="publish" />

      <ol className={s.steps} aria-label={t("ariaSteps")} style={{ marginBottom: 28 }}>
        {STEPS.map((st, i) => {
          const n = i + 1;
          const done = (n === 1 && status === "authed") || (n === 2 && !!creator?.canSubmit);
          return (
            <li key={st}>
              <button type="button" className={s.step} aria-current={step === n ? "step" : undefined} disabled={!unlocked[i]} onClick={() => go(n)}>
                <span className={["dot", done ? "dot-ok" : step === n ? "dot-now" : ""].join(" ")} aria-hidden style={{ width: 28, height: 28, fontSize: 12.5, borderWidth: 1.5 }}>
                  {done ? <Icon name="check" size="s" /> : n}
                </span>
                <span className={s.stepTitle}>
                  {t(`steps.${st}.title`)}
                  {done ? <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{t("stepDone")}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="card pad-l col" style={gap(24)}>
        <div className="col" style={gap(4)}>
          <span className="eyebrow">{t("stepOf", { n: step, total: STEPS.length })}</span>
          <h2 className="display h2s">{t(`steps.${info}.title`)}</h2>
          <p className="muted">{t(`steps.${info}.text`)}</p>
        </div>

        {step === 1 ? <StepSignIn authed={status === "authed"} loading={status === "loading"} loggingIn={loggingIn} onLogin={doLogin} email={user?.email ?? null} onNext={() => go(2)} /> : null}

        {step >= 2 && step <= 4 && load.kind === "loading" ? <Loading text={t("loadingProfile")} /> : null}
        {step >= 2 && step <= 4 && load.kind === "error" ? (
          <Empty bare icon="warning" title={t("loadFailTitle")} action={<Button onClick={() => void fetchMe()}>{t("retry")}</Button>}>
            {load.message}
          </Empty>
        ) : null}

        {step === 2 && creator ? (
          <CreatorProfileForm
            key={`${creator.wallet}-${creator.hasProfile}`}
            creator={creator}
            rechecking={rechecking}
            onRecheck={() => void recheck()}
            onLinked={linked}
            onSaved={(me) => {
              setLoad({ kind: "ok", me });
              toast({ tone: "ok", title: t("saved") });
              go(3);
            }}
          />
        ) : null}

        {step === 3 ? <StepBuild onNext={() => go(4)} canSend={!!creator?.canSubmit} /> : null}

        {step === 4 && creator ? (
          creator.canSubmit ? (
            <ZipUploader onDone={(id) => router.push(`/creator/submissions/${encodeURIComponent(id)}`)} />
          ) : (
            <div className="col" style={gap(16)}>
              <Notice tone="warn" title={t("incomplete.title")} actions={<Button variant="secondary" size="sm" onClick={() => go(2)}>{t("incomplete.back")}</Button>}>
                {reason}
              </Notice>
              {creator.invited && creator.hasProfile && creator.termsAccepted && !creator.contactVerified ? (
                <TelegramLinkPanel onLinked={linked} onRecheck={() => void recheck()} rechecking={rechecking} />
              ) : null}
            </div>
          )
        ) : null}

        {step === 5 ? <StepTrack /> : null}

        {step > 1 ? (
          <div>
            <Button variant="ghost" icon="arrow-left" onClick={() => go(step - 1)}>
              {t("back")}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StepSignIn({ authed, loading, loggingIn, onLogin, email, onNext }: { authed: boolean; loading: boolean; loggingIn: boolean; onLogin: () => void; email: string | null; onNext: () => void }) {
  const t = useTranslations("creator.publish.signIn");
  if (loading) return <Loading />;
  if (authed)
    return (
      <div className="col" style={gap(16)}>
        <Notice tone="ok" title={t("alreadyIn")}>
          {email ? t("account", { email }) : t("accountActive")} {t("noWallet")}
        </Notice>
        <div>
          <Button size="lg" iconRight="arrow-right" onClick={onNext}>
            {t("next")}
          </Button>
        </div>
      </div>
    );
  return (
    <div className="col" style={gap(16)}>
      <ul className="col" style={gap(12)}>
        <Point icon="mail">{t("p1")}</Point>
        <Point icon="gift">{t("p2")}</Point>
        <Point icon="shield-check">{t("p3")}</Point>
      </ul>
      <div>
        <Button size="lg" loading={loggingIn} onClick={onLogin}>
          {t("login")}
        </Button>
      </div>
    </div>
  );
}

function StepBuild({ onNext, canSend }: { onNext: () => void; canSend: boolean }) {
  const t = useTranslations("creator.publish.build");
  const f = useFormat();
  return (
    <div className="col" style={gap(22)}>
      <div className="card-flat pad col" style={gap(14)}>
        <div className="row" style={gap(12)}>
          <span className="tile tile-s" style={{ "--h": 300 } as CSSProperties} aria-hidden>
            <Icon name="sparkles" />
          </span>
          <div className="col" style={gap(2)}>
            <h3 className="h3">{t("toolTitle")}</h3>
            <span className="small muted">{t("toolSub")}</span>
          </div>
        </div>
        <p>{t("toolText")}</p>
        <div className="row wrapx" style={gap(10)}>
          <Button href={`/install?agent=${CREATOR_SOLVER_SLUG}`} iconRight="arrow-right">
            {t("install")}
          </Button>
          <Button variant="secondary" href={`/solvers/${CREATOR_SOLVER_SLUG}`}>
            {t("learn")}
          </Button>
        </div>
        <p className="small muted">{t("installNote")}</p>
      </div>

      <div className="g2" style={gap(16)}>
        <div className="card pad-s col" style={gap(10)}>
          <b>{t("zipTitle")}</b>
          <pre className={s.raw} style={{ maxHeight: "none" }} aria-label={t("zipTreeLabel")}>
            {t("zipTree")}
          </pre>
          <span className="small muted">{t("zipNote", { size: f.fileSize(MAX_ZIP_BYTES) })}</span>
        </div>
        <div className="card pad-s col" style={gap(10)}>
          <b>{t("noZipTitle")}</b>
          <p className="small muted">{t("noZipText")}</p>
          <b>{t("refs")}</b>
          <ul className="col small" style={gap(6)}>
            <li>
              <a className="link" href="/api/spec/manifest.schema.json" target="_blank" rel="noopener noreferrer">
                {t("schema")}
              </a>
            </li>
            <li>
              <a className="link" href={`/solvers/${CREATOR_SOLVER_SLUG}`}>
                {t("guide")}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="row wrapx" style={gap(12)}>
        {canSend ? (
          <Button size="lg" iconRight="arrow-right" onClick={onNext}>
            {t("haveZip")}
          </Button>
        ) : (
          <Chip tone="warn" icon="warning">
            {t("locked")}
          </Chip>
        )}
      </div>
    </div>
  );
}

function StepTrack() {
  const t = useTranslations("creator.publish.track");
  return (
    <div className="col" style={gap(20)}>
      <p>{t.rich("text", { b: (c) => <b>{c}</b> })}</p>
      <Timeline status="submitted" />
      <div className="row wrapx" style={gap(12)}>
        <Button size="lg" href="/creator/submissions" iconRight="arrow-right">
          {t("view")}
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
