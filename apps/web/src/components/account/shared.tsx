"use client";
// Peças comuns das telas da conta (biblioteca, memórias, garantias e perfil).
// AuthGate fica em components/ui; useAgentsIndex e useNow em lib/hooks.
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { gap } from "@/lib/style";

/** Erro de carregamento de uma seção, com "Tentar de novo". */
export function LoadError({ onRetry, text = "Não conseguimos carregar agora." }: { onRetry: () => void; text?: string }) {
  return (
    <Empty icon="warning" title="Algo deu errado" action={<Button variant="secondary" icon="refresh" onClick={onRetry}>Tentar de novo</Button>}>
      {text}
    </Empty>
  );
}

/** Cabeçalho das telas da conta: título display, texto e (opcional) itens à direita. */
export function PageHead({ title, lead, aside }: { title: string; lead: string; aside?: ReactNode }) {
  return (
    <div className="row between end wrapx" style={gap(24, { marginBottom: 32 })}>
      <div className="col" style={gap(12, { maxWidth: 720 })}>
        <h1 className="display h1s">{title}</h1>
        <p className="lead">{lead}</p>
      </div>
      {aside}
    </div>
  );
}
