# Reviewer note: Apartment Move (version 1.0.0)

This file is only for the person reviewing the package. It does not reach the buyer.

## What the Solver promises

- Promise in one sentence: plan an apartment move by deadline, from the moving company to the last change-of-address notice, including the move-out inspection.
- Audience: people moving apartments (rented or owned) in Brazil, without professional help.
- What it does NOT do: (1) legal advice about the contract, security deposit or penalty; (2) recommend a specific company or guarantee a price; (3) international or office moves, or filling in forms for the user.
- Category chosen and why: Dia a dia (everyday life). The content touches on rental contracts and public registrations, so steps 1, 3 and 4 and the knowledge files carry the caveat "check the official website / with the rental agency or a lawyer". No amount, legal deadline or fee is stated as certain.
- Language: the package is in English; the catalog texts in Portuguese are in locales/pt.json. The domain content is Brazil-specific (Detran, TSE, Receita Federal, Correios, Procon, Lei do Inquilinato, IPTU) and is described as such.

## Differentiators and how to check them (at least 2)

- liveData: 11 files in knowledge/ with source, source_date and valid_until; manifest with knowledge.updatedAt=2026-10-02 and reviewEveryDays=90. Who updates and when: the creator (Marina), every 90 days; the content about agencies and utility companies is always marked "check the official website".
- memory: onboarding with 4 questions (situacao_imovel, volume, quem_ajuda, ja_mudou); steps 1 to 4 read the profile with get_memory and change the tasks and the level of explanation (for example, step 2 swaps packing tasks when the person hires a company with packing).
- escalation: not declared.

## Sources and rights

- Sources: the creator's own experience of three apartment moves (2 rentals and 1 owned property), 2026-10-02; generic mentions of the official websites of utility companies, banks, Detran, TSE, Receita Federal, Correios, Procon and consumidor.gov.br, only to indicate what to check (no text copied). Mention of the Brazilian Tenancy Law (Lei 8.245/1991) without interpretation of deadlines.
- Third-party material used and how permission was obtained: none.

## Validator warnings that remained and why

- no warnings (check the output of the latest validation)

## Plan for the Opening phase (tools and verification)

- Future tool: none.

## How to test quickly

- Example request 1: "I am moving in 5 weeks, rented apartment, I need a schedule". Expected: short questions (date, home, volume, help) and a schedule by deadline windows with 3 critical tasks.
- Example request 2: "I got two moving quotes, which one should I pick?". Expected: the comparison with what each one includes and the insurance and cancellation questions, without recommending a company or making up prices.
- The test cases are in evals/cases (12 cases); no rating was created.

## Creator's note

- Where the reviewer should look most carefully: steps 3 and 4 and the files aviso-previo-e-chaves-do-aluguel.md, contas-para-transferir-ou-encerrar.md and avisar-o-novo-endereco-e-cadastros.md, because they touch on contracts and public agencies.
- Contact for questions: what is on the creator's profile on the platform.
