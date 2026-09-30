export type SpinnerProps = { size?: "s" | "m" | "l"; label?: string; className?: string };

/** Indicador de carregamento. Com `label`, anuncia o texto para leitores de tela. */
export function Spinner({ size = "m", label, className }: SpinnerProps) {
  return (
    <span
      className={["spin", size !== "m" ? `spin-${size}` : "", className ?? ""].filter(Boolean).join(" ")}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** Bloco de carregamento de uma seção inteira: spinner + texto. */
export function Loading({ text = "Carregando…" }: { text?: string }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <Spinner />
      <span className="small">{text}</span>
    </div>
  );
}
