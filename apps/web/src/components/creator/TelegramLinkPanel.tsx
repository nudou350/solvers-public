"use client";
// Vincular o Telegram do criador (PACKAGE_SPEC.md 14.1): pede um código ao servidor, mostra o link que abre o bot já com o
// código e a alternativa de digitar `/vincular CODIGO`, e confere sozinho (a cada 4 s) enquanto o código vale.
import type { CreatorMe, TelegramLink } from "@solvers/api-client";
import { ApiError } from "@solvers/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Toast";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";

const POLL_MS = 4000;

function linkErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Sua sessão expirou. Entre de novo e tente outra vez.";
    if (e.code === "telegram_unavailable") return "A vinculação pelo Telegram está fora do ar agora. Tente de novo em alguns minutos ou fale com a equipe.";
    if (e.code === "profile_required") return "Salve o seu cadastro (nome, apresentação e termos) antes de vincular o Telegram.";
    if (e.code === "too_many_codes" || e.status === 429) return e.message || "Você gerou muitos códigos seguidos. Espere um pouco e tente de novo.";
    if (e.status >= 500) return "O servidor não respondeu bem. Tente de novo em instantes.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Não deu para gerar o código agora.";
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const hhmm = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function TelegramLinkPanel({ onLinked, onRecheck, rechecking }: { onLinked: (me: CreatorMe) => void; onRecheck: () => void; rechecking: boolean }) {
  const { api } = useSession();
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const box = useRef<HTMLDivElement>(null);
  const onLinkedRef = useRef(onLinked);
  onLinkedRef.current = onLinked;

  const expiresAt = link ? new Date(link.expiresAt).getTime() : 0;
  const live = !!link && now < expiresAt;
  const expired = !!link && !live;

  // Relógio da contagem: só enquanto há um código na tela e ele ainda vale.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  // Confere o vínculo de tempos em tempos enquanto o código vale; ao ver o Telegram vinculado, avisa a tela.
  useEffect(() => {
    if (!live) return;
    let off = false;
    const t = setInterval(() => {
      api
        .getCreatorMe()
        .then((me) => {
          if (!off && me.contactVerified) onLinkedRef.current(me);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [live, api]);

  // Com o código novo na tela, o foco vai para ele (leitor de tela e teclado).
  useEffect(() => {
    if (link) box.current?.focus();
  }, [link]);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const l = await api.createTelegramLink();
      setNow(Date.now());
      setLink(l);
    } catch (e) {
      setError(linkErrorText(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(`/vincular ${link.code}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const status = !link ? "" : expired ? "O código venceu. Gere um novo para continuar." : copied ? "Comando copiado. Cole no chat com o bot." : "Esperando você enviar o código ao bot. Vamos avisar aqui assim que chegar.";

  return (
    <div className="col" style={gap(12)}>
      {!link ? (
        <div className="row wrapx" style={gap(10)}>
          <Button size="sm" icon="message" loading={loading} onClick={() => void generate()}>
            Vincular Telegram
          </Button>
          <Button variant="secondary" size="sm" icon="refresh" loading={rechecking} onClick={onRecheck}>
            Já vinculei, verificar
          </Button>
        </div>
      ) : (
        <div ref={box} tabIndex={-1} className="col" style={gap(12, { outline: "none" })} aria-label="Código para vincular o Telegram">
          {!expired ? (
            <>
              <ol className="col small" style={gap(8, { paddingLeft: 18, listStyle: "decimal" })}>
                <li>
                  Toque em <b>Abrir no Telegram</b> e depois em <b>Começar</b>. O código já vai preenchido.
                </li>
                <li>
                  Se preferir, procure <span className="mono">@{link.botUsername}</span> no Telegram e envie:
                </li>
              </ol>
              <div className="row wrapx" style={gap(10)}>
                <code className="mono bold" style={{ fontSize: 18, letterSpacing: "0.04em", userSelect: "all" }}>
                  /vincular {link.code}
                </code>
                <Button variant="ghost" size="sm" icon="copy" onClick={() => void copy()} aria-label="Copiar o comando de vinculação">
                  Copiar
                </Button>
              </div>
              <div className="row wrapx" style={gap(10)}>
                <Button href={link.deepLink} icon="external">
                  Abrir no Telegram
                </Button>
                <Button variant="secondary" icon="refresh" loading={rechecking} onClick={onRecheck}>
                  Já vinculei, verificar
                </Button>
              </div>
              <p className="tiny faint">
                O código vale até {hhmm(new Date(expiresAt))} (<span aria-hidden>{clock(expiresAt - now)}</span>
                <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}> restantes</span>) e só funciona uma vez.
              </p>
            </>
          ) : (
            <div className="row wrapx" style={gap(10)}>
              <Button size="sm" icon="refresh" loading={loading} onClick={() => void generate()}>
                Gerar um código novo
              </Button>
              <Button variant="secondary" size="sm" icon="refresh" loading={rechecking} onClick={onRecheck}>
                Já vinculei, verificar
              </Button>
            </div>
          )}
        </div>
      )}
      <p className="small muted" role="status" aria-live="polite">
        {status}
      </p>
      {error ? (
        <Notice tone="bad" title="Não deu para gerar o código" role="alert">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
