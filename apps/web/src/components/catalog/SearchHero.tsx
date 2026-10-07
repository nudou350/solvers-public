"use client";
import type { Agent } from "@solvers/api-client";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { Stars } from "@/components/ui/Stars";
import { Tile } from "@/components/ui/Tile";
import { api } from "@/lib/api";
import { useFormat } from "@/lib/format";
import { gap } from "@/lib/style";
import { agentHref, type CreatorMap } from "./data";
import { DifferentiatorBadges, FreeInline } from "./PlatformBits";
import { TrialTag } from "./TrialTag";

const EXAMPLE_KEYS = ["ex1", "ex2", "ex3", "ex4"] as const;
const MIN_CHARS = 3;
const DEBOUNCE_MS = 450;

type Result = { status: "idle" } | { status: "loading"; q: string } | { status: "done"; q: string; agents: Agent[] } | { status: "error"; q: string };

/** Hero com a busca por necessidade (search(need) devolve os 3 melhores) e a seção de sugestões. */
export function SearchHero({ creators, rate, aside }: { creators: CreatorMap; rate: number; aside: ReactNode }) {
  const t = useTranslations("catalog.search");
  const tc = useTranslations("catalog.card");
  const f = useFormat();
  const lang = useLocale() as Locale;
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Result>({ status: "idle" });
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const results = useRef<HTMLElement>(null);

  const run = (need: string) => {
    if (timer.current) clearTimeout(timer.current);
    const text = need.trim();
    if (text.length < MIN_CHARS) {
      seq.current++;
      setRes({ status: "idle" });
      return;
    }
    const id = ++seq.current;
    setRes({ status: "loading", q: text });
    api.search(text, lang).then(
      (agents) => id === seq.current && setRes({ status: "done", q: text, agents }),
      () => id === seq.current && setRes({ status: "error", q: text }),
    );
  };

  const onChange = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(v), DEBOUNCE_MS);
  };

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(q);
    results.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const pick = (ex: string) => {
    setQ(ex);
    run(ex);
  };

  const shownQ = res.status === "idle" ? "" : res.q;
  const qShort = shownQ.length > 46 ? `${shownQ.slice(0, 44)}…` : shownQ;

  return (
    <>
      <section className="wrap" style={{ paddingTop: 56, paddingBottom: 24 }}>
        <div className="g2 gs1" style={gap("56px", { alignItems: "center" })}>
          <div className="col" style={gap("26px")}>
            <span className="chip chip-brand" style={{ alignSelf: "flex-start" }}>
              <Icon name="sparkles" size="s" />
              {t("chip")}
            </span>
            <h1 className="display h1">
              {t.rich("h1", { em: (chunks) => <em>{chunks}</em> })}
            </h1>
            <p className="lead" style={{ maxWidth: 600 }}>
              {t("lead")}
            </p>
            <form className="col" style={gap("14px", { marginTop: 6 })} onSubmit={submit} role="search">
              <label className="label" htmlFor="busca">
                {t("label")}
              </label>
              <div className="searchbar">
                <span className="faint">
                  <Icon name="search" size="l" />
                </span>
                <input
                  id="busca"
                  className="input"
                  type="search"
                  value={q}
                  onChange={(e) => onChange(e.target.value)}
                  placeholder={t("placeholder")}
                  autoComplete="off"
                  aria-controls="sugestoes"
                />
                <button className="btn btn-primary btn-lg" type="submit">
                  {t("submit")}
                </button>
              </div>
              <div className="row wrapx" style={gap("8px")}>
                <span className="small faint">{t("try")}</span>
                {EXAMPLE_KEYS.map((k) => (
                  <button key={k} type="button" className="chip" onClick={() => pick(t(k))}>
                    {t(k)}
                  </button>
                ))}
              </div>
            </form>
          </div>
          {aside}
        </div>
      </section>

      <section ref={results} id="sugestoes" className="wrap" style={{ paddingBottom: res.status === "idle" ? 32 : 64 }} aria-live="polite">
        {res.status === "idle" ? null : (
          <div className="card-flat pad-l" style={{ padding: 32 }}>
            <div className="row between wrapx" style={gap("12px", { marginBottom: 20 })}>
              <div className="row" style={gap("12px")}>
                <span className="dot dot-now">
                  <Icon name="sparkles" />
                </span>
                <h2 className="h3">{t("suggestTitle")}</h2>
              </div>
              <span className="small muted">
                {t.rich("basedOn", { q: qShort, em: (chunks) => <em>{chunks}</em> })}
              </span>
            </div>
            {res.status === "loading" ? (
              <div className="loading-block" role="status" style={{ padding: "28px 0" }}>
                <Spinner />
                <span className="small">{t("searching")}</span>
              </div>
            ) : res.status === "error" ? (
              <p className="muted" role="alert">
                {t("error")}{" "}
                <button type="button" className="link-btn" onClick={() => run(res.q)}>
                  {t("retry")}
                </button>
              </p>
            ) : res.agents.length === 0 ? (
              <p className="muted">{t("none")}</p>
            ) : (
              <div className="g3 gn" style={{ "--n": res.agents.length } as CSSProperties}>
                {res.agents.map((a) => (
                  <Link key={a.id} className="card pad-s" href={agentHref(a.slug)} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div className="row" style={gap("14px")}>
                      <Tile category={a.category} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <h3 className="h4 clamp2">{a.name}</h3>
                        {creators[a.creatorId] ? <div className="small muted trunc">{tc("by", { name: creators[a.creatorId]?.name ?? "" })}</div> : null}
                      </div>
                    </div>
                    <p className="small muted clamp3">{a.tagline}</p>
                    <DifferentiatorBadges keys={a.differentiators} max={3} />
                    {a.trialAvailable ? (
                      <div>
                        <TrialTag agentId={a.id} />
                      </div>
                    ) : null}
                    <div className="row between wrapx" style={{ marginTop: "auto" }}>
                      {a.reviewsCount > 0 ? <Stars rating={a.userRating} showValue /> : <span className="tiny faint">{tc("noReviews")}</span>}
                      {a.platform ? <FreeInline /> : <b className="num">{f.brl0(a.priceUsdc, rate)}</b>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
