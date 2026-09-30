import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";

export default function AgentNotFound() {
  return (
    <section className="wrap sec">
      <Empty icon="search" title="Especialista não encontrado" action={<Button href="/">Explorar especialistas</Button>}>
        Este endereço não corresponde a nenhum especialista da vitrine. Ele pode ter saído do ar ou o link está incompleto.
      </Empty>
    </section>
  );
}
