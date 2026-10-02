"use client";
// Etapa "Cadastro" do fluxo de publicação: convite, nome, bio, termos e contato de escalonamento (PACKAGE_SPEC.md 14.1).
import type { CreatorMe } from "@solvers/api-client";
import { ApiError } from "@solvers/api-client";
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Toast";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { TelegramLinkPanel } from "./TelegramLinkPanel";

const NAME_MIN = 2;
const NAME_MAX = 60;
const BIO_MIN = 10;
const BIO_MAX = 500;
const INVITE_MIN = 6;
const INVITE_MAX = 64;

function saveErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Sua sessão expirou. Entre de novo e salve outra vez.";
    // Códigos do servidor: invite_required (falta o código), invite_invalid (não existe) e invite_used (409, já é de outra conta).
    if (e.code === "invite_required") return "Cole o código de convite que a equipe enviou para você.";
    if (e.code === "invite_used") return "Esse convite já foi usado por outra conta. Peça outro à equipe.";
    if (e.code === "invite_invalid") return "Esse código de convite não existe. Confira se copiou inteiro ou peça outro à equipe.";
    if (e.status === 403) return e.message || "Esse código de convite não vale. Confira se copiou inteiro ou peça outro à equipe.";
    if (e.status === 409) return e.message || "Esse convite já foi usado por outra conta.";
    if (e.status === 429) return "Muitas tentativas seguidas. Espere um minuto e tente de novo.";
    if (e.status >= 500) return "O servidor não respondeu bem. Tente de novo em instantes.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Não deu para salvar agora.";
}

export function CreatorProfileForm({ creator, onSaved, onLinked, onRecheck, rechecking }: { creator: CreatorMe; onSaved: (me: CreatorMe) => void; onLinked?: (me: CreatorMe) => void; onRecheck: () => void; rechecking: boolean }) {
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
    name: name.trim().length < NAME_MIN ? `Escreva o nome que vai aparecer na vitrine (pelo menos ${NAME_MIN} letras).` : null,
    bio: bio.trim().length < BIO_MIN ? `Conte em poucas frases quem você é e o que sabe fazer (pelo menos ${BIO_MIN} caracteres).` : null,
    invite: needInvite && (invite.trim().length < INVITE_MIN || invite.trim().length > INVITE_MAX) ? "Cole o código de convite que a equipe enviou para você." : null,
    terms: !terms ? "Para continuar, você precisa aceitar os termos." : null,
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
        <Field id="cr-convite" label="Código de convite" hint="Por enquanto, só criadores convidados enviam especialistas. O código vem por e-mail, da equipe do Solvers." error={touched ? errors.invite : null}>
          <input id="cr-convite" className="input mono" value={invite} onChange={set(setInvite)} maxLength={INVITE_MAX} autoComplete="off" spellCheck={false} aria-invalid={touched && !!errors.invite} />
        </Field>
      ) : (
        <div>
          <Chip tone="ok" icon="check-circle">
            Convite confirmado
          </Chip>
        </div>
      )}
      <Field id="cr-nome" label="Nome na vitrine" hint="O nome que os compradores veem em “por …”. Pode ser o seu ou o da sua marca." error={touched ? errors.name : null}>
        <input id="cr-nome" className="input" value={name} onChange={set(setName)} maxLength={NAME_MAX} autoComplete="name" aria-invalid={touched && !!errors.name} />
      </Field>
      <Field id="cr-bio" label="Sobre você" hint={`${bio.trim().length}/${BIO_MAX} · Experiência, área e o tipo de problema que você resolve.`} error={touched ? errors.bio : null}>
        <textarea id="cr-bio" className="textarea" value={bio} onChange={set(setBio)} maxLength={BIO_MAX} aria-invalid={touched && !!errors.bio} />
      </Field>

      <ContactBlock verified={creator.contactVerified} hasProfile={creator.hasProfile} onLinked={onLinked ?? (() => onRecheck())} onRecheck={onRecheck} rechecking={rechecking} />

      <details className="card-flat pad-s">
        <summary className="bold" style={{ cursor: "pointer", minHeight: 32, display: "flex", alignItems: "center" }}>
          Resumo do que você aceita
        </summary>
        <ul className="col small" style={gap(8, { marginTop: 10 })}>
          <Bullet>Você é responsável pelo conteúdo do pacote e tem o direito de usar tudo o que está nele. Conteúdo de terceiros precisa de fonte e permissão.</Bullet>
          <Bullet>A equipe revisa cada versão antes de ir ao ar e pode pedir mudanças, recusar, suspender ou retirar um especialista.</Bullet>
          <Bullet>A taxa da plataforma sai de cada venda. O restante vai para a sua carteira.</Bullet>
          <Bullet>O especialista não pode prometer resultado financeiro, jurídico ou médico sem ressalvas, nem agir contra o usuário ou mandar os dados dele para fora.</Bullet>
        </ul>
      </details>

      <div className="col" style={gap(6)}>
        <label className="row start" style={gap(12, { cursor: "pointer", minHeight: 44 })} htmlFor="cr-termos">
          <input id="cr-termos" type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={{ width: 22, height: 22, marginTop: 1, accentColor: "var(--brand)", flex: "none" }} aria-invalid={touched && !!errors.terms} aria-describedby={touched && errors.terms ? "cr-termos-erro" : undefined} />
          <span>Li o resumo e aceito os termos para criadores do Solvers.</span>
        </label>
        {touched && errors.terms ? (
          <span id="cr-termos-erro" className="hint" style={{ color: "var(--red)" }} role="alert">
            {errors.terms}
          </span>
        ) : null}
      </div>

      {error ? (
        <Notice tone="bad" title="Não deu para salvar o cadastro" role="alert">
          {error}
        </Notice>
      ) : null}
      <div className="row wrapx" style={gap(12)}>
        <Button type="submit" size="lg" loading={saving} iconRight="arrow-right">
          {creator.hasProfile ? "Salvar e continuar" : "Salvar cadastro"}
        </Button>
      </div>
    </form>
  );
}

function ContactBlock({ verified, hasProfile, onLinked, onRecheck, rechecking }: { verified: boolean; hasProfile: boolean; onLinked: (me: CreatorMe) => void; onRecheck: () => void; rechecking: boolean }) {
  return (
    <div className="card-flat pad-s col" style={gap(10)}>
      <div className="row between wrapx" style={gap(10)}>
        <b>Contato para avisos e pedidos de ajuda</b>
        {verified ? (
          <Chip tone="ok" icon="check-circle">
            Telegram vinculado
          </Chip>
        ) : (
          <Chip tone="warn" icon="warning">
            Falta vincular
          </Chip>
        )}
      </div>
      {verified ? (
        <p className="small muted">Tudo certo: avisamos você por lá quando a equipe responder a um envio ou quando um comprador pedir ajuda.</p>
      ) : (
        <>
          <p className="small muted">
            Antes de enviar um especialista, vincule o seu Telegram. É por ele que avisamos você sobre os envios e que os compradores pedem ajuda, sem ver o seu contato. Clique em <b>Vincular Telegram</b>: o site gera um código e você o envia ao bot do Solvers.
          </p>
          {hasProfile ? (
            <TelegramLinkPanel onLinked={onLinked} onRecheck={onRecheck} rechecking={rechecking} />
          ) : (
            <p className="small muted">Salve o cadastro primeiro (nome, apresentação e termos): o botão para vincular aparece logo depois.</p>
          )}
          <p className="tiny faint">Você pode salvar o cadastro agora e vincular depois, mas o envio do pacote só abre com o contato vinculado.</p>
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
