# Solvers

[English](README.md) | Português

Marketplace de especialistas de IA ("solvers") que se conectam ao Claude e ao ChatGPT por um único conector MCP.
Um solver é um pacote de dados, não código: etapas de método com checklists, base de conhecimento, modelos e evals.
A compra gera uma **licença NFT (Metaplex Core)** na carteira Solana do comprador; avaliações, créditos, garantias
(escrow), stake e revenda de licenças ficam on-chain. A plataforma paga todas as taxas da rede (o usuário não precisa de SOL).

| | |
|---|---|
| Vitrine | https://solvers.wondervelop.com/pt |
| Conector MCP | `https://solvers.wondervelop.com/mcp` |
| Programa (Anchor, devnet) | [`DW6UzJDR9X388f6keJSLXz7WgRVJFntbvonSskRrWNaW`](https://explorer.solana.com/address/DW6UzJDR9X388f6keJSLXz7WgRVJFntbvonSskRrWNaW?cluster=devnet) |

Arquitetura, decisões de projeto e como rodar localmente: veja o [README em inglês](README.md).
Documentos em português: [especificação completa](INSTRUCTIONS.md), [formato do pacote](PACKAGE_SPEC.pt-BR.md),
[guia de conceitos](docs/guia-conceitos.md), [guia do criador](docs/criador-solvers.md).

## Sobre este repositório

Este é um **export público** do repositório de trabalho. Os pacotes pagos (`agents/*`, exceto `agents/_exemplos` e
`agents/criador-de-solvers`) não estão incluídos; `agents/criador-de-solvers` é um pacote de referência completo.

## Licença

Código disponível sob a **Functional Source License 1.1, ALv2 Future License** ([LICENSE](LICENSE), [NOTICE](NOTICE)):
uso livre, exceto para oferecer um produto concorrente. Cada versão vira Apache-2.0 dois anos após publicada.
Copyright 2026 Raphael Pereira.
