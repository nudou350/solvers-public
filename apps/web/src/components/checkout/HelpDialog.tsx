"use client";
// Pedido de ajuda ao criador. A mensagem vai pelo servidor (o criador é avisado e recebe um protocolo);
// o contato do criador nunca aparece aqui. O contato do cliente é opcional, para a resposta chegar.
import { ApiError } from "@solvers/api-client";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Toast";
import { useSession } from "@/lib/session";
import s from "./checkout.module.css";

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 2000;
const CONTACT_MAX = 200;

export function HelpDialog({ slug, creatorName, onClose }: { slug: string; creatorName: string; onClose: () => void }) {
  const { api } = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<string | null>(null);
  const messageId = useId();
  const contactId = useId();

  // <dialog>.showModal() cuida do foco preso, do Esc e de deixar a página inerte.
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // O "close" da limpeza do efeito chega depois que o efeito rodou de novo (StrictMode): com o dialog aberto, é eco velho.
    const onNativeClose = () => {
      if (!dlg.open) closeRef.current();
    };
    dlg.addEventListener("close", onNativeClose);
    if (!dlg.open) dlg.showModal();
    return () => {
      dlg.removeEventListener("close", onNativeClose);
      if (dlg.open) dlg.close();
      document.body.style.overflow = overflow;
      prev?.focus();
    };
  }, []);

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
      // Erros da API vêm em português (limite, validação); o resto (rede, proxy) ganha um texto nosso.
      setError(e instanceof ApiError && e.code !== "error" && e.code !== "internal" ? e.message : "Não deu para enviar agora. Tente de novo em instantes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className={s.helpDialog}
      aria-labelledby={`${messageId}-title`}
      onClick={(e) => {
        if (e.target === ref.current) closeRef.current();
      }}
    >
      <div className={s.helpBody}>
        <div className="row between start" style={{ gap: 12 }}>
          <h2 id={`${messageId}-title`} className="h3" style={{ margin: 0 }}>
            {protocol ? "Pedido enviado" : `Pedir ajuda a ${creatorName}`}
          </h2>
          <button type="button" className={s.helpClose} onClick={() => closeRef.current()} aria-label="Fechar">
            <Icon name="x" />
          </button>
        </div>
        {protocol ? (
          <>
            <Notice tone="ok" title={`Protocolo ${protocol}`}>
              {creatorName} foi avisado.{" "}
              {contact.trim() ? "A resposta vai para o contato que você informou." : "Você não informou um contato, então a resposta pode demorar a chegar até você."}
            </Notice>
            <Button onClick={() => closeRef.current()}>Fechar</Button>
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
                O que aconteceu?
              </label>
              <textarea
                id={messageId}
                className="textarea"
                value={message}
                maxLength={MESSAGE_MAX}
                placeholder="Em que passo você parou e o que apareceu na tela."
                disabled={busy}
                autoFocus
                onChange={(e) => setMessage(e.target.value)}
              />
              <span className="hint num">
                {trimmed.length}/{MESSAGE_MAX}
              </span>
            </div>
            <div className="field">
              <label className="label" htmlFor={contactId}>
                Como {creatorName} pode te responder? (opcional)
              </label>
              <input
                id={contactId}
                className="input"
                value={contact}
                maxLength={CONTACT_MAX}
                placeholder="E-mail ou @ do Telegram"
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
              <Button type="button" variant="ghost" onClick={() => closeRef.current()} disabled={busy}>
                Cancelar
              </Button>
              <Button type="submit" loading={busy} disabled={tooShort} icon="message">
                Enviar pedido
              </Button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
