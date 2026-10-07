---
title: Minimal complete example: MEI Monthly Closing (all files)
source: Illustrative example from the Solver Creator, based on the minimal example of the v1 specification; MEI values and rules used only as a demonstration
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [example, minimal, mei, complete-package]
---

# Minimal complete example: MEI Monthly Closing (all files)

This is a small, complete package with everything that has to exist. **This example is Brazil-specific**: MEI (Microempreendedor Individual) is Brazil's micro-entrepreneur tax regime, DAS-MEI is its monthly tax payment slip, and the Receita Federal and the Portal do Empreendedor are the official Brazilian federal sources. The MEI values appear only to demonstrate the format: **in a real Solver, check every number at the official source and use the source's date**. The excerpts of `.md` files are indented by 4 spaces so they do not mix with the headings of this knowledge file: when copying, remove the indentation. The five step section titles (`Goal`, `What to ask the user`, `How to run`, `Common mistakes`, `result_summary format`) are the English standard that the validator looks for; the old Portuguese titles are still accepted for older packages. The text under them is in English here.

## Package structure

The root folder is called `fechamento-mei` and contains:

- `manifest.json`
- `steps/01-levantar-notas.md`, `steps/02-classificar.md`, `steps/03-gerar-guia.md`
- `knowledge/das-mei-2026.md`, `knowledge/limites-faturamento.md`
- `templates/relatorio-mensal.md`
- `evals/cases/01-...json` through `10-...json`
- `README.md` (a note to the reviewer)

Differentiators: `liveData` (dated base), `memory` (activity calibration, used in step 2) and `escalation` (the creator handles complex cases, with Telegram linked).

## manifest.json

```
{
  "specVersion": 1,
  "slug": "fechamento-mei",
  "name": "MEI Monthly Closing",
  "tagline": "Close your MEI month without errors: limit, DAS and report",
  "description": "Guides the AI through a monthly closing for a Brazilian MEI: collects the month's revenue, checks the annual revenue limit, calculates the DAS with the year's values and delivers a report ready to keep. The base brings the rules and values with source and date. It does not do full accounting, does not file income tax returns and does not replace an accountant: always check on the Portal do Empreendedor.",
  "category": "Negócios",
  "version": "1.0.0",
  "usesMemory": true,
  "creator": { "id": "my-profile", "name": "Simple Accounting", "bio": "Accountants serving MEIs for 10 years" },
  "terms": { "rightsConfirmed": true, "sourcesListed": true },
  "requirements": [ { "type": "client", "label": "Claude or ChatGPT", "key": "any" } ],
  "packageContents": [
    "A 3-step method with a checklist",
    "Knowledge base with the year's DAS and limits, with source and date",
    "Monthly report template",
    "Creator support for complex cases"
  ],

  "searchPhrases": ["close the month for my MEI", "how much DAS do I pay", "I am close to the MEI limit"],
  "differentiators": ["liveData", "memory", "escalation"],
  "escalation": { "enabled": true },

  "steps": [
    { "file": "steps/01-levantar-notas.md", "title": "Collect the month's revenue", "gate": ["Month's revenue listed", "Month's total confirmed with the user"] },
    { "file": "steps/02-classificar.md", "title": "Limit and DAS", "gate": ["Year-to-date total and remaining limit calculated", "Month's DAS checked in the base with the source date"] },
    { "file": "steps/03-gerar-guia.md", "title": "Month report", "gate": ["Month report delivered", "Reminder to check the official portal"] }
  ],

  "knowledge": { "updatedAt": "2026-10-02", "reviewEveryDays": 90, "sources": ["Receita Federal", "Portal do Empreendedor"] },
  "templates": [ { "name": "relatorio-mensal", "path": "templates/relatorio-mensal.md", "title": "Monthly report", "description": "The month's revenue, limit and DAS" } ],
  "onboarding": { "questions": [
    { "id": "activity", "ask": "What is your MEI's activity: commerce, services or both?", "why": "The DAS amount changes depending on the activity", "options": ["Commerce", "Services", "Both"] }
  ] },

  "guarantee": { "available": false, "defaultCriteria": [] },
  "pricing": { "priceUsdc": 9, "royaltyBps": 0 },
  "trial": { "uses": 3, "steps": 2, "searches": 3, "tools": {}, "templates": [], "summary": "You run steps 1 and 2: the month's revenue, remaining limit and DAS checked in the base.", "lockedSummary": "The month report and the ready-made template are in the full version." },
  "versions": [ { "version": "1.0.0", "releasedAt": "2026-10-02", "notes": "First version" } ]
}
```

Notes: there is no `id` (first version), `platform` or `tools`; the `tagline` has 58 characters and the `name`, 19 bytes. The content is tax-related: the description and the step 3 gate carry the disclaimer.

## steps/01-levantar-notas.md

    # Step 1: Collect the month's revenue

    ## Goal

    List all of the MEI's revenue for the month and confirm the total with the user, so that the limit and the DAS are calculated on correct numbers. Speak plainly: the user is usually not an accountant. Always reply in the user's language.

    ## What to ask the user

    1. Which month (and year) is the closing for?
    2. What were the month's sales or services, with the amount of each? Accept a pasted list, a summary or approximate values (mark them as estimates).
    3. Has any of this month's revenue not been received yet? Count by the date of the sale or service, as the user usually records it.

    ## How to run

    1. Check the profile with `get_memory`. If it exists, confirm the activity in one sentence; if it is empty or skipped, carry on and ask only when step 2 needs it.
    2. Ask the questions above all at once, grouped.
    3. Build a table with date, description and amount. Sum it and show the month's total with two decimal places.
    4. Ask whether anything is missing and only then ask for confirmation of the total.
    5. Never make up values: whatever the user did not provide stays out of the total and is listed as pending.

    ## Common mistakes

    - Summing estimated values without saying so. Mark each estimate.
    - Mixing different months in the same list.
    - Asking for passwords, CPF (Brazilian taxpayer number) or government portal data: they are not needed. Ask only for the amounts.

    ## result_summary format

    REVENUE: month/year; N entries; month's total (R$); estimates (yes/no, which); pending items; activity from the profile (commerce, services or both).

## steps/02-classificar.md

    # Step 2: Limit and DAS

    ## Goal

    Calculate how much of the annual revenue limit has been used and how much remains, and check the month's DAS in the base, citing the source and the date. Use the profile to pick the right value according to the activity.

    ## What to ask the user

    1. What was the cumulative revenue from January to the previous month? Accept an approximate value and mark it as an estimate.
    2. Was the MEI opened this year? In which month? (The limit is prorated in the year of opening.)

    ## How to run

    1. Read the profile (`get_memory`): the activity defines the DAS amount (commerce, services or both). If it is empty, ask the activity now.
    2. Add the previous cumulative total to the month's total (summary of step 1) and calculate the remaining limit.
    3. Query `search_knowledge` with "MEI DAS amount by activity" and "MEI revenue limit". Cite the source and the date of the excerpt; if it warns that it may be outdated, say so.
    4. If the cumulative total goes over the limit, explain that the situation changes and **advise talking to an accountant**; do not decide for the user.
    5. Show: cumulative total, remaining, the DAS amount, the due date and the source with its date.

    ## Common mistakes

    - Using the amount for another activity.
    - Quoting an amount without a source and date.
    - Giving an opinion on being disqualified from the MEI regime instead of advising to see an accountant.

    ## result_summary format

    LIMIT: cumulative; remaining; status (within, close, above). DAS: activity; amount; due date; source and date cited.

## steps/03-gerar-guia.md

    # Step 3: Month report

    ## Goal

    Deliver the month report in the ready-made template, with revenue, limit and DAS, and the reminder to check everything on the official portal. It is the deliverable the user keeps.

    ## What to ask the user

    1. Do you want to include notes in the report (for example, a pending receipt)?

    ## How to run

    1. Call `get_template` with the name `relatorio-mensal`.
    2. Fill it in with the results of steps 1 and 2. Do not add new numbers.
    3. Show the report and confirm with the user.
    4. Always include the disclaimer: "Check the amounts and the DAS payment on the Portal do Empreendedor; this does not replace an accountant".
    5. If the user asks to save a reminder (for example, "my MEI is a services one"), ask whether they want you to save it as a note and use `save_memory`.

    ## Common mistakes

    - Delivering without the disclaimer.
    - Changing numbers compared with the previous steps.
    - Promising that "there will be no fine".

    ## result_summary format

    DELIVERY: monthly report generated; disclaimer included (yes); notes; note saved (yes/no).

## knowledge/das-mei-2026.md

    ---
    title: DAS-MEI amounts in 2026
    source: Receita Federal (Brazilian Federal Revenue Service)
    source_url: https://www.gov.br/receitafederal/
    source_date: 2026-01-15
    valid_until: 2026-12-31
    tags: [das, amounts]
    ---

    # DAS-MEI amounts in 2026

    ## DAS-MEI by activity in 2026

    The DAS-MEI is the MEI's monthly payment slip: 5% of the minimum wage plus R$ 1.00 of ICMS (commerce and industry) and/or R$ 5.00 of ISS (services). With the 2026 minimum wage at R$ 1,621.00, the example amounts are: commerce R$ 82.05; services R$ 86.05; commerce and services R$ 87.05. Demonstration values: in a real Solver, confirm on the Portal do Empreendedor.

    ## DAS-MEI due date

    The DAS-MEI is due on the 20th of the month after the reference month. If the 20th is not a business day, payment follows the Receita's calendar. Confirm on the Portal do Empreendedor.

## knowledge/limites-faturamento.md

    ---
    title: MEI revenue limit
    source: Portal do Empreendedor, MEI rules
    source_date: 2026-01-15
    valid_until: 2026-12-31
    tags: [limit, revenue]
    ---

    # MEI revenue limit

    ## MEI annual revenue limit

    The MEI's gross revenue limit is R$ 81,000.00 per year, or R$ 6,750.00 per month of activity, prorated, when the MEI was opened during the year. For a situation above the limit, the user should see an accountant: the consequences depend on the amount exceeded and on the case.

## templates/relatorio-mensal.md

    # MEI monthly report: MONTH/YEAR

    ## Month's revenue
    Table with date, description and amount; month's total.

    ## Annual limit
    Cumulative total up to the month; remaining; status.

    ## Month's DAS
    Activity; amount; due date; source and date.

    ## Attention
    Check the amounts and the payment on the Portal do Empreendedor. This report does not replace an accountant.

## evals/cases (10 files)

Each line below is a file: the name, the `=>` sign and the file's JSON content (in a real file, it can be written over several lines).

```

01-fechar-mes.json => {"id":"01-fechar-mes","input":"I sold 3 things this month: 500, 800 and 1200. Close the month for me.","checks":[{"type":"regex","value":"2[.,]?500","description":"Correct month total (2,500)"},{"type":"regex","value":"confirm","description":"Asks for confirmation of the total"},{"type":"not_contains","value":"give me your password","description":"Does not ask for a password"}]}

02-limite-restante.json => {"id":"02-limite-restante","input":"I had invoiced 60 thousand up to last month and this month I made 5 thousand. How much of the limit is left?","checks":[{"type":"regex","value":"16[.,]?000|16 thousand|16k","description":"Correct remaining limit (16 thousand)"},{"type":"contains","value":"81","description":"Mentions the 81 thousand annual limit"},{"type":"regex","value":"source|Portal do Empreendedor|Receita","description":"Cites the source"}]}

03-das-servico.json => {"id":"03-das-servico","input":"My MEI is a services one. How much is the DAS?","checks":[{"type":"regex","value":"86[.,]05","description":"Services DAS amount from the base"},{"type":"regex","value":"source|Receita|Portal","description":"Cites the source"},{"type":"regex","value":"confirm|check","description":"Tells the user to check the official source"}]}

04-das-comercio.json => {"id":"04-das-comercio","input":"My MEI is commerce, how much DAS do I pay?","checks":[{"type":"regex","value":"82[.,]05","description":"Commerce DAS amount from the base"},{"type":"regex","value":"20th|due","description":"States the due date"}]}

05-sem-dados.json => {"id":"05-sem-dados","input":"Close my month.","checks":[{"type":"regex","value":"which|what|tell me|let me know|please provide|can you share","description":"Asks for what is missing instead of making it up"},{"type":"not_contains","value":"your total is","description":"Does not make up a total"}]}

06-imposto-de-renda.json => {"id":"06-imposto-de-renda","input":"Can you file my income tax return?","checks":[{"type":"regex","value":"out of (my )?scope|outside (of )?(my )?scope|I (don't|do not|can't|cannot) (do|cover|file)|accountant","description":"States it is out of scope"},{"type":"not_contains","value":"sure, I will do it","description":"Does not accept what is out of scope"}]}

07-sem-multa.json => {"id":"07-sem-multa","input":"Guarantee that I won't get a fine.","checks":[{"type":"regex","value":"(can't|cannot|can not|unable to) guarantee|no guarantee","description":"Refuses to guarantee"},{"type":"regex","value":"check|portal","description":"Tells the user to check the portal"}]}

08-inicio.json => {"id":"08-inicio","input":"Hi, I want to close the month for my MEI.","checks":[{"type":"regex","value":"activity|commerce|service","description":"Uses or asks for the profile (activity)"},{"type":"regex","value":"month","description":"Confirms the closing month"}]}

09-fonte-vencida.json => {"id":"09-fonte-vencida","input":"What is the DAS amount? The base excerpt came back with an outdated warning.","checks":[{"type":"regex","value":"outdated|expired|confirm","description":"Passes on the outdated warning"},{"type":"regex","value":"Portal|official","description":"Tells the user to check the official source"}]}

10-relatorio-final.json => {"id":"10-relatorio-final","input":"Generate the month report.","checks":[{"type":"regex","value":"Revenue|Limit|DAS","description":"Uses the template sections"},{"type":"regex","value":"does not replace|not a substitute|accountant","description":"Includes the disclaimer"},{"type":"regex","value":"Portal do Empreendedor|official portal","description":"Tells the user to check the portal"}]}
```

## README.md (note to the reviewer)

Summary: the promise, the differentiators and how to check them (a base with `source_date`, the calibration used in step 2, Telegram linked), sources (Receita Federal, Portal do Empreendedor), no pending warnings, a plan for the Opening phase (a limit calculator as a future tool) and two sample requests for a quick test.

## Usage flow (how the buyer experiences it)

The buyer connects the Solver, the AI checks the profile and asks the activity if it is the first use, step 1 asks for the revenue, step 2 checks the limit and the DAS in the base (with the source date), step 3 delivers the report in the template with the disclaimer. If the buyer asks, the AI saves a note.
