"use client";
// Imagens do especialista: imagem principal grande com miniaturas embaixo (as capturas do criador) e miniaturas
// das fotos que o comprador anexou à avaliação. Clicar na imagem principal ou nas fotos abre o Lightbox.
import type { ImageRef } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Lightbox } from "@/components/ui/Lightbox";

const SWIPE_MIN_PX = 40;

/** Galeria do criador. Sem imagens, não renderiza nada. */
export function Gallery({ images, name }: { images: ImageRef[]; name: string }) {
  const t = useTranslations("catalog.gallery");
  const GALLERY_LABEL = t("label");
  const [cur, setCur] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const touchX = useRef<number | null>(null);
  const n = images.length;
  const main = images[cur];
  if (!main) return null;
  const go = (d: number) => setCur((c) => (c + d + n) % n);
  return (
    <section
      aria-label={GALLERY_LABEL}
      className="gal"
      onKeyDown={(e) => {
        // O Lightbox fica dentro desta seção: as setas dele sobem até aqui e não devem mexer na galeria por trás.
        if (n < 2 || open != null) return;
        if (e.key === "ArrowLeft") go(-1);
        else if (e.key === "ArrowRight") go(1);
      }}
    >
      <h2 className="sr-only">{GALLERY_LABEL}</h2>
      <div
        className="gal-stage"
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const start = touchX.current;
          touchX.current = null;
          const end = e.changedTouches[0]?.clientX;
          if (n < 2 || start == null || end == null || Math.abs(end - start) < SWIPE_MIN_PX) return;
          go(end < start ? 1 : -1);
        }}
      >
        <button type="button" className="gal-main" onClick={() => setOpen(cur)} aria-label={t("enlarge", { n: cur + 1, total: n, name })}>
          <img key={main.id} src={main.url} alt="" width={main.width} height={main.height} decoding="async" />
        </button>
        {n > 1 ? (
          <>
            <button type="button" className="gal-nav gal-prev" onClick={() => go(-1)} aria-label={t("prev")}>
              <Icon name="arrow-left" />
            </button>
            <button type="button" className="gal-nav gal-next" onClick={() => go(1)} aria-label={t("next")}>
              <Icon name="arrow-right" />
            </button>
            <span className="gal-count" aria-hidden>
              {cur + 1}/{n}
            </span>
          </>
        ) : null}
      </div>
      {n > 1 ? (
        <ul className="gal-thumbs">
          {images.map((im, i) => (
            <li key={im.id}>
              <button type="button" className="gal-thumb" aria-current={i === cur} onClick={() => setCur(i)} aria-label={t("view", { n: i + 1, total: n })}>
                <img src={im.thumbUrl} alt="" width={im.width} height={im.height} loading="lazy" decoding="async" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open != null ? <Lightbox images={images} index={open} label={GALLERY_LABEL} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

/** Miniaturas das fotos de uma avaliação (até 3). */
export function ReviewPhotos({ images, who }: { images: ImageRef[]; who: string }) {
  const t = useTranslations("catalog.gallery");
  const [open, setOpen] = useState<number | null>(null);
  if (images.length === 0) return null;
  const label = t("photosOf", { who });
  return (
    <>
      <ul className="row wrapx" style={{ gap: 8, listStyle: "none", padding: 0, margin: 0 }} aria-label={label}>
        {images.map((im, i) => (
          <li key={im.id}>
            <button type="button" className="photo-thumb" onClick={() => setOpen(i)} aria-label={t("enlargePhoto", { n: i + 1, total: images.length, who })}>
              <img src={im.thumbUrl} alt="" width={72} height={72} loading="lazy" decoding="async" />
            </button>
          </li>
        ))}
      </ul>
      {open != null ? <Lightbox images={images} index={open} label={label} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
