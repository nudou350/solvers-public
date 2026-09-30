import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";

/** Especialista ausente (slug errado) ou API fora do ar. */
export function AgentMissing({ error }: { error: "not_found" | "unavailable" | null }) {
  return (
    <section className="wrap" style={{ paddingTop: 56, paddingBottom: 72 }}>
      {error === "unavailable" ? (
        <Empty icon="warning" title="Não deu para carregar o especialista" action={<Button href="/">Voltar para o início</Button>}>
          O servidor não respondeu agora. Tente de novo em instantes.
        </Empty>
      ) : (
        <Empty icon="search" title="Especialista não encontrado" action={<Button href="/">Explorar especialistas</Button>}>
          O link pode estar incompleto. Escolha um especialista na vitrine para continuar.
        </Empty>
      )}
    </section>
  );
}
