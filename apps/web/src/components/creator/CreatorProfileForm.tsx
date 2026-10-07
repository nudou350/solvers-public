"use client";
// Etapa "Cadastro" do fluxo de publicação: convite, nome, bio, termos e contato de escalonamento (PACKAGE_SPEC.md 14.1).
import type { CreatorMe } from "@solvers/api-client";
import { ApiError } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Toast";
import { useErrorText } from "@/lib/error-text";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { TelegramLinkPanel } from "./TelegramLinkPanel";

const NAME_MIN = 2;
const NAME_MAX = 60;
const BIO_MIN = 10;
const BIO_MAX = 500;
const INVITE_MIN = 6;
const INVITE_MAX = 64;

/** Texto do erro ao salvar, no idioma da página. Códigos do servidor: invite_required, invite_invalid, invite_used (409). */
function useSaveErrorText(): (e: unknown) => string {
  const t = useTranslations("creator.profile.errors");
  const errorText = useErrorText();
  return (e) => {
    if (e instanceof ApiError) {
      if (e.status === 401) return t("sessionExpired");
      if (e.code === "invite_required") return t("inviteRequired");
      if (e.code === "invite_used") return t("inviteUsed");
      if (e.code === "invite_invalid") return t("inviteInvalid");
      if (e.status === 403) return e.message || t("forbidden");
      if (e.status === 409) return e.message || t("conflict");
      if (e.status === 429) return t("tooMany");
      if (e.status >= 500) return t("server");
      return errorText(e);
    }
    return e instanceof Error && e.message ? e.message : t("generic");
  };
}

export function CreatorProfileForm({ creator, onSaved, onLinked, onRecheck, rechecking }: { creator: CreatorMe; onSaved: (me: CreatorMe) => void; onLinked?: (me: CreatorMe) => void; onRecheck: () => void; rechecking: boolean }) {
  const t = useTranslations("creator.profile");
  const saveErrorText = useSaveErrorText();
  const { api } = useSession();
  const [name, setName] = useState(creator.name ?? "");
  const [bio, setBio] = useState(creator.bio ?? "");
  const [invite, setInvite] = useState("");
  const [terms, setTerms] = useState(creator.termsAccepted);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needInvite = !creator.invited;
  const errors = {
    name: name.trim().length < NAME_MIN ? t("validation.name", { min: NAME_MIN }) : null,
    bio: bio.trim().length < BIO_MIN ? t("validation.bio", { min: BIO_MIN }) : null,
    invite: needInvite && (invite.trim().length < INVITE_MIN || invite.trim().length > INVITE_MAX) ? t("validation.invite") : null,
    terms: !terms ? t("validation.terms") : null,
  };
  const valid = !errors.name && !errors.bio && !errors.invite && !errors.terms;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const me = await api.saveCreatorProfile({ name: name.trim(), bio: bio.trim(), acceptTerms: true, ...(needInvite ? { inviteCode: invite.trim() } : {}) });
      onSaved(me);
    } catch (err) {
      setError(saveErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  const set = (fn: (v: string) => void) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => fn(e.target.value);

  return (
    <form className="col" style={gap(20)} onSubmit={submit} noValidate>
      {needInvite ? (
        <Field id="cr-convite" label={t("invite.label")} hint={t("invite.hint")} error={touched ? errors.invite : null}>
          <input id="cr-convite" className="input mono" value={invite} onChange={set(setInvite)} maxLength={INVITE_MAX} autoComplete="off" spellCheck={false} aria-invalid={touched && !!errors.invite} />
        </Field>
      ) : (
        <div>
          <Chip tone="ok" icon="check-circle">
            {t("invite.confirmed")}
          </Chip>
        </div>
      )}
      <Field id="cr-nome" label={t("name.label")} hint={t("name.hint")} error={touched ? errors.name : null}>
        <input id="cr-nome" className="input" value={name} onChange={set(setName)} maxLength={NAME_MAX} autoComplete="name" aria-invalid={touched && !!errors.name} />
      </Field>
      <Field id="cr-bio" label={t("bio.label")} hint={t("bio.hint", { count: bio.trim().length, max: BIO_MAX })} error={touched ? errors.bio : null}>
        <textarea id="cr-bio" className="textarea" value={bio} onChange={set(setBio)} maxLength={BIO_MAX} aria-invalid={touched && !!errors.bio} />
      </Field>

      <ContactBlock verified={creator.contactVerified} hasProfile={creator.hasProfile} onLinked={onLinked ?? (() => onRecheck())} onRecheck={onRecheck} rechecking={rechecking} />

      <details className="card-flat pad-s">
        <summary className="bold" style={{ cursor: "pointer", minHeight: 32, display: "flex", alignItems: "center" }}>
          {t("summary.title")}
        </summary>
        <ul className="col small" style={gap(8, { marginTop: 10 })}>
          <Bullet>{t("summary.b1")}</Bullet>
          <Bullet>{t("summary.b2")}</Bullet>
          <Bullet>{t("summary.b3")}</Bullet>
          <Bullet>{t("summary.b4")}</Bullet>
        </ul>
      </details>

      <div className="col" style={gap(6)}>
        <label className="row start" style={gap(12, { cursor: "pointer", minHeight: 44 })} htmlFor="cr-termos">
          <input id="cr-termos" type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={{ width: 22, height: 22, marginTop: 1, accentColor: "var(--brand)", flex: "none" }} aria-invalid={touched && !!errors.terms} aria-describedby={touched && errors.terms ? "cr-termos-erro" : undefined} />
          <span>{t("terms")}</span>
        </label>
        {touched && errors.terms ? (
          <span id="cr-termos-erro" className="hint" style={{ color: "var(--red)" }} role="alert">
            {errors.terms}
          </span>
        ) : null}
      </div>

      {error ? (
        <Notice tone="bad" title={t("saveFailTitle")} role="alert">
          {error}
        </Notice>
      ) : null}
      <div className="row wrapx" style={gap(12)}>
        <Button type="submit" size="lg" loading={saving} iconRight="arrow-right">
          {creator.hasProfile ? t("saveContinue") : t("save")}
        </Button>
      </div>
    </form>
  );
}

function ContactBlock({ verified, hasProfile, onLinked, onRecheck, rechecking }: { verified: boolean; hasProfile: boolean; onLinked: (me: CreatorMe) => void; onRecheck: () => void; rechecking: boolean }) {
  const t = useTranslations("creator.profile.contact");
  return (
    <div className="card-flat pad-s col" style={gap(10)}>
      <div className="row between wrapx" style={gap(10)}>
        <b>{t("title")}</b>
        {verified ? (
          <Chip tone="ok" icon="check-circle">
            {t("linked")}
          </Chip>
        ) : (
          <Chip tone="warn" icon="warning">
            {t("missing")}
          </Chip>
        )}
      </div>
      {verified ? (
        <p className="small muted">{t("okText")}</p>
      ) : (
        <>
          <p className="small muted">{t.rich("text", { b: (c) => <b>{c}</b> })}</p>
          {hasProfile ? (
            <TelegramLinkPanel onLinked={onLinked} onRecheck={onRecheck} rechecking={rechecking} />
          ) : (
            <p className="small muted">{t("saveFirst")}</p>
          )}
          <p className="tiny faint">{t("later")}</p>
        </>
      )}
    </div>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="row start" style={gap(10)}>
      <span className="ok">
        <Icon name="check-circle" size="s" />
      </span>
      <span className="grow">{children}</span>
    </li>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="hint" style={{ color: "var(--red)" }} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}
