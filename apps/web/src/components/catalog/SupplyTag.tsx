import type { AgentSupply } from "@solvers/api-client";
import { Chip } from "@/components/ui/Chip";

/**
 * Selo dos cartões e listas para especialistas com número limitado de licenças: "Restam 3 de 10" ou "Esgotado".
 * Sem teto (ou dado antigo sem `supply`) não mostra nada.
 */
export function SupplyTag({ supply }: { supply?: AgentSupply }) {
  if (!supply || supply.max == null || supply.left == null) return null;
  if (supply.left === 0) {
    return (
      <Chip tone="red" icon="lock">
        Esgotado
      </Chip>
    );
  }
  return (
    <Chip tone="brand" icon="tag">
      Restam {supply.left} de {supply.max}
    </Chip>
  );
}
