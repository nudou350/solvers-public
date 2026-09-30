"use client";
// Avaliar o especialista (estrelas + texto). Quem chama já sabe que a conta tem a licença; o servidor confere de novo.
// A avaliação é uma por conta: se já existe, o formulário abre com ela preenchida e "Atualizar" a substitui.
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice, useToast } from "@/components/ui/Toast";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { useTx } from "@/lib/tx";

const TEXT_MAX = 2000;
const LABELS = ["Ruim", "Fraco", "Bom", "Muito bom", "Excelente"] as const;

export function ReviewBox({
  agentId,
  slug,
  compact = false,
  onSaved,
  onCancel,
}: {
  agentId: string;
  slug: string;
  /** Sem moldura de cartão (dentro de outro cartão, como na biblioteca). */
  compact?: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const { api, me } = useSession();
  const toast = useToast();
  const router = useRouter();
  const tx = useTx();
  const textId = useId();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [had, setHad] = useState(false);
  const [touched, setTouched] = useState(false);
  const dirty = useRef(false);
  const wallet = me?.wallet ?? null;

  // Pré-preenche com a minha avaliação, se já existir (e se a pessoa ainda não começou a escrever).
  useEffect(() => {
    if (!wallet) return;
    let alive = true;
    api.getReviews(slug).then(
      (list) => {
        if (!alive) return;
        const m = list.find((r) => r.authorWallet === wallet) ?? null;
        setHad(!!m);
        if (m && !dirty.current) {
          setRating(m.rating);
          setText(m.text);
        }
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [api, slug, wallet]);

  async function publish() {
    setTouched(true);
    if (rating < 1) return;
    const r = await tx.run(() => api.buildReview(agentId, rating, text.trim()));
    if (!r) return;
    toast({ tone: "ok", title: "Avaliação publicada", text: "Obrigado por contar como foi." });
    setHad(true);
    dirty.current = false;
    router.refresh();
    onSaved?.();
  }

  const missingRating = touched && rating < 1;
  const cls = compact ? "col" : "card pad col";

  return (
    <form
      className={cls}
      style={gap(14)}
      aria-labelledby={`${textId}-t`}
      onSubmit={(e) => {
        e.preventDefault();
        void publish();
      }}
    >
      <div className="col" style={gap(2)}>
        <h3 className="h4" id={`${textId}-t`}>
          {had ? "Sua avaliação" : "Avaliar este especialista"}
        </h3>
        <span className="small muted">
          {had ? "Você já avaliou. Mude o que quiser e atualize." : "Você comprou este especialista, então a sua opinião ajuda quem vem depois."}
        </span>
      </div>
      <div className="col" style={gap(6)}>
        <div className="row" style={gap(4)} role="radiogroup" aria-label="Sua nota de 1 a 5">
          {LABELS.map((label, i) => {
            const n = i + 1;
            const on = n <= rating;
            return (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} de 5: ${label}`}
                title={label}
                onClick={() => {
                  dirty.current = true;
                  setRating(n);
                }}
                disabled={tx.pending}
                style={{
                  background: "none",
                  border: 0,
                  padding: 0,
                  width: 44,
                  height: 44,
                  fontSize: 30,
                  lineHeight: 1,
                  cursor: "pointer",
                  color: on ? "var(--star)" : "var(--line-strong)",
                }}
              >
                ★
              </button>
            );
          })}
          <span className="small muted" aria-live="polite" style={{ marginLeft: 8 }}>
            {rating > 0 ? LABELS[rating - 1] : ""}
          </span>
        </div>
        {missingRating ? (
          <span className="small warn" role="alert">
            Escolha uma nota de 1 a 5.
          </span>
        ) : null}
      </div>
      <div className="field">
        <label className="label" htmlFor={textId}>
          Conte como foi (opcional)
        </label>
        <textarea
          id={textId}
          className="textarea"
          value={text}
          maxLength={TEXT_MAX}
          placeholder="O que você pediu, o que funcionou e o que poderia melhorar."
          disabled={tx.pending}
          onChange={(e) => {
            dirty.current = true;
            setText(e.target.value);
          }}
        />
        <span className="hint num">
          {text.length}/{TEXT_MAX}
        </span>
      </div>
      <p className="tiny faint">A avaliação fica pública, com o nome do seu perfil. Não há custo para você.</p>
      {tx.error ? (
        <Notice tone="bad" role="alert" title={tx.error.title}>
          {tx.error.text}
        </Notice>
      ) : null}
      <div className="row wrapx" style={gap(10)}>
        <Button type="submit" loading={tx.pending}>
          {had ? "Atualizar avaliação" : "Publicar avaliação"}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={tx.pending}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
