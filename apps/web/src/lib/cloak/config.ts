// Saque privado do criador (Cloak). Tudo aqui é opt-in: sem NEXT_PUBLIC_CLOAK_ENABLED=1 a aba nem a página aparecem.
// O Cloak só existe na MAINNET; a vitrine pode seguir na devnet, o módulo conversa com a rede real por conta própria.

/** Liga a aba "Saque privado" do painel do criador (build-time). */
export const CLOAK_ENABLED = process.env.NEXT_PUBLIC_CLOAK_ENABLED === "1";

/**
 * RPC da MAINNET usado só por este módulo (o navegador chama direto). O RPC público da Solana limita o ritmo (HTTP 429)
 * e bloqueia navegadores: em uso real, ponha uma URL com chave restrita ao domínio (ex: Helius).
 */
export const CLOAK_RPC_URL = process.env.NEXT_PUBLIC_CLOAK_RPC_URL || "https://api.mainnet-beta.solana.com";

/** Hash do bloco gênese da mainnet-beta: trava contra RPC apontado para a rede errada. */
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export const solscanTx = (signature: string) => `https://solscan.io/tx/${signature}`;
export const solscanAccount = (address: string) => `https://solscan.io/account/${address}`;
