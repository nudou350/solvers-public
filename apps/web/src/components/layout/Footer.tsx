import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Logo } from "./Header";

export function Footer() {
  const t = useTranslations("common.footer");
  return (
    <footer className="foot">
      <div className="wrap row between start m-col-x" style={{ "--gap": "40px" } as React.CSSProperties}>
        <div className="col" style={{ "--gap": "14px", maxWidth: 360 } as React.CSSProperties}>
          <Logo />
          <p className="small muted">{t("tagline")}</p>
        </div>
        <div className="row start wrapx" style={{ "--gap": "72px", rowGap: 28 } as React.CSSProperties}>
          <div className="col small" style={{ "--gap": "10px" } as React.CSSProperties}>
            <span className="eyebrow">{t("explore")}</span>
            <Link href="/" className="muted">
              {t("solvers")}
            </Link>
            <Link href="/resale" className="muted">
              {t("resale")}
            </Link>
            <Link href="/guarantees" className="muted">
              {t("guarantees")}
            </Link>
          </div>
          <div className="col small" style={{ "--gap": "10px" } as React.CSSProperties}>
            <span className="eyebrow">{t("creators")}</span>
            <Link href="/creator/publish" className="muted">
              {t("publish")}
            </Link>
            <Link href="/creator" className="muted">
              {t("dashboard")}
            </Link>
          </div>
          <div className="col small" style={{ "--gap": "10px" } as React.CSSProperties}>
            <span className="eyebrow">{t("trust")}</span>
            <Link href="/profile" className="muted">
              {t("profile")}
            </Link>
            <span className="sol-chip">
              <i />
              {t("solana")}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
