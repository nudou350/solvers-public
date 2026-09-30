"use client";
// /revenda: vitrine do conceito "em breve" (revenda é fase futura, FRONT_PLAN.md).
// Não chama getResaleListings (os anúncios da API são simulados) e não mostra anúncios de exemplo.
// Sem API de lista de interesse, também não pede e-mail: nada de prometer um aviso que não sai.
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon, type IconName } from "@/components/ui/Icon";
import { gap } from "@/lib/style";

const VALUE: { icon: IconName; tone: string; title: string; text: string }[] = [
  { icon: "key", tone: "ok", title: "A licença é sua.", text: "A licença permanente fica registrada na rede Solana, na sua carteira." },
  { icon: "repeat", tone: "brand", title: "Revenda o que não usa.", text: "Terminou o projeto? Anuncie a licença e recupere parte do valor." },
  { icon: "coin", tone: "warn", title: "O criador ganha em cada revenda.", text: "Uma parte de cada revenda vai para quem criou o especialista." },
];

const HOW = [
  { title: "Anuncie a licença", text: "Na sua biblioteca, escolha a licença permanente que não usa mais e defina o preço." },
  { title: "Alguém compra", text: "O comprador paga e a licença passa para a carteira dele na hora, com a mesma nota do original." },
  { title: "Todo mundo recebe", text: "Você recebe o valor da venda e o criador recebe o royalty, automaticamente." },
];

export function ResaleSoon() {
  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <div className="col" style={gap(12, { maxWidth: 760, marginBottom: 32 })}>
        <div className="row wrapx" style={gap(10)}>
          <span className="eyebrow">Mercado de revenda</span>
          <Chip tone="brand" icon="clock">
            Em breve
          </Chip>
        </div>
        <h1 className="display h1s">Revenda a licença que você não usa mais</h1>
        <p className="lead">
          A licença permanente é sua. Quando o mercado de revenda abrir, você poderá vender a de um especialista que não usa mais, e o criador ganha uma parte de cada
          revenda.
        </p>
      </div>

      <div className="g3 m1" style={gap(16, { marginBottom: 40 })}>
        {VALUE.map((v) => (
          <div key={v.title} className="card-flat pad-s row start" style={gap(12)}>
            <span className={v.tone}>
              <Icon name={v.icon} />
            </span>
            <span className="small">
              <b>{v.title}</b> {v.text}
            </span>
          </div>
        ))}
      </div>

      <div className="g2 gs1" style={gap(24, { marginBottom: 40, alignItems: "start" })}>
        <div className="col" style={gap(16)}>
          <h2 className="h3">Como vai funcionar</h2>
          <ol className="col" style={gap(12, { listStyle: "none", margin: 0, padding: 0 })}>
            {HOW.map((s, i) => (
              <li key={s.title} className="card pad-s row start" style={gap(16)}>
                <span className="dot dot-now" aria-hidden>
                  {i + 1}
                </span>
                <div className="col" style={gap(4)}>
                  <b>{s.title}</b>
                  <span className="small muted">{s.text}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="card pad col" style={gap(16)}>
          <div className="col" style={gap(6)}>
            <h2 className="h3">Enquanto isso</h2>
            <p className="small muted">
              Suas licenças permanentes já ficam registradas na sua carteira. Quando a revenda abrir, a opção de anunciar aparece na sua biblioteca, ao lado de cada
              licença.
            </p>
          </div>
          <div>
            <Button variant="secondary" icon="library" href="/biblioteca">
              Ver minha biblioteca
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
