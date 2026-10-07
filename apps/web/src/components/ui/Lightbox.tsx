"use client";
// Visualizador de imagens em tela cheia. Usa <dialog>.showModal(): a camada do navegador cuida do foco preso,
// do Esc e de deixar o resto da página inerte; aqui entram as setas, o clique fora, o contador e o foco de volta.
import type { ImageRef } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export function Lightbox({
  images,
  index,
  onClose,
  label,
}: {
  images: ImageRef[];
  index: number;
  onClose: () => void;
  /** Nome do grupo, lido por leitores de tela ("Solver screenshots"). */
  label?: string;
}) {
  const t = useTranslations("common.ui");
  const groupLabel = label ?? t("images");
  const ref = useRef<HTMLDialogElement>(null);
  const [i, setI] = useState(() => Math.min(Math.max(index, 0), Math.max(images.length - 1, 0)));
  const prevFocus = useRef<HTMLElement | null | undefined>(undefined);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const n = images.length;
  const go = (d: number) => setI((cur) => (cur + d + n) % n);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    // Guardado uma vez: no StrictMode o efeito roda duas vezes e, na segunda, o foco já está dentro do diálogo.
    if (prevFocus.current === undefined) prevFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prev = prevFocus.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onNativeClose = () => closeRef.current();
    dlg.addEventListener("close", onNativeClose);
    if (!dlg.open) dlg.showModal();
    return () => {
      dlg.removeEventListener("close", onNativeClose);
      // Sem dlg.close() aqui: o <dialog> sai do DOM junto com o componente. Fechar aqui dispara um evento "close"
      // assíncrono que, no StrictMode (efeito rodando duas vezes), chegaria ao listener novo e fecharia o visualizador.
      document.body.style.overflow = overflow;
      prev?.focus();
    };
  }, []);

  const cur = images[i];
  if (!cur) return null;

  return (
    <dialog
      ref={ref}
      className="lightbox"
      aria-label={groupLabel}
      onKeyDown={(e) => {
        if (n < 2) return;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(-1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          go(1);
        }
      }}
    >
      <div className="lightbox-bar">
        <button type="button" className="lightbox-btn" onClick={() => closeRef.current()} aria-label={t("close")}>
          <Icon name="x" />
        </button>
        <span className="lightbox-count" aria-live="polite">
          {t("imageCount", { i: i + 1, n })}
        </span>
      </div>
      <div
        className="lightbox-stage"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeRef.current();
        }}
      >
        {n > 1 ? (
          <button type="button" className="lightbox-btn lightbox-nav" onClick={() => go(-1)} aria-label={t("previousImage")}>
            <Icon name="arrow-left" />
          </button>
        ) : null}
        <img key={cur.id} src={cur.url} width={cur.width} height={cur.height} alt={t("imageAlt", { label: groupLabel, i: i + 1, n })} decoding="async" />
        {n > 1 ? (
          <button type="button" className="lightbox-btn lightbox-nav" onClick={() => go(1)} aria-label={t("nextImage")}>
            <Icon name="arrow-right" />
          </button>
        ) : null}
      </div>
    </dialog>
  );
}
