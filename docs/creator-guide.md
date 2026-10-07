# Creating Solvers: guide for creators and admins

English | [Português](criador-solvers.md)

Invite-only publishing flow (the "Core" phase of `PACKAGE_SPEC.md`). Details and decisions: `PACKAGE_SPEC.md` §14 to §16; production rollout: `docs/deploy-criador-solvers.md`; test script: `docs/teste-manual/02-criador.md` (J16).
Updated 2026-10-02 (branch `feat/criador-solvers`, not deployed yet).

Solver packages are English-primary. A package can optionally ship a Portuguese (pt-BR) translation in `locales/pt.json`; see "Localization" in `PACKAGE_SPEC.md`.

---

## Part 1. For creators

### How it works

1. **Invite.** The team emails you a code in the form `SLV-XXXX-XXXX-XXXX`. Without an invite you cannot submit (an invite works once and gets bound to your wallet).
2. **Profile and Telegram.** Sign in on the site, open `/creator/publish`, fill in your name and bio, accept the terms and enter the code. Save the profile and link your Telegram (see "Linking Telegram" below): without it your escalation contact is not "verified" and the ZIP upload stays locked.
3. **Build the package with the Solver Builder.** In your AI (Claude or ChatGPT, with the Solvers connector), activate the free "Solver Builder" Solver (slug `criador-de-solvers`). It walks you through 7 steps (promise, differentiators, steps, knowledge, tools, calibration, evals), consults the server's validator and hands you the files or the ZIP.
4. **ZIP.** A single root folder named after the Solver's `slug` inside the ZIP (details below).
5. **Submit.** On `/creator/publish`, upload the ZIP (request body `application/zip`). The server only stores the file and answers right away; extraction and validation run afterwards in a separate process, and the result shows up at `/creator/submissions/<id>`.
6. **Review.** If the validator finds no errors, the package joins the queue. Response target: **up to 5 business days**. If we ask for changes you get the reason (resubmit the ZIP on the same submission, same version); if we reject, you get the reason too.
7. **Co-signing.** Once approved, the screen asks for your signature in your wallet (`register_agent` for a new Solver; `update_version` for an update). You pay no network fee (the platform is the fee payer).
8. **Published.** A new Solver still waits for the team's on-chain approval (`approve_agent`, signed with the cold wallet); an update to an already-approved Solver finishes by itself. The storefront only changes in the last step.

If you do not sign or resubmit within **30 days**, the submission expires (it becomes `rejected` and the slug is released) and you can submit again if you wish.

### Linking Telegram

Telegram is how we reach you (submission received, review outcome, help requests from buyers). You link it yourself, without waiting for the team:

1. On `/creator/publish` (the profile section) click **Link Telegram**. The site shows a `LINK-XXXXXXXX` code that is valid for **15 minutes** and works **once**. You can generate up to 5 per hour; a new code cancels the previous one.
2. Click **Open in Telegram** (it pre-fills the code) and tap *Start*. Or open the Solvers bot (the site shows the @handle) and send `/link LINK-XXXXXXXX`.
3. The bot replies that your Telegram was linked to Solvers. The site notices within a few seconds (or click **I already linked it**).

Only private chats with the bot count. Each Telegram account belongs to a single creator. To switch Telegram accounts, generate a new code and send it from the other account. If the bot says the code is not valid, it may be wrong, expired or already used: generate another one.
If the site says linking is unavailable, the server's bot is down (`TELEGRAM_BOT_TOKEN`); contact the team, who can also link you with `cli:invite set-chat`.

### What the validator requires (summary)

The full catalog of codes is in Appendix A of `PACKAGE_SPEC.md`; an error blocks the submission, a warning goes to the reviewer. To check beforehand: `pnpm --filter @solvers/server cli:validate <folder>` and the schema at `GET /api/spec/manifest.schema.json`.

- `manifest.json` with `specVersion: 1`, `terms`, `versions[]` including the current version, a name of up to 32 bytes, a version `X.Y.Z` of up to 16 bytes and at least the program's minimum price (5 USDC).
- A `slug` outside the reserved list and never in the shape of an `id` (32 hex characters). The `id` and `creator.id` belong to the server: it overwrites whatever you write.
- Steps in `steps/` (1 to 12 `.md` files, 400 to 12,000 characters) with the five required sections: `## Goal`, `## What to ask the user`, `## How to run`, `## Common mistakes` and `## result_summary format`. The validator matches these English section titles exactly as written; the old Portuguese titles (`## Objetivo`, `## O que perguntar ao usuário`, `## Como executar`, `## Erros comuns`, `## Formato do result_summary`) are still accepted for older packages. The text under them can be in any language.
- At least **2 of the 5 differentiators** proven by the package itself. In the Core phase, third parties can only prove `memory` (`onboarding` plus a step that uses the profile), `liveData` (dated knowledge, no expired `valid_until`, `source_date` in at least half of the files) and `escalation` (`escalation.enabled` with your Telegram linked). `tool` and `verifier` wait for the Opening phase. Declaring one that the package does not prove raises a warning, and the reviewer will not approve with fewer than 2 proven.
- `.md`/`.txt` knowledge with a `source` and `YYYY-MM-DD` dates (front matter in `.md`, `name.txt.meta.json` for `.txt`); up to 10,000 chunks.
- At least **10 cases** in `evals/cases/` (fewer is a warning today and an error for v1 packages).
- Text in UTF-8, with no invisible or bidirectional characters and no injection patterns (these become warnings for the reviewer).

### New version

Submit a ZIP with the same `slug` and a **higher** `version` than the published one. Every version goes through the full review, with an automatic diff of all files against the published one. Changing `tools`, `onboarding`, `requirements` or the structure of the steps requires bumping the MAJOR version. Changing the version or price directly on-chain, without going through here, does not change what the buyer receives and blocks sales (`price_in_review`) until the review approves it or you revert.

### What is not allowed in the Core phase

- **Tools**: third parties do not declare `tools` (there is no runner). Only platform packages have `builtin:*`.
- **Guarantee (escrow)**: `guarantee.available: true` is rejected; there is also no `verifier/` folder and no `platform: true`.
- **Categories**: Finance, Legal and Health are rejected. Accepted: Development, Design, Everyday, Business, Travel, Content, Writing, Other (the manifest `category` field currently takes the Portuguese values `Desenvolvimento`, `Design`, `Dia a dia`, `Negócios`, `Viagens`, `Conteúdo`, `Escrita`, `Outros`).
- **Public rating**: third parties have no performance rating on the storefront; the card shows "No reviews yet" (old ratings of team packages appear as "internal team test").

### ZIP and submission limits

| Item | Limit |
|---|---|
| ZIP size | 50 MB (`SUBMISSION_MAX_ZIP_BYTES`) |
| Actual uncompressed bytes | 150 MB, counted during extraction |
| Files | 2,000 |
| Single file | 10 MB |
| Extensions | `.json`, `.md`, `.txt` |
| Structure | exactly 1 root folder with `manifest.json`; no `..`, `\`, absolute path, symlink or name starting with a dot |
| System junk | `__MACOSX/`, `.DS_Store`, `Thumbs.db` are removed with a warning |
| Submissions in progress | 3 per creator (`SUBMISSION_MAX_PENDING`) |
| Submissions per day | 5 per creator (`SUBMISSION_MAX_PER_DAY`) |

---

## Part 2. For the admin and the reviewer

Commands run in `apps/server` (or with `pnpm --filter @solvers/server <script>`), using the environment's `.env`. The `:devnet` variants use `.env.devnet`.

### Who is an admin

`ADMIN_WALLETS` (comma-separated wallets, in the server's `.env`) defines who sees `/admin/reviews` and the `/api/admin/submissions/*` routes. It is a site permission only: it **signs nothing on-chain**. The on-chain signature belongs to `ADMIN_KEYPAIR`, the cold wallet, which only exists on the team's machine.

### Invites and Telegram

From the repository root (`pnpm --filter @solvers/server ...`) or, inside `apps/server`, just `pnpm cli:invite ...`. **No extra `--`:** pnpm forwards it to the script and the command breaks.

```bash
pnpm --filter @solvers/server cli:invite create --email jane@x.com --note "who they are" --count 3   # prints the codes; you send them by email (flags optional)
pnpm --filter @solvers/server cli:invite list                                                         # all of them, with who used each
pnpm --filter @solvers/server cli:invite revoke <code>                                                # only invites not yet used
pnpm --filter @solvers/server cli:invite set-chat <wallet> <chatId>                                   # shortcut: links the creator's Telegram by hand
# inside apps/server: pnpm cli:invite create --email x@y.com
```

Creators normally link on their own through the bot (see "Linking Telegram" in the creator part): `POST /api/creator/telegram-link` generates the code and the `solvers-worker` process (the only one that calls `getUpdates`) handles `/link` (alias `/vincular`) and `/start` in the bot. `set-chat` remains as a shortcut and requires the creator to have already registered a profile. The bot needs `TELEGRAM_BOT_TOKEN` in the server's `.env` and **must not have an active webhook** (if it does, the worker removes it once, with a log line). Notifications go to the creator's Telegram; without a link, review notices stay with the admin only.

### Review at `/admin/reviews`

The queue lists `pending_review` submissions from oldest to newest. The submission screen shows: the validator (errors and warnings), the manifest, a diff of every file against the published version, the knowledge (chunks, expired ones, a test search on the staging ingestion), automatic scans, and declared vs. proven differentiators. All creator content is displayed as escaped text.

Decisions (a reason of at least 3 characters is mandatory):

- **Approve** requires the whole checklist ticked: promise delivered by the steps; 2 of 5 differentiators proven; sources and rights; nothing against the user, no data sent outside, no injection; price, free trial and storefront are coherent (no financial, legal or medical promises). It records the approved version (hash, price, version) and moves to `awaiting_creator_signature`.
- **Request changes** and **Reject**: only the reason. The creator sees the text.
- **Revoke approval** (`POST /api/admin/submissions/:id/revoke`): undoes an approval the creator has not signed yet; goes back to `changes_requested`.

**Approving on the site signs nothing on-chain.** The trail of every action lives in `package_reviews` (insert-only; actions `approve`, `request_changes`, `reject`, `revoke`, `expire`, `finish`, `suspend`, `resume`).

### On-chain approval and publication

For a **new** Solver, after the creator co-signs `register_agent` (state `awaiting_onchain_approval`), on the machine with the cold wallet:

```bash
pnpm --filter @solvers/server cli:approve <slug|submissionId> [--dry-run] [--allow-network <name>]
pnpm --filter @solvers/server cli:approve:devnet <slug>
```

It only approves if the on-chain account matches the version approved on the site; then it completes the publication. By default it only runs on devnet (it checks the RPC genesis). Updating an already-approved Solver does not go through here.

### Suspend and resume (kill switch)

```bash
pnpm --filter @solvers/server cli:suspend <slug> [--reason "<reason>"] [--allow-network <name>]
pnpm --filter @solvers/server cli:suspend <slug> --resume
```

It does both things: `agents.platform_status = suspended` (drops open sessions, the storefront listing and sales immediately; the indexer never writes this field) and `suspend_agent` on-chain with `ADMIN_KEYPAIR` (without it, buying directly on-chain would still be possible). `--resume` does the reverse. Everything is recorded in `package_reviews`.

### Platform Solvers (no chain)

```bash
pnpm --filter @solvers/server cli:publish --no-chain            # database only: price 0, active, listed
```

This applies to the packages listed in `PLATFORM_AGENTS` (`runtime/platform-agents.ts`, the authority; the manifest's `platform` field alone does not count), such as `criador-de-solvers`. Third parties never go through here. Do not republish packages that have an on-chain account (`cli:publish` without `--no-chain`) without first deciding about the rating: `update_version` zeroes the rating stored on-chain.

### When something fails: `publish_failed`

This state means that a publication step (knowledge, chain or catalog) failed; the storefront did not change. To resume, use either of these (both idempotent):

- The "Finish" button in `/admin/reviews`, or `POST /api/admin/submissions/:id/finish` with the admin session.
- `cli:approve <submissionId>` again (it also completes the finalization if the chain is already Active).

If the cause is environmental (RPC, disk), fix it and retry; the error is kept in the submission's `error` field. The worker automatically retries system failures during validation (1-minute interval, up to 3 attempts in `package_submissions.attempts`; once exhausted, the submission becomes `rejected_validation` with an admin alert) and alerts the admin on Telegram on the first failure.

### Where files live and cleanup

- `SUBMISSIONS_DIR` (production: `/var/www/solvers/shared/submissions/<id>/`): the original ZIP (`package.zip`) and the extracted folder. Only the VPS owner can read it (chmod 700).
- `PUBLISHED_DIR` (production: `/var/www/solvers/shared/packages/<slug>/`): one active package per slug; the previous version goes to `_archive/<slug>/<version>/`.
- Both live under `shared/` and survive deploys. The weekly backup excludes ZIPs and `_archive` (patch in `docs/deploy-criador-solvers.md`).
- **Automatic cleanup** (job `faxina das submissões`, every 6 h, `submissions/cleanup.ts`): (1) `changes_requested` and `awaiting_creator_signature` submissions idle for more than 30 days become `rejected` with an "expired" note (action `expire`, signed by `system`), free the slug and notify the creator; (2) the ZIP and folder of submissions rejected more than 30 days ago are deleted (the row and the trail stay); (3) folders with no database row and `.part` files from interrupted uploads older than 1 day.

### The worker

`solvers-worker` is a PM2 process **separate** from `solvers-api` (`infra/ecosystem.config.cjs`, `infra/worker-run.sh`, entry point `dist/worker/index.js`). It extracts the ZIP, validates it, scans it and ingests the knowledge into staging, one submission at a time, with a checkpoint in `ingest_jobs`. Locally: `pnpm --filter @solvers/server worker` (compiled) or `worker:dev`. If the worker is stopped, submissions stay in `submitted`/`validating` and resume from the checkpoint when it returns. With `SUBMISSIONS_INLINE=true` (local QA only) processing runs inside the API.

### `price_in_review` and `sync_flag`

The indexer compares the chain's version and price with `agent_published_versions` (the approved versions). If they diverge (the creator called `update_version`/`update_pricing` directly), it sets `agents.sync_flag = unapproved_chain_version`: the served package stays the approved one, the storefront shows the approved price and the sale answers 409 `price_in_review`. The state clears when the chain returns to the approved values or when a new review approves the hash. `agents.platform_status` (suspension) is a different column and the indexer never writes it.

### Testing the whole flow (local QA)

`scripts/qa-reset.ps1` recreates the disposable `t_qa` database (container `solvers-pg-criador`, port 5544) and clears the data folders; then, with the local server on `.env.qa`, run `cd scripts && npm run e2e:creator`. It writes only one test Solver (`qa-fluxo-criador`) to devnet. It never points at the VPS database.
