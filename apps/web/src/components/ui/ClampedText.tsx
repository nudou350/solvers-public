"use client";
// Parágrafo longo recolhido em poucas linhas, com "Ver mais" só quando o texto realmente passa do limite.
import { useEffect, useId, useRef, useState } from "react";

export function ClampedText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Só mede enquanto recolhido: expandido, scrollHeight == clientHeight e o botão "Ver menos" sumiria.
    const measure = () => {
      if (!expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, text]);

  return (
    <div className="col" style={{ gap: 6, maxWidth: 720 }}>
      <p id={id} ref={ref} className={expanded ? undefined : "clamp"} style={style}>
        {text}
      </p>
      {overflows || expanded ? (
        <button type="button" className="clamp-btn" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Ver menos" : "Ver mais"}
        </button>
      ) : null}
    </div>
  );
}
