"use client";
// Área de revisão: só para carteiras admin (CreatorMe.isAdmin). Quem não é admin vê "não encontrado", igual a um endereço
// que não existe. O servidor confere o poder de verdade em cada rota; isto só evita mostrar uma tela inútil.
import { notFound } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AuthGate } from "@/components/ui/AuthGate";
import { Loading } from "@/components/ui/Spinner";
import { useSession } from "@/lib/session";

export function AdminGate({ children }: { children: ReactNode }) {
  const { api, status, me } = useSession();
  const [admin, setAdmin] = useState<"loading" | "yes" | "no">("loading");

  useEffect(() => {
    if (status !== "authed") return;
    let live = true;
    setAdmin("loading");
    api.getCreatorMe().then(
      (c) => live && setAdmin(c.isAdmin ? "yes" : "no"),
      () => live && setAdmin("no"),
    );
    return () => {
      live = false;
    };
  }, [api, status, me?.wallet]);

  if (status === "authed" && admin === "no") notFound();
  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <AuthGate icon="lock" title="Entre para continuar" text="Esta área é só para a equipe do Solvers.">
        {admin === "yes" ? children : <Loading />}
      </AuthGate>
    </section>
  );
}
