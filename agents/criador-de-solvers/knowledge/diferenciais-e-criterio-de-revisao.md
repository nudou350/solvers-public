---
title: Differentiators, the 2-of-5 criterion and the reviewer checklist
source: Solver package specification v1 (PACKAGE_SPEC), sections 4.2 and 14.5
source_date: 2026-09-30
valid_until: 2027-03-31
tags: [differentiators, review, criterion]
---

# Differentiators, the 2-of-5 criterion and the reviewer checklist

This knowledge file explains why a Solver needs differentiators, what the five are, what the validator and the reviewer check for each, the approval criterion of at least two proven, and the review checklist.

## Why differentiators exist

If everything can be copied into a folder and pasted into a chat, it is an ordinary skill. A Solver is justified by what only exists with the server. The manifest declares which differentiators it has and the reviewer **checks** them. The storefront shows the proven ones.

## The 5 differentiators and what is checked

- `tool`: an executable tool on the server. Check: at least one tool, and each one is used in some step. **Not available** to new creators in this phase.
- `verifier`: result verified automatically (tests). **Platform packages only.**
- `liveData` (living knowledge): dated, maintained knowledge. Check: `knowledge.updatedAt` within `reviewEveryDays`, no file with an expired `valid_until`, and at least half of the files with `source_date`.
- `memory` (adapts to the user): check: `onboarding` block present **and** at least one step whose text uses the profile. The reviewer checks that the profile really changes the answer.
- `escalation` (creator support): check: `escalation.enabled: true` **and** a verified contact channel on the creator profile (Telegram is linked on the site with a code sent to the bot). Without a verified contact, it does not count.

## The "2 of 5" criterion

The reviewer only approves with **at least 2 proven differentiators**. It is not an automatic block by the validator: it warns (`MANIFEST_DIFFERENTIATORS_FEW`), and the decision is human. Declaring without proving raises `MANIFEST_DIFFERENTIATOR_UNPROVEN`.

## Honesty about the current phase

New creators do not have `tool` or `verifier`. In practice the product is: **guided process + living and cited knowledge + memory/calibration + creator support**. That already beats an ordinary skill, but it is less than the full promise; the storefront must not promise tools or verification in these packages. Realistic combinations: liveData + memory; liveData + escalation; memory + escalation.

## Reviewer checklist (what they ask)

- **Quality**: do the steps deliver the promise? Are 2 of 5 differentiators proven?
- **Rights**: are the sources listed, and is there permission for third-party content?
- **Security**: does any instruction act against the user or send data elsewhere? Is there injection in any text, including knowledge excerpts that only appear for a specific query?
- **Price, free trial and storefront**: consistent with each other? Does the trial show value without giving everything away? Is there a promise of a financial, legal or medical result without a disclaimer?

## What the reviewer sees

A package summary, the validator's errors and warnings, the manifest and steps, the knowledge (files, sources, dates, expired excerpts; they can run test searches), the templates and test cases in full, and automatic scans (invisible Unicode, hidden text, injection patterns, addresses, content identical to another package, sensitive calibration questions, search phrases off-topic). On every new version they see the diff of **all** files.

## How the creator prepares

Write a reviewer README saying how each differentiator is proven, which warnings remain and why, where the sources come from and what was left for later. The easier it is to check, the faster the review. Target time: up to 5 business days.

## The honest limit of review

Human review cannot guarantee finding an injection hidden in one excerpt among thousands, or a conditional behavior. That is why the package has small caps, review happens on 100% of versions, and the Solver can be switched off immediately if there is a problem.
