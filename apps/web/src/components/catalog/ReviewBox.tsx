"use client";
// Avaliar o especialista (estrelas + texto). Quem chama já sabe que a conta tem a licença; o servidor confere de novo.
// A avaliação é uma por conta: se já existe, o formulário abre com ela preenchida e "Atualizar" a substitui.
import { MAX_IMAGE_UPLOAD_BYTES, MAX_REVIEW_IMAGES, type ImageRef } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Notice, useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api";
import { compressImage, ImageCompressError } from "@/lib/image-compress";
import { useErrorText } from "@/lib/error-text";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { useTx } from "@/lib/tx";

const TEXT_MAX = 2000;
const LABEL_KEYS = ["label1", "label2", "label3", "label4", "label5"] as const;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MB = MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024);

/** Foto escolhida no aparelho, ainda não enviada. */
type Picked = { key: number; file: File; url: string };

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
  const t = useTranslations("catalog.review");
  const errorText = useErrorText();
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

  /** Mensagem curta, no idioma da página, para uma falha de envio/remoção de foto. */
  function photoErrorText(e: unknown): string {
    if (e instanceof ImageCompressError) return e.message;
    if (e instanceof ApiError) return e.code === "image_unavailable" ? t("photoUnavailable") : errorText(e);
    return t("tryAgain");
  }

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
      if (!PHOTO_TYPES.includes(file.type)) msg = t("notPhoto", { name: file.name });
      else if (file.size > MAX_IMAGE_UPLOAD_BYTES) msg = t("tooBig", { name: file.name, mb: PHOTO_MB });
      else if (room <= 0) msg = t("tooMany", { max: MAX_REVIEW_IMAGES });
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
      setPhotoError(t("removeFailed", { detail: photoErrorText(e) }));
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
      toast({ tone: "ok", title: t("toastOk"), text: t("toastOkText") });
      onSaved?.();
    } else {
      // A avaliação não é desfeita; o formulário fica aberto (sem onSaved) para tentar as fotos de novo.
      toast({ tone: "warn", title: t("toastPartial"), text: t("toastPartialText") });
    }
  }

  /** Só as fotos, sem publicar a avaliação de novo (ela já existe). */
  async function sendPhotosOnly() {
    if (!(await uploadPicked())) return;
    toast({ tone: "ok", title: t("toastPhotos") });
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
          {had ? t("titleEdit") : t("titleNew")}
        </h3>
        <span className="small muted">
          {had ? t("subEdit") : t("subNew")}
        </span>
      </div>
      <div className="col" style={gap(6)}>
        <div className="row" style={gap(4)} role="radiogroup" aria-label={t("ratingGroup")}>
          {LABEL_KEYS.map((labelKey, i) => {
            const label = t(labelKey);
            const n = i + 1;
            const on = n <= rating;
            return (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={t("ratingOption", { n, label })}
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
            {rating > 0 ? t(LABEL_KEYS[rating - 1] ?? "label1") : ""}
          </span>
        </div>
        {missingRating ? (
          <span className="small warn" role="alert">
            {t("pickRating")}
          </span>
        ) : null}
      </div>
      <div className="field">
        <label className="label" htmlFor={textId}>
          {t("textLabel")}
        </label>
        <textarea
          id={textId}
          className="textarea"
          value={text}
          maxLength={TEXT_MAX}
          placeholder={t("textPlaceholder")}
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
          {t("photosLabel")}
        </span>
        <div className="photo-grid" role="group" aria-labelledby={`${textId}-p`} style={{ paddingBottom: 0 }}>
          {existing.map((im) => (
            <div key={im.id} className="photo-slot">
              <span className="photo-thumb">
                <img src={im.thumbUrl} alt={t("attachedAlt")} width={88} height={88} loading="lazy" decoding="async" />
              </span>
              <button type="button" className="photo-x" aria-label={t("removeAttached")} disabled={busy || removing === im.id} onClick={() => void removeExisting(im.id)}>
                <Icon name="x" size="s" />
              </button>
            </div>
          ))}
          {picked.map((p) => (
            <div key={p.key} className="photo-slot">
              <span className="photo-thumb">
                <img src={p.url} alt={t("previewAlt", { name: p.file.name })} width={88} height={88} />
              </span>
              <button type="button" className="photo-x" aria-label={t("removePicked", { name: p.file.name })} disabled={busy} onClick={() => dropPicked(p.key)}>
                <Icon name="x" size="s" />
              </button>
            </div>
          ))}
          {total < MAX_REVIEW_IMAGES ? (
            <label className={["photo-add", busy ? "is-off" : ""].filter(Boolean).join(" ")}>
              <Icon name="upload" />
              <span>{t("addPhoto")}</span>
              <input type="file" accept={PHOTO_TYPES.join(",")} multiple disabled={busy} onChange={addPhotos} />
            </label>
          ) : null}
        </div>
        <span className="hint">
          {t("photosHint", { max: MAX_REVIEW_IMAGES, mb: PHOTO_MB })}
        </span>
        {photoError ? (
          <span className="small warn" role="alert">
            {photoError}
          </span>
        ) : null}
      </div>
      {failed.length ? (
        <Notice tone="warn" role="alert" title={t("failedTitle")}>
          {t("failedBody", { list: failed.map((f) => `${f.name}: ${f.text}`).join(" ") })}
        </Notice>
      ) : null}
      <p className="tiny faint">{t("publicNote")}</p>
      {tx.error ? (
        <Notice tone="bad" role="alert" title={tx.error.title}>
          {tx.error.text}
        </Notice>
      ) : null}
      <div className="row wrapx" style={gap(10)}>
        <Button type="submit" loading={busy}>
          {had ? t("update") : t("publish")}
        </Button>
        {had && picked.length > 0 ? (
          <Button variant="secondary" onClick={() => void sendPhotosOnly()} disabled={busy}>
            {t("photosOnly")}
          </Button>
        ) : null}
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
