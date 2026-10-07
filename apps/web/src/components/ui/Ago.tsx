import { useFormat } from "@/lib/format";

/**
 * Tempo relativo ("3 days ago") com a data completa no title. O texto pode mudar entre o SSR e a hidratação
 * (o relógio andou): o aviso é suprimido só neste nó.
 */
export function Ago({ iso, className }: { iso: string; className?: string }) {
  const f = useFormat();
  return (
    <time className={className} dateTime={iso} title={f.dateTime(iso)} suppressHydrationWarning>
      {f.ago(iso)}
    </time>
  );
}
