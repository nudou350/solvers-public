"use client";
import { Chip } from "@/components/ui/Chip";
import { useMyTrials } from "@/lib/hooks";

/**
 * Selo discreto dos cartões e listas: o especialista tem teste grátis. Com `agentId` e o usuário logado
 * que já começou o teste, mostra o saldo ("Teste: restam 2 de 3") ou que acabou.
 */
export function TrialTag({ agentId }: { agentId?: string }) {
  const trials = useMyTrials();
  const mine = agentId ? trials?.get(agentId) : undefined;
  if (mine && mine.usesLeft <= 0) {
    return (
      <Chip tone="warn" icon="lock">
        Teste esgotado
      </Chip>
    );
  }
  if (mine) {
    return (
      <Chip tone="brand" icon="gift">
        Teste: {mine.usesLeft === 1 ? "resta 1" : `restam ${mine.usesLeft}`} de {mine.uses}
      </Chip>
    );
  }
  return (
    <Chip tone="plain" icon="gift">
      Teste grátis
    </Chip>
  );
}
