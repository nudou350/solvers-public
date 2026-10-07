"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { RepBadge } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Tabs } from "@/components/ui/Tabs";
import { CLOAK_ENABLED } from "@/lib/cloak/config";
import { short, useFormat } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";

/**
 * Primeiro nome do usuário logado. Sem nome no perfil, usa o nome público do criador (`fallback`)
 * e, por último, a carteira encurtada.
 */
export function useFirstName(fallback?: string | null): string | null {
  const { me } = useSession();
  if (!me) return null;
  const name = me.displayName || fallback;
  return name ? (name.split(" ")[0] ?? name) : short(me.wallet);
}

/** Cabeçalho do painel do criador: eyebrow, selo de reputação, saudação e as abas (Visão geral / Publicar). */
export function CreatorHead({ tab, reputation, title, name }: { tab: "overview" | "publish" | "submissions" | "private"; reputation?: number | null; title?: ReactNode; name?: string | null }) {
  const t = useTranslations("creator.head");
  const f = useFormat();
  const first = useFirstName(name);
  const lv = reputation != null ? f.repLevel(reputation) : null;
  return (
    <div className="row between end wrapx" style={gap(24, { marginBottom: 28 })}>
      <div className="col" style={gap(12)}>
        <div className="row wrapx" style={gap(10)}>
          <span className="eyebrow">{t("eyebrow")}</span>
          {lv && reputation != null ? (
            <RepBadge score={reputation}>
              <span>{t("repBadge", { label: lv.label, score: Math.round(reputation) })}</span>
            </RepBadge>
          ) : null}
        </div>
        <h1 className="display h1s">{title ?? (first ? t("hello", { name: first }) : t("forCreators"))}</h1>
      </div>
      <Tabs
        aria-label={t("tabsLabel")}
        value={tab}
        tabs={[
          { id: "overview", label: t("tabs.overview"), href: "/creator" },
          { id: "submissions", label: t("tabs.submissions"), href: "/creator/submissions" },
          {
            id: "publish",
            label: (
              <>
                <Icon name="plus" size="s" />
                {t("tabs.publish")}
              </>
            ),
            href: "/creator/publish",
          },
          ...(CLOAK_ENABLED
            ? [
                {
                  id: "private" as const,
                  label: (
                    <>
                      <Icon name="lock" size="s" />
                      {t("tabs.private")}
                    </>
                  ),
                  href: "/creator/private-withdraw",
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
