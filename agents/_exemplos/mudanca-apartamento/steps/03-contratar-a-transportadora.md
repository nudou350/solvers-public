# Step 3: Hire the moving company

## Goal

Help the person ask for comparable quotes, compare offers side by side and choose safely, or decide to move without a company. The Solver does not recommend companies or guarantee prices: it delivers the right questions, the comparison and the warning signs. If the user is not going to hire a company (doing it with friends or renting only a vehicle), adapt: the step becomes "organize the transport" with the same questions (timing, stairs, insurance for whatever might break).

## What to ask the user

Read the profile with `get_memory` and use the volume and the budget from the sheet. If the profile is empty or skipped, ask what is needed. At most 5 questions per message:

1. **Do the origin and the destination have an elevator, stairs or a narrow street?** If the person does not know, ask them to look at the entrance and the street; note it as "to check".
2. **Are there fragile or large items?** (fridge, a wardrobe that comes apart, a piano, a big TV). If the person does not know, offer the list of furniture and appliances and ask them to tick the ones they have.
3. **Do you want only the transport, or also packing and furniture assembly?** If the person does not know, ask for quotes for both versions.
4. **What time window works?** If the person does not know, use "weekday morning" and "Saturday morning" as options; weekend moves tend to be more in demand, so warn that it may cost more or be fully booked.
5. **Do you already have recommendations from friends?** If so, use them as a starting point and ask every company the same set of questions.

## How to run

1. Build the **quote request** with the data from the sheet and the answers: date and window, addresses (only neighborhood and city in the conversation; the full address goes only to the company, chosen by the user), floors and elevator, list of large items, estimated volume, whether packing and assembly are needed.
2. Advise asking for **at least 3 written quotes** using the same request. If the user has only 1, say it is possible to go ahead, but the comparison is weak.
3. Query `search_knowledge` with "questions for the moving company" and "warning signs in a moving quote" and **cite the source and the date** that come with the passage. If the passage warns that it may be outdated, tell the user.
4. Call `get_template` with the name `comparativo-de-transportadoras` and fill it in with the quotes the user brings: price, what is included, insurance, payment terms, cancellation and delay policy. Do not make up prices: use only the numbers the user provides. If an answer is missing, mark it "ask".
5. Highlight in the comparison **what the lowest price does not include** (packing, disassembly, per-floor fee without an elevator, overtime) and ask that the difference be added up before deciding.
6. Reinforce the safety points: see the contract or quote in writing, understand the insurance and what it covers, agree on who checks the inventory on the day, note the name and phone number of the person in charge. Do not state legal rules about liability; recommend reading the contract.
7. Show a recommendation with the reason ("quote B costs X more, but it includes assembly and insurance") and leave the decision to the user.

Step checklist:
- A single written quote request with date, addresses (neighborhood and city), floors and large items
- At least 2 quotes compared in the same format, or a decision not to hire a registered company
- Comparison shows what each quote includes and excludes, using the amounts provided by the user
- Insurance, cancellation and written confirmation checked before signing

## Common mistakes

- Comparing only the final price. Similar quotes may include different things (packing, assembly, stair fee).
- Paying a large deposit without a written contract: ask for written confirmation before any payment. Do not claim that a given deposit amount is normal; the knowledge base only gives questions to check.
- Making up a market price or a company name: the Solver does not recommend companies and does not cite amounts the user did not bring.
- Forgetting to tell the building administration at both buildings about the day and the service elevator.
- Never ask for passwords, ID numbers or card numbers; ask for ranges or fictional examples.

## result_summary format

When calling `next_step`, pass a short summary (up to 1,500 characters) in this format:

```
STEP 3: Hire the moving company
- Request sent to: N companies (no names if the user prefers)
- Choice: ... | reason: ...
- Open items: what is still to be confirmed in writing
- Sources cited: name (date)
- Risks: ...
```
