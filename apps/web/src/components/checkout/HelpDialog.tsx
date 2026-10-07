"use client";
// Pedido de ajuda ao criador. A mensagem vai pelo servidor (o criador é avisado e recebe um protocolo);
// o contato do criador nunca aparece aqui. O contato do cliente é opcional, para a resposta chegar.
import { ApiError } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/Toast";
import { useErrorText } from "@/lib/error-text";
import { useSession } from "@/lib/session";
import s from "./checkout.module.css";

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 2000;
const CONTACT_MAX = 200;

export function HelpDialog({ slug, creatorName, onClose }: { slug: string; creatorName: string; onClose: () => void }) {
  const { api } = useSession();
  const t = useTranslations("install");
  const errorText = useErrorText();
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<string | null>(null);
  const messageId = useId();
  const contactId = useId();

  const trimmed = message.trim();
  const tooShort = trimmed.length < MESSAGE_MIN;

  async function send() {
    if (busy || tooShort) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestHelp(slug, trimmed, contact.trim() || undefined);
      setProtocol(r.protocol);
    } catch (e) {
      // Erros da API (limite, validação) são traduzidos por code; o resto (rede, proxy) ganha um texto nosso.
      setError(e instanceof ApiError && e.code !== "error" && e.code !== "internal" ? errorText(e) : t("help.sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={protocol ? t("help.titleSent") : t("help.title", { name: creatorName })} onClose={onClose}>
      {protocol ? (
        <>
          <Notice tone="ok" title={t("help.protocol", { protocol })}>
            {t("help.notified", { name: creatorName })}{" "}
            {contact.trim() ? t("help.withContact") : t("help.withoutContact")}
          </Notice>
          <Button onClick={() => onClose()}>{t("help.close")}</Button>
        </>
      ) : (
        <form
          className={s.helpForm}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="field">
            <label className="label" htmlFor={messageId}>
              {t("help.label")}
            </label>
            <textarea
              id={messageId}
              className="textarea"
              value={message}
              maxLength={MESSAGE_MAX}
              placeholder={t("help.placeholder")}
              disabled={busy}
              data-autofocus
              onChange={(e) => setMessage(e.target.value)}
            />
            <span className="hint num">
              {trimmed.length}/{MESSAGE_MAX}
            </span>
          </div>
          <div className="field">
            <label className="label" htmlFor={contactId}>
              {t("help.contactLabel", { name: creatorName })}
            </label>
            <input
              id={contactId}
              className="input"
              value={contact}
              maxLength={CONTACT_MAX}
              placeholder={t("help.contactPlaceholder")}
              disabled={busy}
              autoComplete="email"
              onChange={(e) => setContact(e.target.value)}
            />
          </div>
          {error ? (
            <Notice tone="bad" role="alert">
              {error}
            </Notice>
          ) : null}
          <div className="row end" style={{ gap: 8 }}>
            <Button type="button" variant="ghost" onClick={() => onClose()} disabled={busy}>
              {t("help.cancel")}
            </Button>
            <Button type="submit" loading={busy} disabled={tooShort} icon="message">
              {t("help.send")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
