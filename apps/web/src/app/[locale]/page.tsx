import type { Agent } from "@solvers/api-client";
import { Link } from "@/i18n/navigation";
import type { ReactNode } from "react";
import { CategoryExplorer } from "@/components/catalog/CategoryExplorer";
import { agentHref, creatorMap } from "@/components/catalog/data";
import { SearchHero } from "@/components/catalog/SearchHero";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";
import { Tile } from "@/components/ui/Tile";
import { serverApi } from "@/lib/api";
import { evalShort, hasEvalScore } from "@/lib/eval-label";
import { ago, brl, categoryLabel, int, pct, trendCls } from "@/lib/format";
import { gap } from "@/lib/style";

// O catálogo muda a cada venda e avaliação: sempre renderizado na hora, com os dados da API.
export const dynamic = "force-dynamic";

async function loadHome() {
  const api = serverApi();
  const [config, categories, creators, top, trending, fresh] = await Promise.all([
    api.getConfig(),
    api.getCategories(),
    api.getCreators(),
    api.getAgents({ sort: "rating", limit: 4 }),
    api.getAgents({ sort: "trend", limit: 5 }),
    api.getAgents({ sort: "new", limit: 3 }),
  ]);
  return { config, categories, creators: creatorMap(creators), top: top.slice(0, 4), trending: trending.slice(0, 5), fresh: fresh.slice(0, 3) };
}

export default async function Home() {
  const data = await loadHome().catch(() => null);
  if (!data)
    return (
      <section className="wrap sec">
        <Empty icon="warning" title="Não deu para carregar a vitrine" action={<Button href="/">Tentar de novo</Button>}>
          O servidor não respondeu agora. Tente de novo em instantes.
        </Empty>
      </section>
    );
  const { config, categories, creators, top, trending, fresh } = data;
  const rate = config.brlPerUsd;
  // O cartão "Sua licença" mostra um pagamento: só serve a especialista pago (os da plataforma são gratuitos e sem licença).
  const hero = top.find((a) => !a.platform);

  return (
    <>
      <SearchHero creators={creators} rate={rate} aside={hero ? <HeroTicket agent={hero} rate={rate} /> : <div className="hide-m" />} />

      <CategoryExplorer categories={categories} initialTop={top} creators={creators} rate={rate} />

      <section className="wrap" style={{ paddingBottom: 72 }}>
        <div className="g2 gs2" style={gap("48px", { alignItems: "start" })}>
          <div>
            <div className="col" style={gap("8px", { marginBottom: 28 })}>
              <h2 className="display h2s">Tendência da semana</h2>
              <p className="muted" style={{ maxWidth: 560 }}>
                Especialistas cuja procura mais subiu nos últimos 7 dias.
              </p>
            </div>
            {trending.length === 0 ? (
              <div className="card-flat pad center muted">Ainda não há movimento suficiente para montar a tendência.</div>
            ) : (
              <div className="card pad-s" style={{ padding: "8px 24px" }}>
                {trending.map((a, i) => (
                  <TrendRow key={a.id} agent={a} rank={i + 1} />
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="col" style={gap("8px", { marginBottom: 28 })}>
              <h2 className="display h2s">Novos por aqui</h2>
              <p className="muted" style={{ maxWidth: 560 }}>
                Publicados nas últimas semanas, já passados pela revisão da equipe.
              </p>
            </div>
            <div className="col" style={gap("14px")}>
              {fresh.map((a) => (
                <Link key={a.id} className="card pad-s" href={agentHref(a.slug)} style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <Tile category={a.category} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b className="trunc" style={{ display: "block" }}>
                      {a.name}
                    </b>
                    <div className="small muted trunc">
                      publicado {ago(a.publishedAt)} · {evalShort(a.evalScore)}{a.trialAvailable ? " · teste grátis" : ""}
                    </div>
                  </div>
                  <span className="chip chip-brand flex-none">Novo</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="wrap" id="como-funciona" style={{ paddingBottom: 72 }}>
        <div className="card-flat how" style={{ padding: "56px 48px" }}>
          <div className="col center" style={gap("12px", { alignItems: "center", marginBottom: 44 })}>
            <span className="eyebrow">Como funciona</span>
            <h2 className="display h2">Escolha, pague, use na sua IA</h2>
          </div>
          <div className="g3" style={gap("40px")}>
            <Step n={1} title="Escolha um especialista">
              Compare notas de usuários, os testes da equipe e o antes e depois. Muitos têm teste grátis para você experimentar antes de decidir.
            </Step>
            <Step n={2} title="Pague uma vez">
              Você recebe uma licença só sua. Se a tarefa tiver garantia, o pagamento fica guardado e só é liberado quando o resultado passa nos critérios.
            </Step>
            <Step n={3} title="Use na sua IA">
              Copie um endereço, cole no Claude ou no ChatGPT e pronto. Um passo a passo com ilustrações leva menos de cinco minutos.
            </Step>
          </div>
          <div className="row wrapx" style={gap("14px", { justifyContent: "center", marginTop: 40 })}>
            <Button href="/install" size="lg" iconRight="arrow-right">
              Ver o passo a passo
            </Button>
            <Button href="/profile" size="lg" variant="secondary">
              Como a segurança funciona
            </Button>
          </div>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 16 }}>
        <div className="card pad-l row between wrapx m-col" style={gap("24px", { padding: "36px 44px" })}>
          <div className="col" style={gap("8px", { maxWidth: 640 })}>
            <h2 className="display h2s">Sabe fazer algo muito bem? Publique o seu especialista.</h2>
            <p className="muted">Defina o preço e ganhe em cada venda. Publicar é grátis: o filtro é a bateria de testes.</p>
          </div>
          <Button href="/creator/publish" size="lg">
            Publicar especialista
          </Button>
        </div>
      </section>
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="col" style={gap("14px")}>
      <span className="display" style={{ fontSize: 64, color: "var(--brand)" }}>
        {n}
      </span>
      <h3 className="h3">{title}</h3>
      <p className="muted">{children}</p>
    </div>
  );
}

function TrendRow({ agent: a, rank }: { agent: Agent; rank: number }) {
  const cls = trendCls(a.trend7d);
  return (
    <Link className="rowline" href={agentHref(a.slug)}>
      <span className="rank">{rank}</span>
      <Tile category={a.category} size="s" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="bold trunc">{a.name}</div>
        <div className="small muted trunc">
          {categoryLabel(a.category)} · {int(a.verifiedUses)} usos verificados{a.trialAvailable ? " · teste grátis" : ""}
        </div>
      </div>
      <span className={`trend ${cls}`} style={{ minWidth: 64, justifyContent: "flex-end" }}>
        <Icon name={cls === "up" ? "trend-up" : cls === "down" ? "trend-down" : "minus"} size="s" />
        {pct(a.trend7d)}
      </span>
    </Link>
  );
}

/** Card-hero "Sua licença", com o especialista mais bem avaliado. */
function HeroTicket({ agent: a, rate }: { agent: Agent; rate: number }) {
  return (
    <div className="hide-m" style={{ position: "relative", minHeight: 420 }}>
      <Link href={agentHref(a.slug)} className="ticket" style={{ display: "block", transform: "rotate(2.5deg)", padding: "26px 26px 22px" }} aria-label={`Ver ${a.name}`}>
        <div className="sol-line" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, borderRadius: 0 }} />
        <div className="row between">
          <span className="eyebrow">Sua licença</span>
          <span className="chip chip-ok">
            <Icon name="check" size="s" />
            Ativa
          </span>
        </div>
        <div className="row" style={gap("16px", { margin: "22px 0 20px" })}>
          <Tile category={a.category} size="l" />
          <div>
            <div className="display" style={{ fontSize: 32, lineHeight: 1.05 }}>
              {a.name}
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              Licença permanente
            </div>
          </div>
        </div>
        <div className="row wrapx" style={gap("8px")}>
          <span className="chip">Registrada na rede Solana</span>
          <span className="chip">Atualizações incluídas</span>
        </div>
        <div className="cut" style={{ margin: "22px -26px 16px" }} />
        <div className="row between small">
          <span className="muted">Pagamento confirmado</span>
          <b className="num">{brl(a.priceUsdc, rate)}</b>
        </div>
      </Link>
      <div className="card pad-s row" style={gap("12px", { position: "absolute", left: -28, bottom: 6, transform: "rotate(-3deg)" })}>
        <span className="dot dot-ok">
          <Icon name="check" />
        </span>
        <div>
          <div className="bold small">Testado pela equipe</div>
          <div className="tiny muted">{hasEvalScore(a.evalScore) ? `${Math.round(a.evalScore)}% dos casos de teste internos resolvidos` : "Sem avaliações ainda"}</div>
        </div>
      </div>
    </div>
  );
}
