---
title: Submission, human review, publication and versions
source: Solver package specification v1 (PACKAGE_SPEC), sections 14 and 15, and the platform's state contract
source_date: 2026-09-30
valid_until: 2027-03-31
tags: [submission, review, publication, versions, semver]
---

# Submission, human review, publication and versions

This knowledge file describes the path from the ZIP to the storefront: who can submit, the validation and review stages (target of up to 5 business days), publication, version rules, suspension and what the creator must maintain after publishing.

## Who can submit

In this phase, **invited creators**. The platform sends an invitation code by email; the creator enters the code after signing in to the site, completes the profile (name, bio, acceptance of the terms) and links the support contact (Telegram) if they want the `escalation` differentiator. In the Opening phase, anyone with a complete profile will be able to submit, with limits on submissions.

## The flow, in plain language

1. **Submission**: the creator uploads the ZIP at `/creator/publish`. The site receives the file and replies that it was received.
2. **Validation**: the server extracts the ZIP in an isolated area and runs the validator. If there is an error, the package comes back with the reason (code, path and how to fix it).
3. **Review**: a team member reads everything (manifest, steps, knowledge, templates, test cases, automatic scans). Target: up to 5 business days. They can **approve**, **request changes** (you fix and resubmit, on the same version as long as it has not been published) or **reject**, always with the reason.
4. **Creator confirmation**: once approved, the creator confirms the publication on the site (the final signature is theirs; the platform pays the fee).
5. **Final platform approval** (new Solver): the team completes the registration. Updates to an already approved Solver do not repeat this step.
6. **Publication**: the Solver goes onto the storefront.

If any step fails midway, the state becomes "publication failed" and the team tries again; the storefront only changes at the end.

## There is no guarantee of approval

Approval depends on the review. Never promise the date, the approval or sales. No rating is promised: the platform measures performance later, with its own method, and until then it shows "no reviews yet".

## Versions

- The version is `MAJOR.MINOR.PATCH`. The new one must be **greater** than the published one (`MANIFEST_VERSION_NOT_GREATER`).
- **MAJOR** (2.0.0): `tools`, `onboarding`, `requirements` or the structure of the steps changed.
- **MINOR** (1.1.0): new content (more knowledge, a new optional step within the same structure).
- **PATCH** (1.0.1): fixes.
- **Every version goes through full review**, with the diff of all files. There is no shortcut for a "small change".
- Each version needs an entry in `versions[]` with a date and a note on what changed.
- Open sessions on the old version ask to reactivate when used again.

## Direct changes outside review

Changing the price or version directly outside the site flow has no effect on what is served: the server keeps delivering the approved version and **blocks sales** until the difference is resolved. Always use the site flow.

## Suspension and withdrawal

The platform can **suspend** a Solver immediately (for abuse, rights or security reasons): it stops responding, including for those who have already bought it. The creator can also withdraw the Solver and reactivate it later. If there is doubt about rights or security, suspension comes before discussion.

## Money

Buying the license pays the creator immediately. That is why review is full and the Solver can be switched off at any time. The refund and dispute rules are part of the creator terms.

## After publication

- Keep the knowledge base current within the `reviewEveryDays` window. Expired content raises warnings and takes down the `liveData` differentiator.
- If you change the base, bump the version (MINOR or PATCH) and submit again.
- Answer help requests, if you declared `escalation`.
- If the average rating falls below 3.5 after 10 reviews, the Solver leaves the storefront until it is fixed.
