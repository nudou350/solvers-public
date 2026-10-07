import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";

export default function CreatorNotFound() {
  return (
    <section className="wrap sec">
      <Empty icon="user" title="Criador não encontrado" action={<Button href="/">Explorar especialistas</Button>}>
        Este endereço não corresponde a nenhum criador com especialistas na vitrine.
      </Empty>
    </section>
  );
}
