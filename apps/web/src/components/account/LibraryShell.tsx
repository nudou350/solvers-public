"use client";
// Cabeçalho e abas da biblioteca (/biblioteca e /biblioteca/memorias), com base em minha-biblioteca.html.
import type { License } from "@solvers/api-client";
import { usePathname } from "next/navigation";
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
        title="Minha biblioteca"
        lead="Seus especialistas, quanto você usou cada um e o que eles aprenderam sobre você."
        aside={
          Array.isArray(licenses) ? (
            <div className="row wrapx" style={{ "--gap": "10px" } as React.CSSProperties}>
              <Chip>{list.length === 1 ? "1 especialista" : `${list.length} especialistas`}</Chip>
            </div>
          ) : null
        }
      />
      <Tabs
        aria-label="Seções da biblioteca"
        value={tab}
        tabs={[
          { id: "lic", label: "Especialistas", href: "/biblioteca" },
          { id: "mem", label: "Memórias", href: "/biblioteca/memorias", count: memCount ?? undefined },
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
  const tab = (usePathname() ?? "").startsWith("/biblioteca/memorias") ? "mem" : "lic";
  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <AuthGate
        icon="library"
        title="Entre para ver sua biblioteca"
        text={
          tab === "lic"
            ? "Seus especialistas e quanto você usou cada um ficam aqui."
            : "As memórias que os especialistas guardam sobre você ficam aqui, criptografadas."
        }
      >
        <Inner tab={tab}>{children}</Inner>
      </AuthGate>
    </section>
  );
}
