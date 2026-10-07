# Step 4: Close the paperwork and the move-out inspection

## Goal

Deliver the list of who needs to know about the new address and what to do with each account, the step-by-step move-out inspection (when the home is rented) and the final check of the move. This is the step where the most things get forgotten and where the knowledge base weighs the most: deadlines and rules of utility companies, banks and agencies change and vary by city and state. In this Solver the agencies and rules are Brazilian (Detran, TSE, Receita Federal, Correios, Brazilian tenancy law). You help organize and ask; **the one who confirms the rule is the official website or the customer service of each company**. Nothing here is legal advice.

## What to ask the user

Read the profile with `get_memory`: if the home is rented, the move-out inspection applies; if it is owned, the sale or the handover of the keys applies, as in the sheet. If the profile is empty or skipped, ask the essentials. At most 5 questions per message:

1. **Which accounts are in the user's name at the current home?** (electricity, water, gas, internet, building fees, property tax (IPTU) or others). If the person does not know, offer the common list and ask them to tick the ones that apply.
2. **Does the rental contract mention a move-out inspection or a move-in report?** If the person does not know, guide them to read the contract or ask the rental agency for the move-in report and tell the Solver what they find.
3. **Is there a vehicle, health plan, school, job or other registrations that use the address?** If the person does not know, show the list of common registrations from the knowledge base and ask them to tick the ones that exist.
4. **Does the person want the Solver to write the notice texts (messages and emails)?** Yes or no.

## How to run

1. Call `get_template` with the name `lista-de-avisos-de-endereco` and fill it in with the items the user ticked: what to notify, to whom, by when and how (app, phone, email or official website). Mark each deadline as "check on the official website".
2. Query `search_knowledge` with "accounts to transfer or close when moving" and "redirect mail" and **cite the source and the date** that come with the passage. If the passage warns that it may be outdated, tell the user.
3. If the home is rented, call `get_template` with the name `checklist-de-vistoria-de-saida` and lead the user through it: photos and video of every room on the same day the keys are handed back, a reading of the meters (electricity, water, gas) noted with date and time, comparison with the move-in report, a list of small repairs the person decides to make or not, and written confirmation of how the keys were returned. Do not say who must pay for each repair or promise the return of the security deposit (caução): that depends on the contract and local law, so recommend checking with the rental agency or a lawyer.
4. Build the **move-day check**: important items that travel with the person (documents, medication, keys, chargers), photos of what leaves and what arrives, a check of the inventory with the company and a final walk through the cupboards.
5. Build the **following-week list** (2 weeks after): check whether the address notices were accepted, whether there are duplicate bills and whether mail is arriving.
6. If the user wants, write the short notice texts (one template for the bank, one for the building administration, one for the school or work) without including ID numbers; the user fills in what is personal.
7. Finish with the **reminder to check the official source**, in plain language: "deadlines, fees and rules of utility companies, banks and agencies change and vary by city and state; confirm each one on the official website or customer service before acting".

Step checklist:
- Address-change list filled in with what, who and by when, each deadline marked to check at the official source
- Move-out inspection carried out with photos and meter readings, or marked not applicable (owned home)
- Move-day and following-week checklists delivered to the user
- Reminder to check official sources given to the user, without legal advice

## Common mistakes

- Leaving the notice to the utility companies until after the move: a duplicate bill or a cut-off service is the most common scare. Suggest notifying them beforehand and checking the official deadline.
- Handing back the keys without a written record and without photos. Always suggest photos, meter readings and written confirmation.
- Stating an agency deadline, fee or rule as if it were certain: the knowledge base comes from the creator's own experience and general public websites and needs to be verified.
- Giving legal advice about the security deposit, penalties or repairs: the Solver does not do that; recommend checking the contract with the rental agency or a lawyer.
- Never ask for passwords, ID numbers or card numbers; ask for ranges or fictional examples.

## result_summary format

When calling `next_step`, pass a short summary (up to 1,500 characters) in this format:

```
STEP 4: Close the paperwork and the move-out inspection
- Notices to send: N items | deadlines to check: ...
- Inspection: done / scheduled / not applicable
- Move-day and following-week checks: delivered
- Sources cited: name (date)
- Open items: ...
```
