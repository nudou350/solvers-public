# Guia do Solvers para quem nunca viu blockchain

[English](concepts-guide.md) | Português

Estado em 02/10/2026. Tudo roda na **devnet** (a Solana de brincadeira, com dinheiro de teste). Mainnet (dinheiro de verdade) é plano, não realidade.
Onde algo é **protótipo ou ainda não existe**, está marcado com 🚧.

---

## 1. A história inteira em 6 linhas

1. Um **criador** monta um "especialista" (solver): uma pasta de texto com passos, conhecimento e modelos. Não é programa, é **receita**.
2. O **servidor** guarda a receita e entrega **um passo por vez** para o Claude/ChatGPT do comprador (por um "conector" chamado MCP). Quem tem a receita inteira num arquivo copia de graça; por isso ela fica trancada no servidor.
3. O **comprador** paga em USDC e recebe uma **licença**: um item digital único (NFT) que vai para a carteira dele.
4. O servidor olha a carteira: "tem licença? então libera".
5. **Garantia** = o dinheiro fica num cofre até o trabalho passar nos testes.
6. **Agentes de IA sem humano** também compram (x402): pagam pela internet e a licença cai na carteira deles.

---

## 2. Conceitos de blockchain

| **Blockchain** | Um caderno gigante que **milhares de computadores copiam ao mesmo tempo**. Você só escreve no fim, e ninguém consegue apagar nem rasurar o que já foi escrito. | O caderno é a **Solana**. |
| **Por que usar** | Ninguém precisa **confiar na nossa palavra**: qualquer um confere no caderno quem comprou, quanto o criador recebeu, qual a nota. | Licenças, avaliações, garantias e reputação. |
| **Carteira (wallet)** | Seu **endereço** no caderno (como um número de conta) + uma **chave secreta** que só você tem (como a senha-caneta). | Login por e-mail (Privy) **cria uma carteira embutida**; o usuário nem vê. |
| **Chave privada / assinatura** | Assinar = provar "fui eu" sem mostrar a senha. Sem assinatura ninguém mexe nas suas coisas. | Comprar, avaliar, abrir disputa: o usuário assina. |
| **Transação** | Uma **frase escrita no caderno**: "Ana paga 10 para Beto". | Toda compra é uma transação que o servidor monta e o usuário assina. |
| **Taxa de rede (fee payer)** | Cada frase custa uns centavos de **SOL** (moeda da Solana). | **A plataforma paga sempre** (usuário não precisa de SOL). |
| **USDC** | Moeda digital que vale 1 dólar. | Preço de tudo. Na devnet é um USDC **de teste** que a gente mesmo cria (tem "torneira" grátis). |
| **Devnet / Mainnet** | Devnet = campo de treino. Mainnet = o jogo valendo. | Estamos na devnet. |
| **Programa (smart contract)** | Um **robô-juiz que mora no caderno**: segue regras escritas em código, ninguém consegue subornar nem mudar na hora. | `programs/solvers` (Rust/Anchor): licenças, créditos, avaliações, garantia, stake, revenda. |
| **Conta (account)** | Uma **gaveta** no caderno onde o programa guarda dados. | `Agent` (o solver), `Escrow` (garantia), `Review`, `Credits`, `Config`... |
| **PDA** | Gaveta cujo endereço é **calculado por fórmula** (ex.: "gaveta do solver X") e que **só o programa abre**. Nem a plataforma abre. | Os cofres da garantia e do stake são PDAs. |
| **Rent** | "Aluguel" da gaveta: quem abre uma conta deixa um depósito, devolvido ao fechar. | **A plataforma paga**; por isso toda compra precisa ser **≥ 5 USDC** (`min_price`). |
| **NFT** | Um **item digital único com dono registrado** no caderno. | A **licença**. Quem é o dono da licença tem acesso. |
| **Metaplex Core** | O "formato padrão" desses itens na Solana (barato e simples). | Cada solver tem uma **coleção**; cada licença é um item dela. |
| **Hash** | **Impressão digital** de um arquivo: mudou 1 letra, muda tudo. | `versionHash` (pacote), `content_hash` (texto da avaliação), `criteria_hash` (testes da garantia), `deliverable_hash` (entrega). Grava só a digital, o texto fica fora. |
| **Evento + indexador** | O programa "grita" o que aconteceu; o **indexador** ouve e copia para o nosso banco (rápido de consultar). | Webhook da Helius + varredura de reserva a cada 10 s. O banco é **espelho**; a verdade é a cadeia. |
| **Escrow** | **Cofrinho com dois cadeados**: o dinheiro sai do comprador, fica preso, e só solta quando a regra manda (para o criador ou de volta). | A **garantia** (seção 8). |
| **Stake** | **Depósito de boa-fé** do criador: se enganar, pode perder. | `min_stake` (hoje 0 na devnet, então ainda não protege de verdade). |
| **Merkle root** | Uma **única impressão digital que resume uma lista inteira** de recibos. | Lote de usos verificados, a cada 10 min. |
| **Basis points (bps)** | Porcentagem em centésimos: 1000 bps = 10%. | Taxa e royalty. |
| **Upgrade do programa** | Trocar o robô-juiz por uma versão nova mantendo as gavetas. | Gavetas antigas **nunca mudam de formato**; só se acrescenta. |

**O que NÃO está na blockchain** (e dá para você responder com clareza): o **conteúdo** do solver (passos, conhecimento), as **memórias** do usuário, as **sessões**, o **texto** das avaliações (só a digital), o catálogo e os preços em reais/Pix. O que **está**: dono da licença, preço, vendas, notas, créditos, garantia, stake, versão (hash) e reputação.
**Limite honesto:** a licença é do usuário, mas quem **libera o conteúdo é o nosso servidor** lendo a carteira. Se o servidor sumir, o usuário continua dono do NFT, mas não tem como rodar o solver.

---

## 3. Quem é quem

| Quem | Faz o quê |
|---|---|
| **Criador** | Escreve o pacote, define preço, ganha por venda, pode limitar o nº de licenças. |
| **Comprador (humano)** | Loga por e-mail, paga, conecta o Claude/ChatGPT ao conector. |
| **Agente autônomo** | IA sem humano, com um keypair Solana e USDC. Compra por x402. |
| **Servidor (plataforma)** | Entrega etapas, conhecimento, ferramentas, memória; monta transações; paga a taxa de rede; indexa. |
| **Chaves do sistema** | `admin` (carteira **fria**, fora da VPS: aprova solvers, julga disputas, confisca stake) · `verifier` (servidor: marca etapa como "passou nos testes", grava nota) · `usage_authority` (servidor: gasta créditos, grava lotes) · `custody` (servidor: recebe e repassa USDC do x402). Chaves separadas: vazar a VPS não permite roubar stakes. |
| **Pausa de emergência** | Admin liga/desliga; o **guardian** só consegue **ligar**. Pausa entradas (compras) e/ou pagamentos; saídas do comprador nunca pausam. |

---

## 4. Fluxo do criador

> Código na branch `feat/criador-solvers` (ainda **sem deploy**). Guia completo: `docs/criador-solvers.md`.

### 4.1 Montar o pacote
Pasta `agents/<slug>/`: `manifest.json` (nome, preço, etapas, ferramentas, teste grátis, garantia, teto de licenças), `steps/` (um `.md` por etapa, com checklist "gate"), `knowledge/` (textos que a IA consulta), `templates/`, `evals/` (casos de teste). Formato completo: `PACKAGE_SPEC.md`.
O criador não precisa escrever tudo à mão: existe o **Criador de Solvers**, um solver **gratuito da plataforma** (só no banco, sem blockchain) que, dentro do Claude/ChatGPT do criador, guia **7 etapas** (promessa, diferenciais, etapas, conhecimento, ferramentas, calibragem, evals), consulta o validador do servidor e entrega o ZIP.

### 4.2 Como o pacote passa nos testes (3 camadas)

| Camada | O que faz | Quem decide |
|---|---|---|
| **1. Validador** (estrutura) | Schema único em código (zod), **67 códigos** de erro `E` (bloqueia) ou aviso `A`. ZIP sem `..`/links/arquivos gigantes, caminhos presos na pasta, tamanhos, `slug`/versão, preço ≥ 5 USDC, etapas com as 5 seções, conhecimento com fonte e data (`AAAA-MM-DD`), **≥ 10 casos de eval**, **≥ 2 de 5 "diferenciais" comprovados** pelo próprio pacote (terceiros só provam memória, dado vivo e escalonamento), terceiro **sem ferramentas, sem garantia, sem categorias reguladas** (Finanças, Jurídico, Saúde). Roda sozinho no envio e também em `cli:validate`. | Máquina (erro barra o envio) |
| **2. Varreduras** ("é malicioso?") | **Avisos** com gravidade `info/warn/high`, mostrados ao revisor: Unicode invisível ou de direção, HTML/CSS escondido, imagem remota (pode vazar dados ao carregar), frases de injeção de prompt PT/EN ("ignore as instruções anteriores", "não conte ao usuário"), pedido de dado sensível, URL de envio de dados, **conteúdo copiado de outro pacote publicado**, frases de busca fora do assunto, conhecimento vencido. | Máquina avisa, **humano decide** |
| **3. Evals** ("funciona?") | Casos com checagens simples (`regex`, `contains`, `not_contains`) aplicadas a **respostas geradas antes** com o solver ativo. Gera `report.json` (nota em `scoreBps`, 8750 = 87,5%, e hash). | Máquina |

**Limites que você deve saber dizer:** as varreduras são **heurísticas contornáveis**; ninguém garante achar uma injeção escondida num trecho entre milhares nem um comportamento condicional. A defesa real é **convite + tetos + revisão humana de 100% das versões + desligar rápido**. O servidor **nunca roda código de terceiros** e trata o conteúdo do criador como **não confiável**. Nota de desempenho: terceiros **não têm** (a vitrine mostra "Sem avaliações ainda", só notas de compradores); pacotes da equipe mostram "teste interno da equipe", nunca "verificado".

### 4.3 Upload, validação e revisão humana

1. **Convite:** a equipe gera um código `SLV-XXXX-XXXX-XXXX` (`cli:invite create`) e envia por e-mail. Vale uma vez e fica preso à carteira de quem usar. Sem convite não há envio.
2. **Perfil:** em `/creator/publish` o criador loga, preenche nome, bio, aceita os termos e informa o código. O contato de escalonamento (Telegram) só fica "verificado" quando a equipe o vincula (`cli:invite set-chat`).
3. **Envio do ZIP:** o servidor só **guarda o arquivo e responde na hora** (202). Limites: ZIP 50 MB, 150 MB depois de extraído, 2.000 arquivos, 10 MB por arquivo, só `.json/.md/.txt`, **3 envios em andamento** e **5 por dia** por criador.
4. **Worker:** um processo **separado** (`solvers-worker`, para não derrubar a API que serve o MCP e os pagamentos) extrai o ZIP, valida, varre e indexa o conhecimento numa área de **testes (staging)**, um por vez, retomando de onde parou se reiniciar.
5. **Revisão humana** em `/admin/reviews` (quem vê é quem está em `ADMIN_WALLETS`; é só permissão do site, **não assina nada na blockchain**). O revisor vê: erros/avisos do validador, manifesto, **diff de TODOS os arquivos** contra a versão publicada, buscas de teste no conhecimento, varreduras, diferenciais declarados × comprovados. Tudo como **texto escapado** (nunca HTML). Para **aprovar** precisa marcar o checklist inteiro (promessa entregue, 2 de 5 diferenciais, fontes e direitos, nada contra o usuário/sem envio de dados/sem injeção, preço e vitrine coerentes) e escrever um motivo. Também pode **pedir mudanças**, **recusar** ou **revogar** uma aprovação ainda não assinada. Tudo fica numa **trilha somente-inserção** (`package_reviews`). Meta: 5 dias úteis.
6. **Co-assinatura:** aprovado, o **criador assina na carteira** `register_agent` (solver novo) ou `update_version` (atualização); a plataforma paga a taxa. A plataforma **nunca guarda chave de criador de terceiros**.
7. **Aprovação on-chain (só solver novo):** o dono roda `cli:approve <slug>` com a **carteira fria** (`approve_agent`). O comando só aprova se a conta na cadeia **bate** com a versão aprovada no site. Só aí o solver aparece na vitrine.

**Estados de um envio:** `submitted → validating → (rejected_validation | pending_review) → (changes_requested | rejected | awaiting_creator_signature) → awaiting_onchain_approval → publishing → published`; depois `suspended`, `withdrawn` ou `superseded` (versão nova). `publish_failed` = um passo falhou e a vitrine **não mudou**; o admin repete com "Concluir" ou `cli:approve` (seguro repetir). Envio parado 30 dias em `changes_requested` ou esperando assinatura **expira** e libera o nome (faxina a cada 6 h; ZIPs rejeitados somem em 30 dias).

**Nova versão:** mesmo `slug`, `version` **maior**, e **passa de novo por toda a revisão** (para barrar "versão boa, depois troca"). Mudar ferramentas, calibragem, requisitos ou a estrutura das etapas exige subir a versão MAJOR.
**Trapaça possível e a defesa:** o criador pode chamar `update_version`/`update_pricing` **direto na cadeia**, sem revisão. O indexador compara com as versões aprovadas; se divergir, marca `unapproved_chain_version`, **continua servindo o pacote aprovado** e **bloqueia a venda** (`price_in_review`) até a revisão aprovar ou ele reverter.

Os 6 solvers antigos e os da plataforma (ex.: Criador de Solvers) **não passam por esse fluxo**: a autoridade de "ser da plataforma" é uma lista no servidor (`PLATFORM_AGENTS`), não o campo do manifesto, e eles saem pela CLI (`cli:publish`).

### 4.4 O que vai para a blockchain na publicação
- **Criador assina:** `register_agent` (cria o solver, a coleção de licenças e o stake) e, se o preço mudou, `update_pricing`.
- **Admin frio assina:** `approve_agent` (sem isso o solver fica `Pending` e não vende).
- Cada versão nova: `update_version` (muda a digital, **zera a nota**).
- Nota de desempenho (`set_eval`): só pacotes da plataforma.
- O que **não** vai: o pacote, o ZIP, o texto da revisão.

Estados do solver on-chain: `Pending → Active ⇄ Suspended`, e `Retired` (criador pediu para sair; stake só sai depois de 30 dias).
**Kill switch:** `cli:suspend <slug>` faz as **duas** coisas: marca `platform_status = suspended` no banco (derruba sessões abertas, vitrine e venda na hora; o indexador nunca escreve esse campo) **e** roda `suspend_agent` na cadeia (senão alguém ainda compraria direto). `--resume` desfaz. Sai da vitrine sozinho com **nota média < 3,5 depois de 10 avaliações** (quem já comprou continua usando).

### 4.5 Dinheiro do criador
Na compra, **na mesma transação**: taxa da plataforma (`fee_bps`, teto 20%) vai para a tesouraria e o resto **cai direto na conta de USDC do criador**. Não há reembolso de licença. Revenda paga **royalty** ao criador (seção 9).

---

## 5. Fluxo do comprador humano

1. **Entrar:** e-mail no Privy → carteira embutida (ou Phantom). Login = assinar uma mensagem (SIWS, "Sign In With Solana") → token de sessão.
2. **Escolher e pagar:** vitrine → checkout. Formas: USDC na carteira · **Pix** · **SODAX**. 🧪 Na demo Pix e SODAX são **simulados** (creditam USDC de teste; SODAX dá cotação real, pagamento falso). Mainnet rejeita simulação.
3. **`POST /api/tx/purchase`:** o servidor monta a transação `purchase_license` (com o **preço que o usuário viu**, `expected_price`: se o criador mudar o preço no meio, a compra **falha** em vez de cobrar outro valor). O usuário assina; a plataforma paga a taxa de rede.
4. **O programa confere e executa tudo ou nada:** solver `Active`? stake ≥ mínimo? preço ≥ 5 USDC? não pausado? teto não estourado? Então: divide o USDC (plataforma/criador), **cria o NFT na carteira do comprador** e soma a venda na reputação.
5. **Evento → indexador → banco → `list_my_solvers` mostra.** Se o banco ainda não viu, o conector confere direto na cadeia.

**Teto de licenças:** o criador pode limitar (ex.: 10). O **programa** impede a venda além disso (`SoldOut`); queimar/revender/transferir **não** libera vaga; o criador só pode **aumentar** o teto. Nunca prometa "só existirão N": diga "o limite atual é N e só pode subir".
**Outros modos de compra:** **créditos** (pague por uso: `buy_credits`; cada ativação gasta 1) e **garantia por tarefa** (seção 8).

---

## 6. Usar o solver (conector MCP)

1. **Conectar:** usuário cola `https://solvers.wondervelop.com/mcp` no Claude/ChatGPT. O `/mcp` responde 401 → o cliente descobre o **OAuth** sozinho (registro automático + PKCE) → abre a página "Conectar sua carteira" → usuário assina → o cliente recebe um token **ligado à carteira**.
2. **Ferramentas** (a IA as chama sozinha): `list_my_solvers`, `find_solver` (busca por significado), `get_purchase_link`, `activate_solver`, `preflight_check`, `next_step`, `search_knowledge`, `run_tool`, `get_memory`, `save_memory`, `submit_deliverable`, `escalate_to_creator`, `list_open_guarantees`, `get_template` (modelos do pacote).
3. **Fluxo:** `activate_solver` confere licença (ou crédito, ou teste) e abre uma **sessão** → `preflight_check` (a IA tem as ferramentas exigidas?) → `next_step` entrega **uma etapa por vez** (com checklist que a IA precisa cumprir) → `search_knowledge` (**RAG**, seção 7.1: 5 trechos do conhecimento achados por significado, com fonte, data e marca por carteira).
4. **Teste grátis:** 3 usos por carteira por solver (off-chain, no banco; só o que o criador liberar). **Agentes não têm teste** (carteira nova custa zero).
5. **Memória e calibração** (seção 7.2): preferências do usuário, cifradas (AES-256-GCM); a chave nasce de uma **segunda assinatura** do usuário e fica guardada embrulhada pela chave-mestra do servidor. É **cifra em repouso**: não prometa "só você lê".
6. **Avaliar:** `submit_review` exige **licença** (ou créditos comprados). Uma licença prova **uma** avaliação (`license_review`). Texto fica fora; **só a digital + nota 1-5** vão on-chain.
7. **Escalar:** `escalate_to_creator` manda resumo ao Telegram do criador (humano de reserva).
8. **Registro de uso:** cada uso verificado vira recibo; a cada 10 min um **lote** grava a contagem + Merkle root on-chain (`record_usage_batch`).

---

## 7. RAG e calibração (como o especialista "sabe" e "se adapta")

Dois problemas, duas peças. **Nenhuma das duas treina ou altera o modelo de IA** (Claude/ChatGPT continuam exatamente os mesmos).

| | **RAG** (o que o especialista sabe) | **Calibração** (o que ele sabe sobre você) |
|---|---|---|
| **Comparação** | Uma **biblioteca com bibliotecário**: em vez de a IA decorar tudo, ela pergunta e recebe só as páginas certas. | Uma **ficha do cliente**: na primeira visita o atendente pergunta o essencial e anota; nas próximas já te conhece. |
| **De quem é** | Do criador (igual para todos os compradores). | Do usuário (uma ficha por carteira **e** por especialista). |
| **Onde fica** | Banco, em trechos com vetores (`knowledge_chunks`). | Banco, **cifrada** (memória). |
| **Quando age** | Quando a IA chama `search_knowledge`. | No primeiro uso (`get_memory`) e em toda etapa que lê o perfil. |

### 7.1 RAG (Retrieval-Augmented Generation = "buscar antes de responder")

**Por que existe:** a IA não pode receber o conhecimento inteiro de cada vez (caro, lento, e ainda dava o produto de graça). Então guardamos os textos no servidor e entregamos **só 5 trechos** por consulta.

**Preparação (na publicação, uma vez):**
1. O criador escreve textos `.md`/`.txt` em `knowledge/`, cada um com cabeçalho: título, **fonte**, data da fonte, `valid_until` (validade) e, opcionalmente, `trial: true` (liberado no teste grátis).
2. O servidor **corta em trechos** (chunks) de ~2.000 caracteres (~500 "palavras-pedaço"), respeitando títulos e parágrafos e repetindo ~200 caracteres entre um e outro para não cortar uma ideia ao meio.
3. Cada trecho vira um **vetor** (embedding): uma lista de 384 números que representa o **significado** do texto, de modo que textos parecidos em sentido ficam "perto" um do outro (como pontos num mapa). O modelo é local na VPS (`multilingual-e5-small`), **custo zero** e sem mandar texto a terceiros. Vão para o Postgres com pgvector.

**No uso (a cada consulta):**
1. A IA do usuário chama `search_knowledge` com a dúvida. O servidor transforma a dúvida em vetor e busca os **5 trechos mais próximos**, só do **solver e da versão** que o usuário tem (nunca mistura solvers).
2. Cada trecho volta com **título, fonte e data**; se passou do `valid_until`, volta com **aviso "pode estar desatualizado"** e a IA é instruída a **citar a fonte** e sugerir confirmar.
3. Cada resposta leva uma **marca d'água** (frase de controle que varia por carteira) para rastrear vazamento.
4. Proteções: **cota diária** de consultas por carteira e solver (impede esvaziar a base copiando); no **teste grátis** só os arquivos marcados `trial: true`; sem licença, nada.

**Mesma ideia, outro uso:** `find_solver` e a busca da vitrine também usam vetores: cada solver tem um vetor do texto todo e um por frase de busca (`searchPhrases`), e o pedido do usuário ("preciso de um site bonito") acha o mais próximo. Só entram os que estão "coladinhos" no melhor resultado. Se o modelo não carregou, cai numa busca por palavras do Postgres.

**Limites para saber dizer:** o RAG **acha** trechos, não garante que a IA os use bem; a qualidade depende do que o criador escreveu; busca por significado pode trazer trecho parecido porém errado (por isso fonte e data aparecem). O revisor humano checa as fontes e a varredura avisa conteúdo vencido ou copiado. Terceiros no Núcleo só enviam `.md`/`.txt` (PDF fica para a "Abertura").

### 7.2 Calibração: o "fine-tuning artificial" (sem treinar nada)

**Fine-tuning de verdade** = retreinar o modelo com seus dados (caro, lento, o modelo "muda por dentro"). **Aqui não fazemos isso.** Fazemos o equivalente prático: **perguntar na primeira vez, guardar as respostas e fazer cada etapa ler a ficha**. Parece que o especialista foi feito para o caso do usuário, mas o modelo é o mesmo.

**Como o criador configura:** em `manifest.onboarding` declara de **1 a 5 perguntas**, cada uma com `ask` (a pergunta), `why` (por que pergunta, que a IA pode explicar) e `options` opcionais (2 a 6). Exemplo: "Qual seu regime tributário?" (por que: "muda quais obrigações valem para você"). O validador sinaliza pergunta de **dado sensível** e o revisor decide.

**Fluxo no primeiro uso:**
1. O usuário ativa o solver. O servidor manda a IA chamar `get_memory` **antes da etapa 1**.
2. Não há ficha ainda → o retorno traz `needs_onboarding` com as perguntas. A IA as faz em **no máximo 2 mensagens**, explicando o motivo de cada uma. **Toda pergunta pode ser pulada.**
3. A IA grava as respostas (`save_memory`, tipo `profile`). Se o usuário pulou, grava `skipped` e **não pergunta de novo** a cada sessão.
4. Nas etapas seguintes a IA lê o perfil e **adapta** exemplos, linguagem e escolhas. O usuário pode pedir "recalibrar" a qualquer momento (substitui a ficha).
5. Fora a calibração, a IA só guarda **notas** (até 30) quando o **usuário pedir** ("lembra disso").

**Regras de segurança:** o perfil é **dado do usuário, não instrução**: ele **não pode remover etapas nem itens de checklist** do método (senão virava brecha para pular o que o criador exigiu). Vale também no teste grátis. A ficha é **cifrada** (AES-256-GCM, chave derivada de uma segunda assinatura da carteira). É cifra em repouso: o servidor abre enquanto o token vale, então **não prometa "só você lê"**. Sem a assinatura da memória (conexão sem ela) → `onboarding_unavailable`: o solver segue com os padrões e avisa como reconectar. A memória é **por carteira + especialista**, **não acompanha** a licença se ela for revendida, e o usuário pode **apagar** tudo pela vitrine.
**Dados no computador do usuário** (planilhas, arquivos que a IA dele lê) **ficam lá**; só o que passa pelas ferramentas chega ao servidor.

---

## 8. Garantia (escrow)

**Comparação:** você contrata um pintor e deixa o dinheiro **num cofre do cartório**. O pintor só recebe se o muro passar na vistoria. Se não passar, o dinheiro volta.

**O que é escrow aqui:** o programa abre um `Escrow` + um **cofre PDA** (só o programa mexe), até **5 etapas**, cada etapa com valor e **critério combinado antes** (`criteria_hash` = digital dos testes de aceite). Ninguém, nem a plataforma, tira o dinheiro por fora das regras.

| # | O que acontece | Quem |
|---|---|---|
| 1 | Combina tarefa, etapas, valores, testes e prazo (padrão 14 dias, máx. 60). USDC vai do comprador para o cofre (`create_escrow`). | Comprador assina |
| 2 | A IA entrega (`submit_deliverable`). O servidor roda os testes **combinados antes** (a entrega não troca os testes) num **Docker descartável**: sem internet, CPU/memória limitadas, 60 s, sem privilégios. | Servidor |
| 3 | Passou → `mark_passed` on-chain (com a digital da entrega) + **prévia com marca d'água**. O **código só é liberado depois da aprovação**. | `verifier` |
| 4a | Comprador gosta → `release_milestone`: criador recebe (menos taxa). | Comprador |
| 4b | Não faz nada → passa a **janela de revisão** (1 min a 30 dias) → **liberação automática** (job de 1 min). | Qualquer um/job |
| 4c | Não gosta → `open_dispute` → o **admin julga** (`resolve_dispute`: reembolsa ou paga). Se o admin não julga em **7 dias**, qualquer um devolve ao comprador (`resolve_stale_dispute`). | Admin |
| 5 | Criador **nunca entregou** até o prazo → comprador cancela (`cancel_undelivered`), **sem taxa**. | Comprador |
| 6 | Tudo resolvido → `close_escrow` devolve o rent à plataforma. | Plataforma |

**Proteções:** quem perde disputa ganha uma marca (`disputes_lost`; comprador com **3** não abre garantia nova; criador cai no ranking). Limites por reputação do comprador: **conta nova (<3 compras) até 20 USDC** (acima de 10, mínimo 2 etapas) · confiável até 500 USDC · nível "none" com ≥3 disputas perdidas. Compra mínima 5 USDC. Taxa e prazos ficam **congelados na criação** da garantia.
**Stake do criador:** se ele enganar, o admin **propõe confisco** → espera **72 h** → o criador pode contestar (só evidência) → **executa** (dinheiro vai à tesouraria; janela de 14 dias). Como `min_stake` está em 0, hoje não há o que confiscar. Hoje **só pacotes da plataforma** oferecem garantia; a decisão de disputa é **manual do admin** (simulação de arbitragem).

---

## 9. Revenda de licença

Dono anuncia a licença por um preço → outro compra pelo mercado do Solvers → a licença **troca de carteira na mesma transação**. **Sem custódia:** a licença fica com o vendedor até a venda (ele só autoriza o programa a transferi-la). Preço dividido: **royalty** ao criador + **taxa** da plataforma + **resto** ao vendedor (ex.: 100 → 5 criador, 10 plataforma, 85 vendedor; os dois juntos ≤ 50%). Criador não revende a própria licença. Royalty vale **só no nosso mercado** (transferir por fora é livre e sem royalty). Memórias **não** acompanham a licença (são da carteira). Revenda **não** consome vaga do teto. Controlada pela flag `RESALE_ENABLED`; mainnet espera os termos com advogado.

---

## 10. Compras autônomas: x402

**x402** = usar o código HTTP **402 "Pagamento necessário"** (esquecido desde 1990) para um robô pagar pela internet sem conta, cartão ou humano.

**Passo a passo (`POST /api/x402/solvers/:id/license`):**
1. O agente pede a compra. O servidor cria uma **ordem com preço travado** e responde **402** dizendo: quanto, em qual rede, para quem pagar e um **memo** (= id da ordem, amarra o pagamento àquele pedido).
2. O agente assina uma transferência de USDC e **repete o pedido** com o cabeçalho `PAYMENT-SIGNATURE`.
3. O **facilitator** (o "caixa" do x402) **confere** a transferência, **paga a taxa de rede** pelo agente (ele só precisa de USDC) e **envia** à Solana. Ele **não converte moeda** e não tem relação com o SODAX.
4. Com o pagamento confirmado, a **custódia** da plataforma executa `purchase_license` e **transfere o NFT para quem pagou** (nunca para um endereço informado: menos abuso).
5. Se o pagamento passou mas a licença **falhou**, a ordem é **reembolsada** ao pagador, e só depois de ter certeza de que a emissão não vai entrar na rede (senão o agente ficaria com os dois).

**Por que a custódia existe:** o x402 só aceita **uma** transferência simples de USDC; o `purchase_license` é mais complexo. Então a plataforma **recebe** o USDC e **compra por ele**. Consequência para você explicar: há um instante em que a plataforma segura dinheiro de terceiros; por isso há reconciliação (a cada 60 s) e reembolso idempotente. O programa **não mudou** por causa do x402.
**Ordem:** `created → settling → paid → minting → minted` (ou `refunding → refunded`, `expired`, `failed`). Liquida **antes** de emitir (`upfront`): senão a licença nasceria de graça se o pagamento falhasse.
**Regras:** preço entre **5 e 100 USDC** por compra; sem teste grátis; erro `already_owned` (já tem) e `creator_cannot_buy`; vale o teto e a pausa.
**Entrar no conector sem navegador:** `GET /oauth/agent/nonce` + `POST /oauth/agent/token` (assina uma mensagem; 2 chamadas). A assinatura diz "**isto não autoriza pagamentos**": o login nunca move fundos. O token é marcado como agente (`client_id=agent`), e as respostas trocam "mostre ao usuário" por instruções de compra x402 e "decida pelo contexto e registre a suposição".
**Status:** validado na devnet em 02/10/2026; **mainnet bloqueada até parecer jurídico** (custódia de dinheiro de terceiros).

---

## 11. O que é real e o que é de mentira hoje

| Real | Simulado / planejado |
|---|---|
| Compra, NFT, teto, revenda, créditos, avaliações, garantia e testes em Docker, x402, upgrade da devnet | Pix, SODAX (pagamento) e USDC (teste, na devnet) · arbitragem de disputa = admin manual · stake em 0 · upload e revisão: prontos na branch `feat/criador-solvers`, **sem deploy ainda** · 🚧 mainnet · Cloak/Zcash (roadmap) |

---

## 12. Perguntas que você tem que saber responder

1. **Onde fica a licença?** Num NFT na carteira do usuário. O acesso é liberado pelo nosso servidor lendo a carteira.
2. **O que a blockchain guarda e o que não?** Dono, preço, vendas, notas (digital), créditos, garantia, stake, hash da versão. **Não** guarda o conteúdo, memórias, sessões nem o texto das avaliações.
3. **Quem paga a taxa de rede?** A plataforma, sempre. Por isso o mínimo é 5 USDC (cobre o rent).
4. **Como sei que um solver não é malicioso?** Convite + validador + varreduras (avisos) + revisão humana de 100% das versões, com diff + sem execução de código de terceiros + kill switch. Não há garantia absoluta, e a spec admite isso.
5. **Como sei que funciona?** Evals (casos com checagens); a nota só é on-chain para pacotes da plataforma.
6. **O que é escrow e quem decide?** Cofre PDA; testes automáticos liberam, comprador aprova ou contesta, **admin julga**, e há prazos que resolvem sozinhos (auto-liberação, 7 dias de disputa, prazo de entrega).
7. **E se o criador sumir?** Garantia: cancela sem taxa após o prazo. Licença já paga: não há reembolso automático (por isso stake, kill switch e curadoria).
8. **O que é x402 e por que custódia?** Pagamento HTTP para robôs; a plataforma recebe e compra no nome do agente, entrega o NFT ao pagador e reembolsa se falhar.
9. **Um agente vê o conteúdo sem pagar?** Não: sem licença não há conteúdo e agentes não têm teste.
10. **O criador pode "congelar" a oferta?** Pode limitar licenças, mas o limite só **sobe**; não prometa escassez eterna.
11. **Quem pode mexer no dinheiro?** Só o programa, pelas regras. As chaves do servidor (`verifier`, `usage_authority`) não conseguem sacar cofres; a `admin` é fria.
12. **O que é RAG?** Buscar antes de responder: o conhecimento do criador vira trechos com "significado em números" (vetores) no banco; a IA pede, recebe só 5 trechos relevantes com fonte e data. Não treina o modelo.
13. **O que é o "fine-tuning" do Solvers?** Não é fine-tuning: o modelo não muda. É **calibração**: 1 a 5 perguntas no primeiro uso (puláveis), respostas guardadas cifradas na memória, e cada etapa lê o perfil para adaptar. O perfil nunca remove etapas do método.
14. **RAG × memória?** RAG = o que o especialista sabe (do criador, igual para todos). Memória = o que ele sabe sobre você (da sua carteira).
15. **O que a mainnet exige?** Parecer jurídico (x402/custódia, revenda, termos de criador), simulações desligadas, chaves reais e as pendências de `docs/mainnet-runbook.md`.

---

## 13. Onde está cada coisa no código

| Assunto | Arquivo |
|---|---|
| Regras on-chain | `programs/solvers/src/instructions/*.rs`, `state.rs` |
| Validador, varreduras | `apps/server/src/runtime/validate/` |
| Publicar | `apps/server/src/cli/publish.ts` |
| Evals | `scripts/src/eval.ts`, `agents/<slug>/evals/` |
| Conector MCP, OAuth | `apps/server/src/mcp`, `oauth` |
| Garantia e testes Docker | `apps/server/src/verifier`, `store/escrow.ts`, `jobs.ts` |
| x402 | `apps/server/src/x402`, `docs/x402-agentes.md`, `docs/agentes-login.md` |
| Revenda, teto | `docs/resale.md`, `docs/licencas-limitadas.md` |
| Indexador | `apps/server/src/indexer` |
| RAG (corte, vetores, busca, cota) | `apps/server/src/knowledge` |
| Memória e calibração | `apps/server/src/memory`, `mcp/tools.ts` (`get_memory`, `save_memory`) |
