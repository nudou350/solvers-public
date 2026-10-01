"use client";
// Pedido de ajuda ao criador. A mensagem vai pelo servidor (o criador é avisado e recebe um protocolo);
// o contato do criador nunca aparece aqui. O contato do cliente é opcional, para a resposta chegar.
import { ApiError } from "@solvers/api-client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/Toast";
import { useSession } from "@/lib/session";
import s from "./checkout.module.css";

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 2000;
const CONTACT_MAX = 200;

export function HelpDialog({ slug, creatorName, onClose }: { slug: string; creatorName: string; onClose: () => void }) {
  const { api } = useSession();
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
      // Erros da API vêm em português (limite, validação); o resto (rede, proxy) ganha um texto nosso.
      setError(e instanceof ApiError && e.code !== "error" && e.code !== "internal" ? e.message : "Não deu para enviar agora. Tente de novo em instantes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={protocol ? "Pedido enviado" : `Pedir ajuda a ${creatorName}`} onClose={onClose}>
      {protocol ? (
        <>
          <Notice tone="ok" title={`Protocolo ${protocol}`}>
            {creatorName} foi avisado.{" "}
            {contact.trim() ? "A resposta vai para o contato que você informou." : "Você não informou um contato, então a resposta pode demorar a chegar até você."}
          </Notice>
          <Button onClick={() => onClose()}>Fechar</Button>
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
              data-autofocus
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
            <Button type="button" variant="ghost" onClick={() => onClose()} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" loading={busy} disabled={tooShort} icon="message">
              Enviar pedido
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
