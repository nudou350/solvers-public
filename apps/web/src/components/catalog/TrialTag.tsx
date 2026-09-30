import { Chip } from "@/components/ui/Chip";

/** Selo discreto dos cartões e listas: o especialista tem teste grátis. */
export function TrialTag() {
  return (
    <Chip tone="plain" icon="gift">
      Teste grátis
    </Chip>
  );
}
