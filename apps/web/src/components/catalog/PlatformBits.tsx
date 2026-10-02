import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { DIFFERENTIATORS, differentiatorLabel, knownDifferentiators } from "@/lib/differentiators";
import { gap } from "@/lib/style";

/**
 * Selos dos diferenciais comprovados (memória, atendimento do criador, dado vivo...). Sem diferenciais, não mostra nada.
 * `max` limita quantos aparecem nos cartões estreitos; o resto vira "+N".
 */
export function DifferentiatorBadges({ keys, max }: { keys: readonly string[]; max?: number }) {
  const list = knownDifferentiators(keys);
  if (list.length === 0) return null;
  const shown = max ? list.slice(0, max) : list;
  const rest = list.length - shown.length;
  return (
    <ul className="row wrapx" style={gap("6px")} aria-label="Diferenciais comprovados">
      {shown.map((k) => (
        <li key={k}>
          <Chip tone="brand" icon={DIFFERENTIATORS[k]?.icon}>
            {differentiatorLabel(k)}
          </Chip>
        </li>
      ))}
      {rest > 0 ? (
        <li>
          <Chip>+{rest}</Chip>
        </li>
      ) : null}
    </ul>
  );
}

/** Bloco que substitui o preço nos cartões e na busca de especialistas da plataforma. */
export function FreeTag() {
  return (
    <div>
      <div className="bold" style={{ fontSize: 20 }}>
        Gratuito
      </div>
      <div className="tiny faint">Incluído na plataforma</div>
    </div>
  );
}

/** Mesma informação em uma linha, para listas compactas. */
export function FreeInline() {
  return (
    <b className="row" style={gap("6px")}>
      <Icon name="gift" size="s" />
      Gratuito
    </b>
  );
}
