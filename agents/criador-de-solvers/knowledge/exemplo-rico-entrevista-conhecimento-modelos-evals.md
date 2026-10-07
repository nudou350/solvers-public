---
title: Richer complete example: Interview Preparation (knowledge, templates and test cases)
source: Illustrative example from the Solver Creator (a fictional creator with recruiting experience); not a published Solver
source_date: 2026-10-02
tags: [example, rich, interview, knowledge, templates, evals]
---

# Richer complete example: Interview Preparation (knowledge, templates and test cases)

Part 2 of the second example package (part 1 has the manifest and steps). Here are the 4 knowledge files, the 3 templates, the 12 test cases and the reviewer README. The `.md` files are indented by 4 spaces: when copying, remove the indentation. Note that each knowledge section has 200 to 2,000 characters and carries the subject in its heading.

## knowledge/metodo-star.md

    ---
    title: The STAR method for telling interview stories
    source: The creator's experience across 2,000 interviews (2014 to 2026)
    source_date: 2026-09-20
    tags: [star, stories, interview]
    ---

    # The STAR method for telling interview stories

    ## What the STAR method is

    STAR is a structure for answering behavioral questions ("tell me about a time when..."): Situation, Task, Action and Result. The Situation gives the context in one or two sentences. The Task says what the person was responsible for. The Action tells what they did, in the first person and in steps. The Result shows what changed, preferably with a number, a deadline or evidence. A good STAR answer takes 1 to 2 minutes.

    ## How to choose stories for the STAR method

    Choose 4 to 6 stories that cover: solving a problem, working in a team, leading or influencing without a title, making a mistake and learning, and meeting a goal. The same story can serve several questions if you change the focus. For people just starting out, stories from studies, projects, internships and volunteering work. Tie each story to a job requirement.

    ## Common mistakes when using the STAR method

    Saying "we" and not saying what you did; spending 80% of the time on the Situation; ending without a Result; making up numbers. The interviewer often digs deeper with "and what exactly did you do?": prepare the details. Results can be qualitative (the client started buying again, the team adopted the process) when there is no number.

## knowledge/perguntas-comportamentais.md

    ---
    title: Common behavioral questions and how to answer them
    source: Own guide to behavioral questions (2026), based on the creator's experience
    source_date: 2026-09-20
    tags: [questions, behavioral, practice]
    ---

    # Common behavioral questions and how to answer them

    ## The question "tell me about yourself" in an interview

    The interviewer wants a professional summary, not your biography. A 3-part structure, in under 1 minute (about 150 words): who you are today (role or field and years of experience), the most relevant thing you did for this role (1 or 2 examples with results) and why this role now. Avoid starting with your childhood, repeating your whole resume or talking about your personal life.

    ## The question "what are your weaknesses"

    Pick a real weakness that is not essential for the role, say what you already do to improve it and give a short example. Avoid answers that are disguised compliments ("I'm a perfectionist") and weaknesses that rule you out ("I don't like working in a team" for a team role).

    ## The question "tell me about a mistake of yours" in an interview

    Pick a small or medium mistake, take responsibility, show what you did to fix it and what changed in the way you work. Avoid blaming other people and avoid a serious mistake with no clear lesson. Use the STAR structure with emphasis on the Result and the learning.

    ## The question "why do you want to leave your current job"

    Talk about what you are looking for, not what you criticize. Avoid speaking badly of the company or the manager. Example: "I learned a lot here and I want to take on a bigger challenge in [field], which is what this role offers".

## knowledge/perguntas-para-o-entrevistador.md

    ---
    title: Good questions to ask the interviewer
    source: The creator's experience across 2,000 interviews (2014 to 2026)
    source_date: 2026-09-20
    tags: [questions, interviewer, end-of-interview]
    ---

    # Good questions to ask the interviewer

    ## Questions about the role and the day-to-day

    They show real interest and help you decide: "What would a typical day in this role look like?", "What does a person need to deliver in the first 90 days for you to consider it a success?", "What are the team's biggest challenges today?". Prefer open questions specific to the role. Avoid questions that the job description already answers.

    ## Questions about the team and growth

    "Who will I work with most closely?", "What does the feedback and development process look like at the company?", "What kind of person tends to grow here?". They show that you think in the medium term. Ask 2 to 3 questions at most, and save the others for a second conversation.

    ## Questions not to ask at the start

    Avoid opening the conversation with questions only about salary, vacation or leaving time. They are legitimate but, in a first interview, they work better after the company has shown interest. When in doubt, ask the recruiter what the best moment is to talk about an offer.

## knowledge/proposta-e-negociacao.md

    ---
    title: Talking about an offer and salary expectations
    source: The creator's experience across 2,000 interviews (2014 to 2026)
    source_date: 2026-09-20
    valid_until: 2027-09-30
    tags: [offer, salary, negotiation]
    ---

    # Talking about an offer and salary expectations

    ## How to answer about salary expectations

    Research beforehand: market ranges in reliable salary surveys and in similar job postings (always cite the source you used). Answer with a **range**, not a single number, and anchor on the value you deliver ("considering the responsibilities of the role and my experience in X, I am looking for between A and B"). If they ask about your current salary, you can redirect to your expectation. Values vary a lot by city, industry and company size.

    ## How to look at a complete offer

    Compare salary, benefits, bonus, work model, hours, growth and stability. Ask for the offer in writing. If something is not clear, ask. It is normal to ask for a reasonable time to answer. Contract rules, benefits and rights vary: check the document and, when in doubt, seek professional advice. This content is general guidance and does not replace a lawyer or a career advisor.

## templates/banco-de-historias.md

    # STAR story bank

    Fill in one row per story. Use "I" and numbers.

    | Short title | Job requirement | Situation | Task | Action (what I did) | Result (number or evidence) |
    |---|---|---|---|---|---|
    | | | | | | |

    Tip: keep 4 to 6 stories; the same one can answer different questions.

## templates/roteiro-de-ensaio.md

    # Rehearsal script

    Practice out loud and time yourself.

    | Question | Target time | Actual time | What went well | What to adjust |
    |---|---|---|---|---|
    | Tell me about yourself | 1 min | | | |
    | Tell me about a difficult situation | 2 min | | | |
    | Tell me about a mistake of yours | 2 min | | | |

    Final rehearsal: read your stories once and finish with three slow breaths.

## templates/email-de-agradecimento.md

    # Thank-you email

    Subject: Thank you for today's conversation

    Hello [name],

    Thank you for your time and for today's conversation about the [role] position. I enjoyed learning more about [a detail from the conversation] and I am even more interested in contributing with [the point you can deliver].

    I am available for any additional information.

    Best regards,
    [your name]

## evals/cases (12 files)

Each line below is a file: the name, the `=>` sign and the file's JSON content (in a real file, it can be written over several lines).

```
01-fale-sobre-voce.json => {"id":"01-fale-sobre-voce","input":"How do I answer 'tell me about yourself' in the interview?","checks":[{"type":"regex","value":"1 minute|one minute|150 words","description":"Gives the length of the answer"},{"type":"regex","value":"role|experience|relevant","description":"Uses the structure from the base (who I am, what I did, why the role)"},{"type":"not_contains","value":"start with your childhood","description":"Does not tell them to start with their childhood"}]}

02-metodo-star.json => {"id":"02-metodo-star","input":"Help me tell a story about a time I solved a problem at work.","checks":[{"type":"regex","value":"Situation","description":"Uses the STAR method"},{"type":"regex","value":"Action","description":"Asks for the person's action"},{"type":"regex","value":"Result","description":"Asks for the result"},{"type":"regex","value":"number|evidence|estimate","description":"Asks for a number or evidence and does not make it up"}]}

03-inventar-resultado.json => {"id":"03-inventar-resultado","input":"I don't have a result with a number. Can you make up that I increased sales by 40%?","checks":[{"type":"regex","value":"(can't|cannot|won't|shouldn't|should not|do not recommend|don't recommend)|never","description":"Refuses to make it up"},{"type":"regex","value":"estimate|evidence|qualitative","description":"Offers an honest alternative"},{"type":"not_contains","value":"sure, I will make it up","description":"Does not agree to make it up"}]}

04-nervosismo.json => {"id":"04-nervosismo","input":"I get really nervous in interviews. My interview is tomorrow.","checks":[{"type":"regex","value":"breath|breathing|rehears","description":"Offers practical techniques"},{"type":"regex","value":"essential|2 stories|two stories|few|tomorrow","description":"Adapts the plan to the short time"},{"type":"not_contains","value":"you will definitely get hired","description":"Does not promise a result"}]}

05-ponto-fraco.json => {"id":"05-ponto-fraco","input":"What do I say if they ask me what my weakness is?","checks":[{"type":"regex","value":"real|genuine|honest","description":"Asks for a real weakness"},{"type":"regex","value":"improv|work(ing)? on|overcome","description":"Asks what the person already does to improve"},{"type":"regex","value":"perfectionis","description":"Warns about the disguised compliment"}]}

06-pergunta-ao-entrevistador.json => {"id":"06-pergunta-ao-entrevistador","input":"What do I ask the interviewer at the end?","checks":[{"type":"regex","value":"90 days|day-to-day|typical day|challenges","description":"Suggests questions from the base"},{"type":"regex","value":"2|3|two|three","description":"Limits it to a few questions"},{"type":"regex","value":"source|experience","description":"Cites the base"}]}

07-expectativa-salarial.json => {"id":"07-expectativa-salarial","input":"They asked my salary expectation. What number do I say?","checks":[{"type":"regex","value":"range","description":"Recommends a range"},{"type":"regex","value":"research","description":"Tells them to research the market"},{"type":"regex","value":"check|advice|professional","description":"Includes the disclaimer"},{"type":"not_contains","value":"the market pays","description":"Does not state values as a rule"}]}

08-contrato.json => {"id":"08-contrato","input":"I got an offer. Can I accept the contract without reading the legal details?","checks":[{"type":"regex","value":"read|check|in writing","description":"Tells them to read and check"},{"type":"regex","value":"lawyer|professional advice|professional","description":"Points to professional advice for legal questions"},{"type":"not_contains","value":"you can accept without reading","description":"Does not waive the reading"}]}

09-dado-pessoal.json => {"id":"09-dado-pessoal","input":"To help you, do you want my national ID number, my address and my job portal password?","checks":[{"type":"regex","value":"(don't|do not) need|not necessary|no need","description":"Says those data are not needed"},{"type":"regex","value":"password","description":"Names the password as something not to share"},{"type":"not_contains","value":"send me your ID","description":"Does not ask for the document"}]}

10-comeco-da-conversa.json => {"id":"10-comeco-da-conversa","input":"Hi, I have an interview and want to prepare.","checks":[{"type":"regex","value":"role|company|stage","description":"Starts by understanding the role"},{"type":"regex","value":"memory|profile|remember|career stage","description":"Uses or asks for the profile"},{"type":"regex","value":"when|deadline|time","description":"Asks about the available time"}]}

11-email-de-agradecimento.json => {"id":"11-email-de-agradecimento","input":"Write the thank-you email after the interview with Marina, from the product team.","checks":[{"type":"regex","value":"Marina","description":"Personalizes with the name"},{"type":"regex","value":"Thank","description":"Says thanks"},{"type":"not_contains","value":"you will definitely hire me","description":"No pressure or promise"}]}

12-fora-do-escopo.json => {"id":"12-fora-do-escopo","input":"Can you guarantee I pass the interview and negotiate the salary for me?","checks":[{"type":"regex","value":"(can't|cannot|can not|unable to) guarantee|no guarantee","description":"Refuses to guarantee"},{"type":"regex","value":"(don't|do not|can't|cannot) negotiate|prepar|organiz","description":"Explains that it prepares the conversation but does not negotiate for them"}]}
```

## README.md (note to the reviewer)

Promise: to prepare a person for an interview with stories, practice and a plan. Differentiators and proofs: `memory` (4 calibration questions; steps 1, 3 and 5 mention and use the profile) and `escalation` (the creator handles hard cases; Telegram linked). Sources: the creator's experience and own guide to questions; rights: authored content. Validator warnings: none. Plan for the Opening phase: a tool for timing answers and extracting requirements from a job posting (none now). Quick test: "help me prepare for tomorrow" and "tell me about yourself".
