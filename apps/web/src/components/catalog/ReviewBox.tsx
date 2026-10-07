"use client";
// Avaliar o especialista (estrelas + texto). Quem chama já sabe que a conta tem a licença; o servidor confere de novo.
// A avaliação é uma por conta: se já existe, o formulário abre com ela preenchida e "Atualizar" a substitui.
import { MAX_IMAGE_UPLOAD_BYTES, MAX_REVIEW_IMAGES, type ImageRef } from "@solvers/api-client";
import { useRouter } from "@/i18n/navigation";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Notice, useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api";
import { compressImage, ImageCompressError } from "@/lib/image-compress";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { useTx } from "@/lib/tx";

const TEXT_MAX = 2000;
const LABELS = ["Ruim", "Fraco", "Bom", "Muito bom", "Excelente"] as const;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MB = MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024);

/** Foto escolhida no aparelho, ainda não enviada. */
type Picked = { key: number; file: File; url: string };

/** Mensagem curta em português para uma falha de envio/remoção de foto. */
function photoErrorText(e: unknown): string {
  if (e instanceof ImageCompressError) return e.message;
  if (e instanceof ApiError) return e.code === "image_unavailable" ? "O envio de fotos está indisponível agora." : e.message;
  return "Tente de novo.";
}

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
  const [existing, setExisting] = useState<ImageRef[]>([]);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ name: string; text: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const pickedRef = useRef<Picked[]>([]);
  pickedRef.current = picked;
  const seq = useRef(0);

  // Solta as prévias locais ao sair.
  useEffect(
    () => () => {
      pickedRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    },
    [],
  );

  // Pré-preenche com a minha avaliação, se já existir (e se a pessoa ainda não começou a escrever).
  useEffect(() => {
    if (!wallet) return;
    let alive = true;
    api.getReviews(slug).then(
      (list) => {
        if (!alive) return;
        const m = list.find((r) => r.authorWallet === wallet) ?? null;
        setHad(!!m);
        setExisting(m?.images ?? []);
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

  const total = existing.length + picked.length;
  const busy = tx.pending || uploading;

  function addPhotos(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    setPhotoError(null);
    let room = MAX_REVIEW_IMAGES - existing.length - pickedRef.current.length;
    const add: Picked[] = [];
    let msg: string | null = null;
    for (const file of files) {
      if (!PHOTO_TYPES.includes(file.type)) msg = `"${file.name}" não é uma foto JPG, PNG ou WebP.`;
      else if (file.size > MAX_IMAGE_UPLOAD_BYTES) msg = `"${file.name}" passa de ${PHOTO_MB} MB.`;
      else if (room <= 0) msg = `Você pode anexar até ${MAX_REVIEW_IMAGES} fotos.`;
      else {
        add.push({ key: ++seq.current, file, url: URL.createObjectURL(file) });
        room--;
      }
    }
    if (add.length) setPicked((c) => [...c, ...add]);
    if (msg) setPhotoError(msg);
  }

  function dropPicked(key: number) {
    const p = pickedRef.current.find((x) => x.key === key);
    if (p) URL.revokeObjectURL(p.url);
    setPicked((c) => c.filter((x) => x.key !== key));
    setFailed([]);
  }

  async function removeExisting(id: string) {
    setRemoving(id);
    setPhotoError(null);
    try {
      setExisting(await api.deleteReviewImage(slug, id));
      router.refresh();
    } catch (e) {
      setPhotoError(`Não deu para remover a foto. ${photoErrorText(e)}`);
    } finally {
      setRemoving(null);
    }
  }

  /** Envia as fotos escolhidas, uma por vez. As que falham ficam na lista para tentar de novo. */
  async function uploadPicked(): Promise<boolean> {
    const queue = pickedRef.current;
    if (queue.length === 0) return true;
    setUploading(true);
    setFailed([]);
    const errors: { name: string; text: string }[] = [];
    for (const p of queue) {
      try {
        // Reduz no navegador: o nginx só aceita corpo de até 2 MB. O tipo do blob vai no Content-Type.
        setExisting(await api.uploadReviewImage(slug, await compressImage(p.file)));
        URL.revokeObjectURL(p.url);
        setPicked((c) => c.filter((x) => x.key !== p.key));
      } catch (e) {
        errors.push({ name: p.file.name, text: photoErrorText(e) });
        // Sem sentido insistir quando o problema vale para todas (limite, sessão, CDN fora).
        if (e instanceof ApiError && (e.code === "image_limit" || e.code === "image_unavailable" || e.status === 401)) break;
      }
    }
    setFailed(errors);
    setUploading(false);
    return errors.length === 0;
  }

  async function publish() {
    setTouched(true);
    if (rating < 1) return;
    const r = await tx.run(() => api.buildReview(agentId, rating, text.trim()));
    if (!r) return;
    setHad(true);
    dirty.current = false;
    const photosOk = await uploadPicked();
    router.refresh();
    if (photosOk) {
      toast({ tone: "ok", title: "Avaliação publicada", text: "Obrigado por contar como foi." });
      onSaved?.();
    } else {
      // A avaliação não é desfeita; o formulário fica aberto (sem onSaved) para tentar as fotos de novo.
      toast({ tone: "warn", title: "Avaliação publicada, mas faltam fotos", text: "Veja o aviso no formulário para enviar de novo." });
    }
  }

  /** Só as fotos, sem publicar a avaliação de novo (ela já existe). */
  async function sendPhotosOnly() {
    if (!(await uploadPicked())) return;
    toast({ tone: "ok", title: "Fotos enviadas" });
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
                disabled={busy}
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
          disabled={busy}
          onChange={(e) => {
            dirty.current = true;
            setText(e.target.value);
          }}
        />
        <span className="hint num">
          {text.length}/{TEXT_MAX}
        </span>
      </div>
      <div className="field">
        <span className="label" id={`${textId}-p`}>
          Fotos (opcional)
        </span>
        <div className="photo-grid" role="group" aria-labelledby={`${textId}-p`} style={{ paddingBottom: 0 }}>
          {existing.map((im) => (
            <div key={im.id} className="photo-slot">
              <span className="photo-thumb">
                <img src={im.thumbUrl} alt="Foto anexada à sua avaliação" width={88} height={88} loading="lazy" decoding="async" />
              </span>
              <button type="button" className="photo-x" aria-label="Remover foto anexada" disabled={busy || removing === im.id} onClick={() => void removeExisting(im.id)}>
                <Icon name="x" size="s" />
              </button>
            </div>
          ))}
          {picked.map((p) => (
            <div key={p.key} className="photo-slot">
              <span className="photo-thumb">
                <img src={p.url} alt={`Prévia de ${p.file.name}`} width={88} height={88} />
              </span>
              <button type="button" className="photo-x" aria-label={`Tirar ${p.file.name}`} disabled={busy} onClick={() => dropPicked(p.key)}>
                <Icon name="x" size="s" />
              </button>
            </div>
          ))}
          {total < MAX_REVIEW_IMAGES ? (
            <label className={["photo-add", busy ? "is-off" : ""].filter(Boolean).join(" ")}>
              <Icon name="upload" />
              <span>Adicionar foto</span>
              <input type="file" accept={PHOTO_TYPES.join(",")} multiple disabled={busy} onChange={addPhotos} />
            </label>
          ) : null}
        </div>
        <span className="hint">
          Até {MAX_REVIEW_IMAGES} fotos (JPG, PNG ou WebP, {PHOTO_MB} MB cada), enviadas depois que a avaliação for publicada. Cubra dados pessoais (valores, nomes, documentos) antes de enviar.
        </span>
        {photoError ? (
          <span className="small warn" role="alert">
            {photoError}
          </span>
        ) : null}
      </div>
      {failed.length ? (
        <Notice tone="warn" role="alert" title="Algumas fotos não subiram">
          {failed.map((f) => `${f.name}: ${f.text}`).join(" ")} A avaliação já está publicada; tente enviar as fotos de novo.
        </Notice>
      ) : null}
      <p className="tiny faint">A avaliação fica pública, com o nome do seu perfil. Não há custo para você.</p>
      {tx.error ? (
        <Notice tone="bad" role="alert" title={tx.error.title}>
          {tx.error.text}
        </Notice>
      ) : null}
      <div className="row wrapx" style={gap(10)}>
        <Button type="submit" loading={busy}>
          {had ? "Atualizar avaliação" : "Publicar avaliação"}
        </Button>
        {had && picked.length > 0 ? (
          <Button variant="secondary" onClick={() => void sendPhotosOnly()} disabled={busy}>
            Enviar só as fotos
          </Button>
        ) : null}
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
