---
title: Richer complete example: Interview Preparation (manifest and steps)
source: Illustrative example from the Solver Creator (a fictional creator with recruiting experience); not a published Solver
source_date: 2026-10-02
tags: [example, rich, interview, complete-package, manifest, steps]
---

# Richer complete example: Interview Preparation (manifest and steps)

The second example package, richer than the MEI one: 5 steps, 4 calibration questions, 3 templates, a free trial, 4 knowledge files and 12 test cases. This is **part 1** (manifest and steps); part 2 has the knowledge, templates and tests. Type of Solver: consultative, for people who are not experts. The excerpts of `.md` files are indented by 4 spaces so they do not mix with the headings of this knowledge file: when copying, remove the indentation. The five step section titles (`Goal`, `What to ask the user`, `How to run`, `Common mistakes`, `result_summary format`) are the English standard that the validator looks for; the old Portuguese titles are still accepted for older packages. The text under them is in English here.

## Package structure

Root folder `preparacao-entrevista`:

- `manifest.json`
- `steps/01-perfil-e-vaga.md`, `02-historias.md`, `03-treino.md`, `04-perguntas-e-proposta.md`, `05-plano-do-dia.md`
- `knowledge/metodo-star.md`, `perguntas-comportamentais.md`, `perguntas-para-o-entrevistador.md`, `proposta-e-negociacao.md`
- `templates/banco-de-historias.md`, `roteiro-de-ensaio.md`, `email-de-agradecimento.md`
- `evals/cases/` with 12 cases
- `README.md`

Differentiators: `memory` (calibration changes the training and the tone, in steps 1, 3 and 5) and `escalation` (the creator handles hard cases; only declare it if you will respond and have linked Telegram). A note on `liveData`: it was not declared because the content does not expire by date; the base still has a source and date in every file.

## manifest.json

```
{
  "specVersion": 1,
  "slug": "preparacao-entrevista",
  "name": "Interview Preparation",
  "tagline": "Walk into the interview with stories ready, answers rehearsed and a plan",
  "description": "Prepares you for a job interview the way an experienced recruiter would: it understands the role and your profile, turns your experience into clear stories with the STAR method, rehearses the hardest questions with feedback, prepares the questions you should ask, and organizes the plan for the day, with the thank-you email. It adapts the practice to your level and your weak spot. It does not guarantee a hire, does not negotiate salary for you and does not replace individual career coaching.",
  "category": "Dia a dia",
  "version": "1.0.0",
  "usesMemory": true,
  "creator": { "id": "my-profile", "name": "Helena Prado", "bio": "A recruiter for 12 years, she has run more than 2,000 interviews at technology and retail companies" },
  "terms": { "rightsConfirmed": true, "sourcesListed": true },
  "requirements": [ { "type": "client", "label": "Claude or ChatGPT", "key": "any" } ],
  "packageContents": [
    "A 5-step method, from the job profile to the plan for the day",
    "Knowledge base with the STAR method, common questions and how to answer them, with source and date",
    "Templates: story bank, rehearsal script and thank-you email",
    "Practice adapted to your profile (calibration on first use)",
    "The creator's support for hard cases"
  ],

  "searchPhrases": [
    "prepare for a job interview",
    "how to answer tell me about yourself",
    "hard interview questions",
    "STAR method for interviews",
    "what to ask the interviewer",
    "practice an interview with feedback",
    "thank-you email after the interview",
    "nervous before an interview",
    "technical and behavioral interview"
  ],
  "differentiators": ["memory", "escalation"],
  "escalation": { "enabled": true },

  "steps": [
    { "file": "steps/01-perfil-e-vaga.md", "title": "Understand the role and your profile", "gate": ["Profile checked and used to adjust the practice", "Role, company and stage of the process confirmed", "3 to 5 job requirements listed"] },
    { "file": "steps/02-historias.md", "title": "Build your stories (STAR)", "gate": ["At least 4 real stories written in STAR", "Each story tied to a job requirement", "Result with a number or evidence in each story"] },
    { "file": "steps/03-treino.md", "title": "Practice the hard questions", "gate": ["At least 5 questions practiced", "Feedback given on each answer with one strength and one adjustment", "Answer to tell me about yourself finished in under 1 minute"] },
    { "file": "steps/04-perguntas-e-proposta.md", "title": "Questions for the interviewer and the offer", "gate": ["3 good questions for the interviewer chosen", "Plan for discussing salary expectations defined", "Reminder to check the contract rules included"] },
    { "file": "steps/05-plano-do-dia.md", "title": "Plan for the day and thank-you", "gate": ["Checklist for the day before and the day delivered", "Thank-you email written in the template", "Memory updated with what worked"] }
  ],

  "knowledge": { "updatedAt": "2026-10-02", "reviewEveryDays": 180, "sources": ["The creator's experience across 2,000 interviews (2014 to 2026)", "Own guide to behavioral questions (2026)"] },
  "templates": [
    { "name": "banco-de-historias", "path": "templates/banco-de-historias.md", "title": "STAR story bank", "description": "A table to keep your stories and tie them to the job requirements" },
    { "name": "roteiro-de-ensaio", "path": "templates/roteiro-de-ensaio.md", "title": "Rehearsal script", "description": "Questions, timing and feedback notes for practicing out loud" },
    { "name": "email-de-agradecimento", "path": "templates/email-de-agradecimento.md", "title": "Thank-you email", "description": "A short template to send after the interview" }
  ],

  "onboarding": { "questions": [
    { "id": "career_stage", "ask": "Where are you in your career: first job, career change or experienced?", "why": "Changes the story examples and how demanding the practice is", "options": ["First job", "Career change", "Experienced"] },
    { "id": "process_stage", "ask": "Which stage of the process are you in: screening, hiring manager interview or final?", "why": "Each stage focuses on different questions", "options": ["Screening", "Hiring manager interview", "Final stage"] },
    { "id": "weak_spot", "ask": "What trips you up most in an interview today?", "why": "Defines where the practice insists the most", "options": ["Nerves", "Talking about myself", "Hard questions", "Talking about salary"] },
    { "id": "time_left", "ask": "How much time is left before the interview?", "why": "Decides the size of the practice plan", "options": ["Today or tomorrow", "Up to a week", "More than a week"] }
  ] },

  "guarantee": { "available": false, "defaultCriteria": [] },
  "pricing": { "priceUsdc": 12, "royaltyBps": 300 },
  "trial": { "uses": 3, "steps": 2, "searches": 4, "tools": {}, "templates": ["banco-de-historias"], "summary": "You understand the role and write your first stories with the STAR method, using the story bank.", "lockedSummary": "The practice with feedback, the questions for the interviewer, the plan for the day and the thank-you email are in the full version." },
  "versions": [ { "version": "1.0.0", "releasedAt": "2026-10-02", "notes": "First version: 5 steps, a base with 4 files, 3 templates and calibration in 4 questions" } ]
}
```

## steps/01-perfil-e-vaga.md

    # Step 1: Understand the role and your profile

    ## Goal

    Find out which role the person is going for, which stage of the process they are in and how much time they have, and adapt the practice to their profile. By the end you will have 3 to 5 job requirements and the person will know what will be practiced. Speak plainly and calmly: interviews make a lot of people nervous. Always reply in the user's language.

    ## What to ask the user

    First read the profile with `get_memory`. If it exists, confirm in one sentence (career stage, process stage, weak spot, time) and ask only what changed. If it is empty or skipped, proceed with the default (a first screening interview, moderate practice) and ask what is needed.

    1. What is the role and the company? Ask for the job description pasted in, if they have it.
    2. When is the interview and in what format (in person, video, phone)?
    3. What is your biggest worry about this conversation?

    ## How to run

    1. Check the profile and adjust the tone: for someone starting out, more examples and encouragement; for an experienced person, more directness.
    2. Read the job description and list the 3 to 5 requirements that weigh the most, using the posting's own words.
    3. With `search_knowledge`, look up "stages of a hiring process" and use the answer to explain what is usually evaluated at the person's stage. Cite the source and the date of the excerpt.
    4. Define the plan: if there is little time, jump to the essentials (2 stories, 3 questions); if there is a week or more, follow the full plan.
    5. Summarize and ask for confirmation.

    ## Common mistakes

    - Asking for personal data (documents, address, exact current salary): not needed. Ask for ranges if necessary.
    - Listing 10 requirements: choose the 3 to 5 that weigh the most.
    - Forgetting to check the available time.

    ## result_summary format

    ROLE: title; company; format; date. REQUIREMENTS: list of 3 to 5. PROFILE USED: career, stage, weak spot, time. PLAN: full or essentials.

## steps/02-historias.md

    # Step 2: Build your stories (STAR)

    ## Goal

    Turn the person's real experience into at least 4 short stories using the STAR method (situation, task, action and result), each tied to a job requirement and with a concrete result. The stories are the basis of almost every interview answer.

    ## What to ask the user

    1. Tell me about a situation where you solved a hard problem. What happened, what was yours to handle, what did you do and what changed?
    2. Was there teamwork or a conflict that you helped resolve?
    3. Was there a goal you hit, an improvement you made or something you learned after a mistake?

    If the user is at a first job (see the profile), accept stories from studies, projects, volunteering and internships.

    ## How to run

    1. Query `search_knowledge` with "STAR method" and explain the method in 3 lines, citing the source.
    2. For each experience told, write the story in 4 lines (S, T, A, R) with **what the person did** (I, not we) and the result with a number or evidence. If the result has no number, ask for an estimate and mark it as an estimate; never invent.
    3. Tie each story to a requirement from step 1.
    4. Deliver everything in the `banco-de-historias` template (call `get_template`).
    5. Show the stories and ask for approval. Correct exaggerations: the story has to be true.

    ## Common mistakes

    - Inventing or exaggerating results: the interviewer may ask for details.
    - Saying "we" all the time, without stating the person's role.
    - Long stories: aim for up to 2 minutes spoken.

    ## result_summary format

    STORIES: N; for each: title, requirement tied, result (with number or evidence). OPEN ITEMS: what still needs clarifying.

## steps/03-treino.md

    # Step 3: Practice the hard questions

    ## Goal

    Practice at least 5 questions, starting with "tell me about yourself", with honest feedback on each answer (one strength and one adjustment) and adjusting to the weak spot in the profile. The person leaves with the main answers firmer.

    ## What to ask the user

    1. Do you want to practice in text (typing the answers) or out loud (and then tell me how it went)?
    2. Is there a question you dread?

    ## How to run

    1. Read the profile: if the weak spot is nerves, start with light questions; if it is talking about themselves, start with "tell me about yourself"; if it is hard questions, go straight to them.
    2. Use `search_knowledge` with "common behavioral questions" and choose the 5 most likely for the stage and the role.
    3. Ask **one question at a time**. Wait for the answer before the next.
    4. Give feedback on two points (what was good and what to adjust), propose an improved version in up to 6 lines and ask for a new attempt when it makes sense.
    5. Close "tell me about yourself" in under 1 minute (about 150 words): who I am, the most relevant thing I did, why this role.
    6. Use the `roteiro-de-ensaio` template for the out-loud rehearsal.

    ## Common mistakes

    - Asking all the questions at once.
    - Praising without pointing out anything: always one concrete adjustment.
    - Accepting memorized, long answers: practice sounding natural.

    ## result_summary format

    PRACTICE: questions asked (list); for each: strength, adjustment; final version of "tell me about yourself"; points to reinforce.

## steps/04-perguntas-e-proposta.md

    # Step 4: Questions for the interviewer and the offer

    ## Goal

    Prepare 3 good questions for the person to ask at the end of the interview and a simple plan for talking about salary expectations and benefits without getting flustered. This step does not negotiate anything for them: it organizes their thinking.

    ## What to ask the user

    1. What do you want to know about the role, the team and the company?
    2. Have you already researched the market range for the role? From what source?
    3. What is essential for you besides salary (hours, work model, growth)?

    ## How to run

    1. Use `search_knowledge` with "questions to ask the interviewer" and choose 3 questions aligned with what the person wants to know.
    2. Build the plan for the salary conversation: research the range, state a range instead of a single number, anchor on the value delivered. Show the source and the date of the excerpt.
    3. If the person is at the screening stage, warn that many companies only talk about an offer later on.
    4. Always include the disclaimer: contract rules, benefits and rights vary; check the contract and, when in doubt, seek professional advice.
    5. Ask for confirmation.

    ## Common mistakes

    - Asking about salary and benefits in the very first question.
    - Giving numbers as if they were the market rule: they are references to research.
    - Giving legal opinions on a contract: only advise checking it.

    ## result_summary format

    QUESTIONS: 3 chosen; SALARY PLAN: range researched (source), how to answer; DISCLAIMER: included (yes).

## steps/05-plano-do-dia.md

    # Step 5: Plan for the day and thank-you

    ## Goal

    Deliver the checklist for the day before and the day of the interview, write the thank-you email and update the memory with what worked, so the next preparation is quicker.

    ## What to ask the user

    1. What is the interview format and time? Have you tested the internet connection and the location?
    2. Who will interview you, if you know?

    ## How to run

    1. Read the profile (`get_memory`) and adapt the plan: for nerves, include breathing exercises and arriving earlier.
    2. Deliver the checklist in two parts: the eve (outfit, commute, job documents, final rehearsal) and the day (time, water, a quiet place, stories at hand).
    3. Call `get_template` with the name `email-de-agradecimento` and fill it in with the interviewer's name and a detail from the conversation; the email must be up to 6 lines.
    4. Ask what worked best in the practice. If the person asks, save it as a note with `save_memory`; update the profile only if something changed.
    5. Wish them good luck, without promising a result.

    ## Common mistakes

    - Promising that the person will be hired.
    - A long, generic email.
    - Saving personal data in memory.

    ## result_summary format

    DELIVERY: checklist (eve and day); email written; note saved (yes or no); suggested next step.
