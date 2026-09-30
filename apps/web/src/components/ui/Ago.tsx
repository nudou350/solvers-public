import { ago } from "@/lib/format";

/**
 * Tempo relativo ("há 3 dias") com a data completa no title. O texto pode mudar entre o SSR e a hidratação
 * (o relógio andou): o aviso é suprimido só neste nó.
 */
export function Ago({ iso, className }: { iso: string; className?: string }) {
  return (
    <time className={className} dateTime={iso} title={new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} suppressHydrationWarning>
      {ago(iso)}
    </time>
  );
}
