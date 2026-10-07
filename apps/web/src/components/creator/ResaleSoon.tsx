"use client";
// /revenda: vitrine do conceito "em breve" (revenda é fase futura, FRONT_PLAN.md).
// Não chama getResaleListings (os anúncios da API são simulados) e não mostra anúncios de exemplo.
// Sem API de lista de interesse, também não pede e-mail: nada de prometer um aviso que não sai.
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon, type IconName } from "@/components/ui/Icon";
import { gap } from "@/lib/style";

const VALUE: { key: "own" | "resell" | "creator"; icon: IconName; tone: string }[] = [
  { key: "own", icon: "key", tone: "ok" },
  { key: "resell", icon: "repeat", tone: "brand" },
  { key: "creator", icon: "coin", tone: "warn" },
];

const HOW = ["list", "buy", "paid"] as const;

export function ResaleSoon() {
  const t = useTranslations("creator.resale");
  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <div className="col" style={gap(12, { maxWidth: 760, marginBottom: 32 })}>
        <div className="row wrapx" style={gap(10)}>
          <span className="eyebrow">{t("eyebrow")}</span>
          <Chip tone="brand" icon="clock">
            {t("soon")}
          </Chip>
        </div>
        <h1 className="display h1s">{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </div>

      <div className="g3 m1" style={gap(16, { marginBottom: 40 })}>
        {VALUE.map((v) => (
          <div key={v.key} className="card-flat pad-s row start" style={gap(12)}>
            <span className={v.tone}>
              <Icon name={v.icon} />
            </span>
            <span className="small grow">
              <b>{t(`value.${v.key}.title`)}</b> {t(`value.${v.key}.text`)}
            </span>
          </div>
        ))}
      </div>

      <div className="g2 gs1" style={gap(24, { marginBottom: 40, alignItems: "start" })}>
        <div className="col" style={gap(16)}>
          <h2 className="h3">{t("howTitle")}</h2>
          <ol className="col" style={gap(12, { listStyle: "none", margin: 0, padding: 0 })}>
            {HOW.map((k, i) => (
              <li key={k} className="card pad-s row start" style={gap(16)}>
                <span className="dot dot-now" aria-hidden>
                  {i + 1}
                </span>
                <div className="col grow" style={gap(4)}>
                  <b>{t(`how.${k}.title`)}</b>
                  <span className="small muted">{t(`how.${k}.text`)}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="card pad col" style={gap(16)}>
          <div className="col" style={gap(6)}>
            <h2 className="h3">{t("meanwhileTitle")}</h2>
            <p className="small muted">{t("meanwhileText")}</p>
          </div>
          <div>
            <Button variant="secondary" icon="library" href="/library">
              {t("library")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
