# Step N: REPLACE with the step title (verb + object)

## Goal

REPLACE: what this step produces, in 2 or 3 sentences, written for the AI. Say what the AI should know or deliver at the end and why the step exists. If the buyer is not an expert, remind the AI to speak plainly and explain technical terms in half a sentence.

## What to ask the user

REPLACE: the questions the AI needs to ask, grouped and numbered (at most 5 or 6 per message). For each one, say what to do if the user does not know (offer ranges or examples).

If this step uses the user's profile: "Read the profile with `get_memory`. If it exists, use it and confirm in one sentence; if it is empty or skipped, ask only what is needed and proceed with the default".

1. Question 1 (and what to do if they do not know).
2. Question 2.
3. Question 3.

## How to run

1. REPLACE: first concrete action (a verb in the imperative, a verifiable result).
2. REPLACE: second action. Include a short input and output example ("if the user says X, answer Y").
3. To settle a doubt about a rule or value, query `search_knowledge` with the user's question and **cite the source and the date** that come with the excerpt. If the excerpt warns that it may be outdated, tell the user.
4. To deliver the result in the standard format, call `get_template` with the template name and fill it in.
5. Before moving on, confirm with the user and go through this step's checklist (gate).

Step checklist (the same as the gate in the manifest, 3 to 6 verifiable items):
- Verifiable item 1
- Verifiable item 2
- Verifiable item 3

## Common mistakes

- REPLACE: the most frequent mistake when running this step and how to avoid it.
- REPLACE: what the AI tends to make up or skip here.
- REPLACE: a limit of the Solver (what it does not do) and how to respond when asked.
- Never ask for passwords, ID numbers or card numbers; ask for ranges or made-up examples.

## result_summary format

When calling `next_step`, pass a short summary (up to 1,500 characters) in this format:

```
STEP N: <title>
- Decision/result 1: ...
- Decision/result 2: ...
- Sources cited: name (date)
- Open items: ...
```
