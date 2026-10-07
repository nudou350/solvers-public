"use client";
import { useTranslations } from "next-intl";
import { Chip } from "@/components/ui/Chip";
import { useMyTrials } from "@/lib/hooks";

/**
 * Selo discreto dos cartões e listas: o especialista tem teste grátis. Com `agentId` e o usuário logado
 * que já começou o teste, mostra o saldo ("Trial: 2 of 3 left") ou que acabou.
 */
export function TrialTag({ agentId }: { agentId?: string }) {
  const t = useTranslations("catalog.trialTag");
  const trials = useMyTrials();
  const mine = agentId ? trials?.get(agentId) : undefined;
  if (mine && mine.usesLeft <= 0) {
    return (
      <Chip tone="warn" icon="lock">
        {t("exhausted")}
      </Chip>
    );
  }
  if (mine) {
    return (
      <Chip tone="brand" icon="gift">
        {t("left", { n: mine.usesLeft, total: mine.uses })}
      </Chip>
    );
  }
  return (
    <Chip tone="plain" icon="gift">
      {t("free")}
    </Chip>
  );
}
