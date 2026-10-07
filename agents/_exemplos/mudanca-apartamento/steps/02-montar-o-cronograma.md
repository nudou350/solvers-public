# Step 2: Build the schedule by deadline

## Goal

Turn the sheet from step 1 into a schedule with real dates, split into deadline windows (from 8 weeks before to 2 weeks after the move), with few tasks per window and an owner for each. This is the step that gives the feeling of control: the person knows what to do this week and what can wait. Keep it simple and use calendar dates, not just "T-3".

## What to ask the user

Read the profile with `get_memory`: the home situation (rented or owned), the volume and who helps change which tasks apply. If the profile is empty or skipped, use the sheet from step 1. Ask only what is missing, at most 5 per message:

1. **Are there fixed commitments in the way?** (a trip, work on weekdays, vacation). If the person does not know, assume that only the weekend is free.
2. **Are there children, pets or plants?** If so, extra tasks apply (school, vaccines, pet transport). If the person does not know, skip it and offer to add it later.
3. **Does the building require booking the service elevator or limit the hours?** If the person does not know, the task becomes "ask the front desk in both buildings".
4. **Do you want to include a final cleaning and getting rid of old furniture?** Answer yes or no; if the person does not know, include it as optional.

## How to run

1. Calculate the dates of each window from the moving date: 8 weeks before, 4 weeks before, 2 weeks before, 1 week before, the day before, the day itself, 2 weeks after. If fewer weeks remain than that, merge the windows and say so.
2. Call `get_template` with the name `cronograma-de-mudanca` and fill it in with the tasks from the sheet. Each task has: what, by when, who does it and "done" (a checkbox).
3. Query `search_knowledge` with "what to do each week of the move" and **cite the source and the date** that come with the passage. If the passage warns that it may be outdated, tell the user. Use the knowledge base to fill in forgotten tasks (booking the elevator, telling the front desk, setting aside important documents to carry with you, emptying the fridge ahead of time).
4. Adjust to the profile (if the profile is skipped, use the default from step 1): if `situacao_imovel` is "Rented", include the notice period and the move-out inspection; if `quem_ajuda` is "Friends and family", include the task "agree on the day with friends 3 weeks ahead"; if it is "I hire a company with packing", replace the packing tasks with "check the inventory and packing with the company".
5. Mark 3 tasks as **critical** (the ones that, if late, delay the whole move): usually hiring the moving company, notifying the landlord or the rental agency and booking the elevator of the new building. Explain the reason in one sentence.
6. Show the schedule, ask the user for a quick check ("is any date impossible?") and adjust.
7. If the user wants to save the moving date in the profile, offer `save_memory` and save only with their consent.

Step checklist:
- Deadline windows with real dates calculated from the move date
- Every task has an owner and a due date
- 3 critical tasks marked with the reason
- Schedule adjusted to the profile (home, volume and help) and checked by the user

## Common mistakes

- Filling the schedule with small tasks: more than 8 per window becomes a list nobody follows. Group them.
- Dates without a calendar ("two weeks before" with no day). Write the weekday and the date.
- Forgetting the cleaning of the old home and the move-out inspection when it is rented: they go in the week of the move.
- Promising a deadline of an agency or utility company: the knowledge base only gives what to check; the deadline is whatever the official website says.
- Never ask for passwords, ID numbers or card numbers; ask for ranges or fictional examples.

## result_summary format

When calling `next_step`, pass a short summary (up to 1,500 characters) in this format:

```
STEP 2: Build the schedule by deadline
- Windows: (date) ... (date) ...
- Critical tasks: 1) ... 2) ... 3) ...
- Profile adjustments: ...
- Sources cited: name (date)
- Open items: ...
```
