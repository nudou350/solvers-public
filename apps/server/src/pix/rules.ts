// Regras puras do Pix (sem env nem banco), para poder testar sem subir o servidor.

// Só cobranças criadas pelo provedor simulado podem ser "pagas" pela rota de simulação.
// Com o Mercado Pago configurado, uma cobrança real pendente não pode ser aprovada por esse caminho:
// sem esta checagem qualquer usuário logado receberia o crédito sem pagar (DEF-10).
export function simulateBlockReason(provider: string): "pix_not_simulated" | null {
  return provider === "simulated" ? null : "pix_not_simulated";
}
