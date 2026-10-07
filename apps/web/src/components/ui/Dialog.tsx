"use client";
// Janela modal sobre o <dialog> nativo: showModal() cuida do foco preso, do Esc e de deixar a página inerte.
// Montar o componente abre a janela; `onClose` pede para quem montou desmontá-la (Esc, clique fora, botão X).
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

export type DialogProps = {
  /** Título da janela (vira o nome acessível dela). */
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Enquanto true (ex: assinando uma transação), Esc, clique fora e o botão X não fecham. */
  locked?: boolean;
  /** Largura máxima em px (padrão 480). */
  width?: number;
};

/**
 * Para o foco inicial cair num campo (e não no botão de fechar), marque-o com `data-autofocus`.
 * Ao fechar, o foco volta para o elemento que abriu a janela e a rolagem da página é liberada.
 */
export function Dialog({ title, onClose, children, locked = false, width }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const titleId = useId();
  const t = useTranslations("common.ui");

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // O "close" da limpeza do efeito chega depois que o efeito rodou de novo (StrictMode): com o dialog aberto, é eco velho.
    // Travada (assinando): o Chrome fecha no 2º Esc mesmo com preventDefault no "cancel"; reabre para a janela não sumir.
    // showModal() não dispara "close", então não há laço; a limpeza do efeito tira este ouvinte antes de fechar de propósito.
    const onNativeClose = () => {
      if (dlg.open) return;
      if (lockedRef.current && dlg.isConnected) dlg.showModal();
      else closeRef.current();
    };
    // Esc: com a janela travada, o navegador não fecha.
    const onCancel = (e: Event) => {
      if (lockedRef.current) e.preventDefault();
    };
    dlg.addEventListener("close", onNativeClose);
    dlg.addEventListener("cancel", onCancel);
    if (!dlg.open) {
      dlg.showModal();
      dlg.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    return () => {
      dlg.removeEventListener("close", onNativeClose);
      dlg.removeEventListener("cancel", onCancel);
      if (dlg.open) dlg.close();
      document.body.style.overflow = overflow;
      prev?.focus();
    };
  }, []);

  const requestClose = () => {
    if (!lockedRef.current) closeRef.current();
  };

  return (
    <dialog
      ref={ref}
      className="dlg"
      style={width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined}
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === ref.current) requestClose();
      }}
    >
      <div className="dlg-body">
        <div className="row between start" style={{ gap: 12 }}>
          <h2 id={titleId} className="h3" style={{ margin: 0 }}>
            {title}
          </h2>
          <button type="button" className="dlg-x" onClick={requestClose} aria-label={t("close")} disabled={locked}>
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
