// Chave do nome da rede (catalog.json -> cluster.<chave>), no mesmo critério de lib/explorer.clusterName.
export function clusterKey(cluster: string): "mainnet" | "devnet" | "testnet" | "local" {
  if (cluster === "mainnet-beta" || cluster === "mainnet") return "mainnet";
  if (cluster === "devnet") return "devnet";
  if (cluster === "testnet") return "testnet";
  return "local";
}
