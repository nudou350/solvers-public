import { Button } from "@/components/ui/Button";

// Provisória: a home de verdade (catálogo) é de outro agente.
export default function Home() {
  return (
    <section className="sec">
      <div className="wrap col" style={{ gap: 20, maxWidth: 820 }}>
        <span className="eyebrow">Solver</span>
        <h1 className="display h1">Especialistas de IA para o Claude e o ChatGPT que você já tem.</h1>
        <p className="lead">A vitrine está sendo montada. Enquanto isso, o kit de componentes mostra a base visual e o login.</p>
        <div className="row wrapx">
          <Button href="/dev/kit" iconRight="arrow-right">
            Ver o kit
          </Button>
        </div>
      </div>
    </section>
  );
}
