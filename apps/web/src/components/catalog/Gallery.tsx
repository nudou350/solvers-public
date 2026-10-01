"use client";
// Imagens do especialista: faixa rolável do criador (como as capturas da Play Store) e miniaturas das fotos
// que o comprador anexou à avaliação. Clicar em qualquer uma abre o Lightbox.
import type { ImageRef } from "@solvers/api-client";
import { useState } from "react";
import { Lightbox } from "@/components/ui/Lightbox";

const GALLERY_LABEL = "Capturas do especialista";

/** Galeria do criador. Sem imagens, não renderiza nada. */
export function Gallery({ images, name }: { images: ImageRef[]; name: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (images.length === 0) return null;
  return (
    <section aria-label={GALLERY_LABEL}>
      <h2 className="sr-only">{GALLERY_LABEL}</h2>
      <ul className="gallery">
        {images.map((im, i) => (
          <li key={im.id} className="gallery-item" style={{ aspectRatio: `${im.width} / ${im.height}` }}>
            <button type="button" onClick={() => setOpen(i)} aria-label={`Ampliar captura ${i + 1} de ${images.length} de ${name}`}>
              <img src={im.thumbUrl} alt="" width={im.width} height={im.height} loading="lazy" decoding="async" />
            </button>
          </li>
        ))}
      </ul>
      {open != null ? <Lightbox images={images} index={open} label={GALLERY_LABEL} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

/** Miniaturas das fotos de uma avaliação (até 3). */
export function ReviewPhotos({ images, who }: { images: ImageRef[]; who: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (images.length === 0) return null;
  const label = `Fotos de ${who}`;
  return (
    <>
      <ul className="row wrapx" style={{ gap: 8, listStyle: "none", padding: 0, margin: 0 }} aria-label={label}>
        {images.map((im, i) => (
          <li key={im.id}>
            <button type="button" className="photo-thumb" onClick={() => setOpen(i)} aria-label={`Ampliar foto ${i + 1} de ${images.length} de ${who}`}>
              <img src={im.thumbUrl} alt="" width={72} height={72} loading="lazy" decoding="async" />
            </button>
          </li>
        ))}
      </ul>
      {open != null ? <Lightbox images={images} index={open} label={label} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
