# Nota ao revisor: Mudança de Apartamento (versão 1.0.0)

Este arquivo é só para a pessoa que revisa o pacote. Ele não chega ao comprador.

## O que o Solver promete

- Promessa em uma frase: planejar a mudança de apartamento por prazo, da transportadora ao último aviso de endereço, incluindo a vistoria de saída.
- Público: quem muda de apartamento (alugado ou próprio) no Brasil, sem ajuda profissional.
- O que NÃO faz: (1) consultoria jurídica sobre contrato, caução ou multa; (2) indicar empresa específica ou garantir preço; (3) mudança internacional, de escritório ou preencher formulários pelo usuário.
- Categoria escolhida e por quê: Dia a dia. O conteúdo toca em contrato de aluguel e em cadastros públicos, então as etapas 1, 3 e 4 e os arquivos de conhecimento trazem a ressalva "confira no site oficial / com a imobiliária ou um advogado". Não há valor, prazo legal ou taxa afirmados como certos.

## Diferenciais e como conferir (pelo menos 2)

- liveData: 11 arquivos em knowledge/ com source, source_date e valid_until; manifesto com knowledge.updatedAt=2026-10-02 e reviewEveryDays=90. Quem atualiza e quando: a criadora (Marina), a cada 90 dias; o conteúdo de órgãos e concessionárias é sempre marcado como "conferir no site oficial".
- memory: onboarding com 4 perguntas (situacao_imovel, volume, quem_ajuda, ja_mudou); as etapas 1 a 4 leem o perfil com get_memory e mudam as tarefas e o nível da explicação (por exemplo, a etapa 2 troca tarefas de embalar quando a pessoa contrata empresa com embalagem).
- escalation: não declarado.

## Fontes e direitos

- Fontes: experiência própria da criadora em três mudanças de apartamento (2 de aluguel e 1 de imóvel próprio), 2026-10-02; menções genéricas a sites oficiais de concessionárias, bancos, Detran, TSE, Receita Federal, Correios, Procon e consumidor.gov.br, apenas para indicar o que conferir (nenhum texto copiado). Menção à Lei do Inquilinato (Lei 8.245/1991) sem interpretação de prazos.
- Material de terceiros usado e como a permissão foi obtida: nenhum.

## Avisos do validador que restaram e por que

- nenhum aviso (conferir a saída da última validação)

## Plano para a Abertura (ferramentas e verificação)

- Ferramenta futura: nenhuma.

## Como testar rápido

- Pedido de exemplo 1: "Vou me mudar daqui a 5 semanas, apartamento alugado, preciso de um cronograma". Espera-se ver perguntas curtas (data, imóvel, volume, ajuda) e um cronograma por janelas de prazo com 3 tarefas críticas.
- Pedido de exemplo 2: "Recebi duas propostas de mudança, qual escolho?". Espera-se ver o comparativo com o que cada uma inclui e as perguntas de seguro e cancelamento, sem indicar empresa nem inventar preços.
- Os casos de teste ficam em evals/cases (12 casos); nenhuma nota foi criada.

## Atenção do criador

- Onde o revisor deve olhar com mais cuidado: etapas 3 e 4 e os arquivos aviso-previo-e-chaves-do-aluguel.md, contas-para-transferir-ou-encerrar.md e avisar-o-novo-endereco-e-cadastros.md, por tocarem em contrato e em órgãos públicos.
- Contato para dúvidas: o que consta no perfil do criador na plataforma.
