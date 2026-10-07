"use client";
// Vincular o Telegram do criador (PACKAGE_SPEC.md 14.1): pede um código ao servidor, mostra o link que abre o bot já com o
// código e a alternativa de digitar `/vincular CODIGO`, e confere sozinho (a cada 4 s) enquanto o código vale.
import type { CreatorMe, TelegramLink } from "@solvers/api-client";
import { ApiError } from "@solvers/api-client";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Toast";
import { INTL_LOCALE, type Locale } from "@/i18n/routing";
import { useErrorText } from "@/lib/error-text";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";

const POLL_MS = 4000;

/** Texto do erro ao gerar o código, no idioma da página (códigos do servidor: telegram_unavailable, profile_required, too_many_codes). */
function useLinkErrorText(): (e: unknown) => string {
  const t = useTranslations("creator.telegram.errors");
  const errorText = useErrorText();
  return (e) => {
    if (e instanceof ApiError) {
      if (e.status === 401) return t("sessionExpired");
      if (e.code === "telegram_unavailable") return t("unavailable");
      if (e.code === "profile_required") return t("profileRequired");
      if (e.code === "too_many_codes" || e.status === 429) return e.message || t("tooMany");
      if (e.status >= 500) return t("server");
      return errorText(e);
    }
    return e instanceof Error && e.message ? e.message : t("generic");
  };
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function TelegramLinkPanel({ onLinked, onRecheck, rechecking }: { onLinked: (me: CreatorMe) => void; onRecheck: () => void; rechecking: boolean }) {
  const t = useTranslations("creator.telegram");
  const locale = useLocale() as Locale;
  const linkErrorText = useLinkErrorText();
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
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  // Confere o vínculo de tempos em tempos enquanto o código vale; ao ver o Telegram vinculado, avisa a tela.
  useEffect(() => {
    if (!live) return;
    let off = false;
    const timer = setInterval(() => {
      api
        .getCreatorMe()
        .then((me) => {
          if (!off && me.contactVerified) onLinkedRef.current(me);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      off = true;
      clearInterval(timer);
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
  }, [api, linkErrorText]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(`/vincular ${link.code}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const status = !link ? "" : expired ? t("statusExpired") : copied ? t("statusCopied") : t("statusWaiting");
  // Hora local de quem está vendo o código.
  const hhmm = (d: Date) => new Intl.DateTimeFormat(INTL_LOCALE[locale], { hour: "2-digit", minute: "2-digit" }).format(d);

  return (
    <div className="col" style={gap(12)}>
      {!link ? (
        <div className="row wrapx" style={gap(10)}>
          <Button size="sm" icon="message" loading={loading} onClick={() => void generate()}>
            {t("link")}
          </Button>
          <Button variant="secondary" size="sm" icon="refresh" loading={rechecking} onClick={onRecheck}>
            {t("recheck")}
          </Button>
        </div>
      ) : (
        <div ref={box} tabIndex={-1} className="col" style={gap(12, { outline: "none" })} aria-label={t("boxLabel")}>
          {!expired ? (
            <>
              <ol className="col small" style={gap(8, { paddingLeft: 18, listStyle: "decimal" })}>
                <li>{t.rich("step1", { b: (c) => <b>{c}</b> })}</li>
                <li>{t.rich("step2", { username: link.botUsername, handle: (c) => <span className="mono">{c}</span> })}</li>
              </ol>
              <div className="row wrapx" style={gap(10)}>
                <code className="mono bold" style={{ fontSize: 18, letterSpacing: "0.04em", userSelect: "all" }}>
                  /vincular {link.code}
                </code>
                <Button variant="ghost" size="sm" icon="copy" onClick={() => void copy()} aria-label={t("copyLabel")}>
                  {t("copy")}
                </Button>
              </div>
              <div className="row wrapx" style={gap(10)}>
                <Button href={link.deepLink} icon="external">
                  {t("open")}
                </Button>
                <Button variant="secondary" icon="refresh" loading={rechecking} onClick={onRecheck}>
                  {t("recheck")}
                </Button>
              </div>
              <p className="tiny faint">
                {t.rich("validUntil", {
                  time: hhmm(new Date(expiresAt)),
                  clock: clock(expiresAt - now),
                  tick: (c) => <span aria-hidden>{c}</span>,
                  sr: (c) => <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{c}</span>,
                })}
              </p>
            </>
          ) : (
            <div className="row wrapx" style={gap(10)}>
              <Button size="sm" icon="refresh" loading={loading} onClick={() => void generate()}>
                {t("newCode")}
              </Button>
              <Button variant="secondary" size="sm" icon="refresh" loading={rechecking} onClick={onRecheck}>
                {t("recheck")}
              </Button>
            </div>
          )}
        </div>
      )}
      <p className="small muted" role="status" aria-live="polite">
        {status}
      </p>
      {error ? (
        <Notice tone="bad" title={t("failTitle")} role="alert">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
