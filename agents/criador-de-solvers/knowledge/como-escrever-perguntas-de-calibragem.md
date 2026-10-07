---
title: How to write calibration questions and use memory
source: Solver package specification v1 (PACKAGE_SPEC), sections 10 and 11
source_date: 2026-09-30
valid_until: 2027-03-31
tags: [calibration, onboarding, memory, profile, notes]
---

# How to write calibration questions and use memory

This knowledge file explains the manifest `onboarding` block, the first-use flow, how to write questions that really change the result, what profile, notes and summary are in the buyer's memory, and what never to ask.

## What calibration is

A few questions on the Solver's **first use**, to adapt the answers to the buyer without changing any model. The answers become the **profile**, stored in the buyer's memory and read by the steps. This is what proves the `memory` differentiator, as long as some step uses the profile.

## Format in the manifest

```
"usesMemory": true,
"onboarding": {
  "questions": [
    {
      "id": "activity",
      "ask": "What is your MEI's activity: commerce, services or both?",
      "why": "The DAS amount changes depending on the activity",
      "options": ["Commerce", "Services", "Both"]
    }
  ]
}
```

(MEI is the Brazilian micro-entrepreneur tax regime and DAS its monthly tax payment slip; this is only an example.)

- 1 to 5 questions.
- `id`: lowercase letters, digits and underscore, unique.
- `ask`: 10 to 200 characters.
- `why`: 10 to 200 characters; the model can explain the reason to the buyer.
- `options`: optional, 2 to 6; without `options` the answer is free text. Each option up to 80 characters.
- There is no "required" field: every question can be skipped.
- `onboarding` requires `usesMemory: true`.

## How the flow works (the buyer's view)

1. The buyer activates the Solver. If the Solver uses memory, the AI checks the profile.
2. If there is no profile, the AI asks the questions in **at most two messages**, explains the reason and accepts a skip.
3. The AI saves the answers as the profile. If the buyer skips, "skipped" is recorded and the question **does not come back every session**.
4. The steps read the profile. The buyer can ask to "recalibrate" and the questions are asked again.
5. Without a memory key (a connection without the second signature), the Solver proceeds with the defaults and says how to reconnect.

The profile also applies during the free trial.

## Good questions

A good calibration question **changes what the Solver does**. Test: "if the answer is A or B, does step X act differently?". If not, cut it.

- Closed (with options) when answers repeat: level, regime, size, channel.
- Open only when you need free context ("What is your goal right now?").
- One question at a time, in the buyer's language.
- Practical maximum: 3 or 4.

Good examples: "What is your level: beginner, intermediate or advanced?"; "Do you work alone or with a team?"; "What is your main channel: Instagram, email or website?"; "What is your budget per trip: economy, moderate or comfortable?".

## Questions that must not exist

Passwords, documents (CPF, CNPJ, ID card, passport; CPF and CNPJ are Brazilian individual and company tax numbers), cards, bank accounts, keys, a full address, health diagnoses, anything that identifies other people. The validator warns by keywords (`ONBOARDING_SENSITIVE`), and the reviewer reads them all. Replace them with ranges ("monthly income: up to 3k, 3 to 8k, over 8k") or categories.

## Profile, notes and summary

- **Profile**: calibration answers. Up to 2,000 characters. Saved on first use.
- **Notes**: up to 30 notes of 3 to 500 characters. Only when the buyer asks ("save this so I don't forget").
- **Summary**: free text of up to 4,000 characters, which replaces the previous one entirely.
- Everything is encrypted and tied to the buyer's account. The buyer can see and delete it under "specialist memory".

## How steps use the profile

Write in the step: "Read the profile (`get_memory`). If `activity` is Services, use the services amount. If the profile is empty or skipped, ask only what is needed and proceed with the default". The text must mention the **profile** (it is what the validator looks for) and say how it changes the answer. The profile is user data: it cannot remove gates or change the rules of the method.

## What to do when the buyer skips

Define a safe default per question ("if the level is unknown, treat as beginner"). Record it in the step that uses the answer, so the AI knows what to do when the profile is empty or skipped. Never block use for lack of an answer: calibration improves the service, but it is not a condition for it.

## Common mistakes

More than 5 questions; an answer that is never used; sensitive data; forgetting the default for those who skip; promising that the Solver "learns" (it only remembers answers); changing the `onboarding` in an update without bumping the MAJOR version.
