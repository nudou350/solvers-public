---
title: Knowledge: front-matter, chunks, validity and search
source: Solver package specification v1 (PACKAGE_SPEC), section 6, and the platform validator rules
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [knowledge, front-matter, chunks, validity]
---

# Knowledge: front-matter, chunks, validity and search

This knowledge file explains how the Solver's knowledge files are read by the server: the header with source and date, the split into excerpts by headings, validity, size limits, and what proves the living-knowledge differentiator.

## How knowledge works

The files in `knowledge/` are split into excerpts (chunks) and indexed by meaning. While working, the buyer's AI queries the base through the `search_knowledge` tool, which returns **up to 5 excerpts** with the text, the source (title and `source`), the date and, when the excerpt has expired, the warning "may be outdated (valid until <date>)". The AI is instructed to cite the source. The file itself never leaves: only excerpts.

## Front-matter (the header of the .md file)

A block between two `---` lines, at the top, with `key: value` lines:

```
---
title: DAS-MEI amounts in 2026
source: Receita Federal (Brazilian Federal Revenue Service)
source_url: https://www.gov.br/receitafederal/
source_date: 2026-01-15
valid_until: 2026-12-31
tags: [das, amounts]
---
```

(MEI is the Brazilian micro-entrepreneur regime and DAS its monthly tax payment slip; this is only an example.)

- `title`: optional. If missing, the first heading of the file is used.
- `source`: **required** in specVersion 1 (`KNOWLEDGE_SOURCE_MISSING`). Who the source is, in words.
- `source_url`: optional, the https address of the source.
- `source_date`: the date of the source, format `YYYY-MM-DD` (`KNOWLEDGE_DATE_INVALID` if wrong or impossible, such as 2026-02-30). Required for anyone declaring the `liveData` differentiator.
- `valid_until`: optional, `YYYY-MM-DD`. After this date the excerpt gets the outdated warning and the validator gives `KNOWLEDGE_EXPIRED`.
- `tags`: a list of up to 10 words, in brackets and separated by commas.

A block that is opened and not closed, a line without "key: value", or a repeated key is `KNOWLEDGE_FRONTMATTER_INVALID`.

## .txt files

They have no front-matter. The source goes in a neighboring file with the same name plus `.meta.json`, for example `faq.txt.meta.json`, with the same fields (`source`, `source_date`...). Without it: `KNOWLEDGE_SOURCE_MISSING`. Prefer `.md`.

## How the text is split

- The split is by `#`, `##` and `###` headings: each section becomes an excerpt.
- Sections larger than 2,000 characters are split by paragraph, with a 200-character overlap and the heading repeated.
- Excerpts are read **on their own**, without the rest of the file. That is why each section must stand alone and carry the subject in its heading.
- Quality target: sections of 200 to 2,000 characters.
- Lines that start with `#` inside code blocks also become headings. In examples with markdown inside, indent the block by 4 spaces or avoid the heading marker.

## Size

File up to 10 MB. Package up to 10,000 excerpts (`KNOWLEDGE_TOO_BIG` above that). Estimate: 1 excerpt for every 2,000 characters of clean text, or fewer when sections are short. A typical excellent package has 8 to 30 files, and the validator reports the excerpt estimate in `stats`.

## Validity and "living knowledge"

The `liveData` differentiator is proven when: `knowledge.updatedAt` is within `reviewEveryDays` (for example, updated in the last 90 days), **no** file has an expired `valid_until` and at least **half** of the files have `source_date`. This depends on the creator maintaining the base: put the review on your calendar.

## The knowledge block in the manifest

`knowledge: { "updatedAt": "2026-10-02", "reviewEveryDays": 90, "sources": ["Receita Federal", "Portal do Empreendedor"] }`. The sources listed there appear on the Solver's page.

## Content protection (honesty)

Knowledge leaves only as excerpts, with a discreet watermark and a daily query limit per license. But whoever holds the license can copy the excerpts they read. The value of the product lies in the process, in continuous updating and in support, not in absolute secrecy.
