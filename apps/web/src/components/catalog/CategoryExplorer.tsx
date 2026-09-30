"use client";
import type { Agent } from "@solvers/api-client";
import { useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { Tile } from "@/components/ui/Tile";
import { api } from "@/lib/api";
import { categoryLabel } from "@/lib/format";
import { AgentCard } from "./AgentCard";
import { gap } from "@/lib/style";
import { type CreatorMap } from "./data";

const TOP = 4;

type Cat = { category: string; count: number };

/** Categorias (o clique filtra) + "Mais bem avaliados" com getAgents({ sort: "rating", category }). */
export function CategoryExplorer({ categories, initialTop, creators, rate }: { categories: Cat[]; initialTop: Agent[]; creators: CreatorMap; rate: number }) {
  const [cat, setCat] = useState<string | null>(null);
  const [top, setTop] = useState<Agent[]>(initialTop);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const topRef = useRef<HTMLElement>(null);

  const choose = (next: string | null) => {
    setCat(next);
    setFailed(false);
    const id = ++seq.current;
    if (next === null) {
      setTop(initialTop);
      setLoading(false);
      return;
    }
    setLoading(true);
    api.getAgents({ sort: "rating", category: next, limit: TOP }).then(
      (list) => {
        if (id !== seq.current) return;
        setTop(list.slice(0, TOP));
        setLoading(false);
      },
      () => {
        if (id !== seq.current) return;
        setFailed(true);
        setLoading(false);
      },
    );
  };

  const pick = (c: string) => {
    choose(cat === c ? null : c);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <section className="wrap sec-s" id="categorias">
        <div className="row between end wrapx" style={gap("16px", { marginBottom: 28 })}>
          <div className="col" style={gap("8px")}>
            <h2 className="display h2s">Explore por categoria</h2>
            <p className="muted" style={{ maxWidth: 560 }}>
              Toque em uma categoria para filtrar os mais bem avaliados logo abaixo.
            </p>
          </div>
        </div>
        {categories.length === 0 ? (
          <div className="card-flat pad center muted">As categorias aparecem aqui assim que houver especialistas publicados.</div>
        ) : (
          <div className="g4 m1" style={gap("14px")}>
            {categories.map((c) => {
              const on = cat === c.category;
              return (
                <button key={c.category} type="button" className={`cat${on ? " on" : ""}`} aria-pressed={on} onClick={() => pick(c.category)}>
                  <Tile category={c.category} size="s" />
                  <span className="col" style={gap("0")}>
                    <b>{categoryLabel(c.category)}</b>
                    <span className="tiny faint">
                      {c.count} {c.count === 1 ? "especialista" : "especialistas"}
                    </span>
                  </span>
                </button>
              );
            })}
            <button type="button" className="cat" onClick={() => choose(null)}>
              <span className="tile tile-s" style={{ "--h": 260 } as CSSProperties} aria-hidden>
                <Icon name="arrow-right" />
              </span>
              <span className="col" style={gap("0")}>
                <b>Ver todas</b>
                <span className="tiny faint">Explorar tudo</span>
              </span>
            </button>
          </div>
        )}
      </section>

      <section ref={topRef} className="wrap sec" aria-busy={loading || undefined} style={{ scrollMarginTop: 24 }}>
        <div className="row between end wrapx" style={gap("16px", { marginBottom: 28 })}>
          <div className="row" style={gap("12px")}>
            <h2 className="display h2s">{cat ? `Mais bem avaliados em ${categoryLabel(cat)}` : "Mais bem avaliados"}</h2>
            {loading ? <Spinner label="Carregando" /> : null}
          </div>
          {cat ? (
            <button type="button" className="link-btn" onClick={() => choose(null)}>
              Ver todos <Icon name="arrow-right" size="s" />
            </button>
          ) : null}
        </div>
        {failed ? (
          <div className="card-flat pad center muted" role="alert">
            Não deu para carregar essa categoria agora.{" "}
            <button type="button" className="link-btn" onClick={() => cat && choose(cat)}>
              Tentar de novo
            </button>
          </div>
        ) : top.length === 0 ? (
          <div className="card-flat pad center muted">
            Ainda não há especialistas nessa categoria. Descreva o que você precisa na busca acima e avisamos quando chegar.
          </div>
        ) : (
          <div className="g4 rail" style={gap("20px", { opacity: loading ? 0.55 : 1, transition: "opacity .2s" })}>
            {top.map((a) => (
              <AgentCard key={a.id} agent={a} creatorName={creators[a.creatorId]?.name} rate={rate} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
