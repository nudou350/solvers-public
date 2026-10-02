import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";

// Mesmo texto para quem não é admin e para um endereço que não existe: a área não revela que está aqui.
export default function AdminNotFound() {
  return (
    <section className="wrap sec">
      <Empty icon="search" title="Página não encontrada" action={<Button href="/">Ir para o início</Button>}>
        Este endereço não corresponde a nenhuma página do Solvers.
      </Empty>
    </section>
  );
}
