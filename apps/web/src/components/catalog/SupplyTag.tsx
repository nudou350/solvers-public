import type { AgentSupply } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { Chip } from "@/components/ui/Chip";

/**
 * Selo dos cartões e listas para especialistas com número limitado de licenças: "3 of 10 left" ou "Sold out".
 * Sem teto (ou dado antigo sem `supply`) não mostra nada.
 */
export function SupplyTag({ supply }: { supply?: AgentSupply }) {
  const t = useTranslations("catalog.supply");
  if (!supply || supply.max == null || supply.left == null) return null;
  if (supply.left === 0) {
    return (
      <Chip tone="red" icon="lock">
        {t("soldOut")}
      </Chip>
    );
  }
  return (
    <Chip tone="brand" icon="tag">
      {t("left", { left: supply.left, max: supply.max })}
    </Chip>
  );
}
