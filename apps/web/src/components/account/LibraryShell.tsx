"use client";
// Cabeçalho e abas da biblioteca (/library e /biblioteca/memorias), com base em minha-biblioteca.html.
import type { License } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Chip } from "@/components/ui/Chip";
import { Tabs } from "@/components/ui/Tabs";
import { useSession } from "@/lib/session";
import { AuthGate } from "@/components/ui/AuthGate";
import { PageHead } from "./shared";

export type LibraryCtx = {
  /** null enquanto carrega; "error" se falhou. */
  licenses: License[] | null | "error";
  reloadLicenses: () => void;
  setMemCount: (n: number) => void;
};

const Ctx = createContext<LibraryCtx | null>(null);

/** Dados da biblioteca compartilhados entre as abas (o layout carrega uma vez). */
export function useLibrary(): LibraryCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLibrary precisa estar dentro de <LibraryShell>");
  return c;
}

function Inner({ tab, children }: { tab: "lic" | "mem"; children: ReactNode }) {
  const { api } = useSession();
  const t = useTranslations("account.library");
  const [licenses, setLicenses] = useState<LibraryCtx["licenses"]>(null);
  const [memCount, setMemCount] = useState<number | null>(null);

  const reloadLicenses = useCallback(() => {
    setLicenses(null);
    api.getMyLicenses().then(
      (l) => setLicenses([...l].sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt))),
      () => setLicenses("error"),
    );
  }, [api]);

  useEffect(() => {
    reloadLicenses();
    // O contador vem sem desbloquear as memórias.
    api.getMemoriesCount().then((r) => setMemCount(r.count), () => setMemCount(null));
  }, [api, reloadLicenses]);

  const list = Array.isArray(licenses) ? licenses : [];
  return (
    <>
      <PageHead
        title={t("title")}
        lead={t("lead")}
        aside={
          Array.isArray(licenses) ? (
            <div className="row wrapx" style={{ "--gap": "10px" } as React.CSSProperties}>
              <Chip>{t("count", { n: list.length })}</Chip>
            </div>
          ) : null
        }
      />
      <Tabs
        aria-label={t("tabsLabel")}
        value={tab}
        tabs={[
          { id: "lic", label: t("tabSolvers"), href: "/library" },
          { id: "mem", label: t("tabMemories"), href: "/library/memories", count: memCount ?? undefined },
        ]}
      />
      <div style={{ marginTop: 28 }}>
        <Ctx.Provider value={{ licenses, reloadLicenses, setMemCount }}>{children}</Ctx.Provider>
      </div>
    </>
  );
}

/** Layout de /biblioteca: cabeçalho, abas e o contexto com as licenças e o contador de memórias. */
export function LibraryShell({ children }: { children: ReactNode }) {
  const t = useTranslations("account.library");
  const tab = (usePathname() ?? "").startsWith("/library/memories") ? "mem" : "lic";
  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <AuthGate
        icon="library"
        title={t("gateTitle")}
        text={tab === "lic" ? t("gateSolvers") : t("gateMemories")}
      >
        <Inner tab={tab}>{children}</Inner>
      </AuthGate>
    </section>
  );
}
