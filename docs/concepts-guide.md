# The Solvers guide for people who have never seen a blockchain

English | [Português](guia-conceitos.md)

State as of 2026-10-02. Everything runs on **devnet** (Solana's practice network, with test money). Mainnet (real money) is a plan, not a reality.
Anything that is a **prototype or does not exist yet** is marked "(prototype)" or "(planned)".

---

## 1. The whole story in 6 lines

1. A **creator** builds a "specialist" (a solver): a folder of text with steps, knowledge and templates. It is not a program, it is a **recipe**.
2. The **server** keeps the recipe and hands it **one step at a time** to the buyer's Claude/ChatGPT (through a "connector" called MCP). Anyone holding the whole recipe in one file can copy it for free, which is why it stays locked on the server.
3. The **buyer** pays in USDC and receives a **license**: a unique digital item (an NFT) that lands in their wallet.
4. The server looks at the wallet: "has a license? then unlock it."
5. A **guarantee** means the money sits in a vault until the work passes the tests.
6. **AI agents with no human** buy too (x402): they pay over the internet and the license lands in their wallet.

---

## 2. Blockchain concepts

| Term | In plain words | In Solvers |
|---|---|---|
| **Blockchain** | A giant notebook that **thousands of computers copy at the same time**. You only write at the end, and nobody can erase or scratch out what has already been written. | The notebook is **Solana**. |
| **Why use it** | Nobody has to **take our word for it**: anyone can check the notebook to see who bought, how much the creator received, what the rating is. | Licenses, reviews, guarantees and reputation. |
| **Wallet** | Your **address** in the notebook (like an account number) plus a **secret key** only you hold (like a pen password). | Email login (Privy) **creates an embedded wallet**; the user never even sees it. |
| **Private key / signature** | Signing = proving "it was me" without revealing the password. Without a signature nobody can touch your things. | Buying, reviewing, opening a dispute: the user signs. |
| **Transaction** | A **sentence written in the notebook**: "Ana pays 10 to Beto". | Every purchase is a transaction that the server builds and the user signs. |
| **Network fee (fee payer)** | Each sentence costs a few cents of **SOL** (Solana's currency). | **The platform always pays** (users do not need SOL). |
| **USDC** | A digital currency worth 1 US dollar. | The price of everything. On devnet it is a **test** USDC that we mint ourselves (with a free "faucet"). |
| **Devnet / Mainnet** | Devnet = training ground. Mainnet = the real game. | We are on devnet. |
| **Program (smart contract)** | A **robot judge that lives in the notebook**: it follows rules written in code, and nobody can bribe it or change it on the spot. | `programs/solvers` (Rust/Anchor): licenses, credits, reviews, guarantee, stake, resale. |
| **Account** | A **drawer** in the notebook where the program stores data. | `Agent` (the solver), `Escrow` (guarantee), `Review`, `Credits`, `Config`... |
| **PDA** | A drawer whose address is **computed by a formula** (e.g. "the drawer of solver X") and that **only the program can open**. Not even the platform can. | The guarantee and stake vaults are PDAs. |
| **Rent** | The "rent" of a drawer: whoever opens an account leaves a deposit, returned when it is closed. | **The platform pays it**, which is why every purchase must be **>= 5 USDC** (`min_price`). |
| **NFT** | A **unique digital item with a registered owner** in the notebook. | The **license**. Whoever owns the license has access. |
| **Metaplex Core** | The "standard format" for these items on Solana (cheap and simple). | Each solver has a **collection**; each license is an item in it. |
| **Hash** | A **fingerprint** of a file: change one letter and everything changes. | `versionHash` (package), `content_hash` (review text), `criteria_hash` (guarantee tests), `deliverable_hash` (deliverable). Only the fingerprint is stored, the text stays off-chain. |
| **Event + indexer** | The program "shouts" what happened; the **indexer** listens and copies it into our database (fast to query). | Helius webhook + a fallback sweep every 10 s. The database is a **mirror**; the truth is the chain. |
| **Escrow** | A **piggy bank with two locks**: the money leaves the buyer, stays locked, and is only released when the rule says so (to the creator or back). | The **guarantee** (section 8). |
| **Stake** | A creator's **good-faith deposit**: if they cheat, they can lose it. | `min_stake` (currently 0 on devnet, so it does not really protect anyone yet). |
| **Merkle root** | A **single fingerprint that summarizes an entire list** of receipts. | A batch of verified uses, every 10 min. |
| **Basis points (bps)** | A percentage in hundredths: 1000 bps = 10%. | Fee and royalty. |
| **Program upgrade** | Swapping the robot judge for a new version while keeping the drawers. | Old drawers **never change layout**; things are only added. |

**What is NOT on the blockchain** (and you should be able to say so clearly): the solver's **content** (steps, knowledge), the user's **memories**, **sessions**, the **text** of reviews (only the fingerprint), the catalog and the prices in local currency/Pix. What **is** there: license owner, price, sales, ratings, credits, guarantee, stake, version (hash) and reputation.
**Honest limit:** the license belongs to the user, but it is **our server** that unlocks the content by reading the wallet. If the server disappeared, the user would still own the NFT but would have no way to run the solver.

---

## 3. Who is who

| Who | What they do |
|---|---|
| **Creator** | Writes the package, sets the price, earns from each sale, can cap the number of licenses. |
| **Buyer (human)** | Signs in by email, pays, connects Claude/ChatGPT to the connector. |
| **Autonomous agent** | An AI with no human, holding a Solana keypair and USDC. Buys through x402. |
| **Server (platform)** | Delivers steps, knowledge, tools and memory; builds transactions; pays the network fee; indexes. |
| **System keys** | `admin` (**cold** wallet, off the VPS: approves solvers, judges disputes, slashes stake) · `verifier` (server: marks a milestone as "passed the tests", records the rating) · `usage_authority` (server: spends credits, records batches) · `custody` (server: receives and forwards x402 USDC). Separate keys: leaking the VPS does not let anyone steal stakes. |
| **Emergency pause** | The admin turns it on/off; the **guardian** can only turn it **on**. It pauses inflows (purchases) and/or payments; buyer exits never pause. |

---

## 4. Creator flow

> Code on the `feat/criador-solvers` branch (**not deployed yet**). Full guide: `docs/creator-guide.md`.

### 4.1 Building the package
The folder `agents/<slug>/`: `manifest.json` (name, price, steps, tools, free trial, guarantee, license cap), `steps/` (one `.md` per step, with a "gate" checklist), `knowledge/` (texts the AI consults), `templates/`, `evals/` (test cases). Full format: `PACKAGE_SPEC.md`. Packages are English-primary, with an optional Portuguese translation in `locales/pt.json`.
The creator does not have to write everything by hand: there is the **Solver Builder**, a **free platform solver** (database only, no blockchain) that, inside the creator's Claude/ChatGPT, walks through **7 steps** (promise, differentiators, steps, knowledge, tools, calibration, evals), consults the server's validator and delivers the ZIP.

### 4.2 How a package passes the tests (3 layers)

| Layer | What it does | Who decides |
|---|---|---|
| **1. Validator** (structure) | A single schema in code (zod), **67 codes**, each an error `E` (blocks) or a warning `A`. ZIP with no `..`/links/giant files, paths locked inside the folder, sizes, `slug`/version, price >= 5 USDC, steps with the 5 sections, knowledge with a source and a date (`YYYY-MM-DD`), **>= 10 eval cases**, **>= 2 of 5 "differentiators"** proven by the package itself (third parties can only prove memory, live data and escalation), third parties **with no tools, no guarantee, no regulated categories** (Finance, Legal, Health). It runs on its own at upload and also in `cli:validate`. | Machine (an error blocks the submission) |
| **2. Scans** ("is it malicious?") | **Warnings** with severity `info/warn/high`, shown to the reviewer: invisible or bidirectional Unicode, hidden HTML/CSS, remote images (they can leak data on load), prompt-injection phrases in PT/EN ("ignore the previous instructions", "do not tell the user"), requests for sensitive data, data-exfiltration URLs, **content copied from another published package**, search phrases off-topic, expired knowledge. | Machine warns, **human decides** |
| **3. Evals** ("does it work?") | Cases with simple checks (`regex`, `contains`, `not_contains`) applied to **answers generated beforehand** with the solver active. Produces `report.json` (score in `scoreBps`, 8750 = 87.5%, and a hash). | Machine |

**Limits you should be able to state:** the scans are **heuristics that can be bypassed**; nobody guarantees finding an injection hidden in one chunk among thousands, nor conditional behavior. The real defense is **invite + caps + human review of 100% of versions + fast shutdown**. The server **never runs third-party code** and treats the creator's content as **untrusted**. Performance rating: third parties **do not have one** (the storefront shows "No reviews yet", only buyer reviews); team packages show "internal team test", never "verified".

### 4.3 Upload, validation and human review

1. **Invite:** the team generates a code `SLV-XXXX-XXXX-XXXX` (`cli:invite create`) and sends it by email. It works once and gets bound to the wallet of whoever uses it. Without an invite there is no submission.
2. **Profile:** on `/creator/publish` the creator signs in, fills in name and bio, accepts the terms and enters the code. The escalation contact (Telegram) becomes "verified" when the creator links it themselves with a one-time `LINK-XXXXXXXX` code sent to the bot (`/vincular`); `cli:invite set-chat` is the admin shortcut.
3. **ZIP upload:** the server only **stores the file and answers immediately** (202). Limits: ZIP 50 MB, 150 MB once extracted, 2,000 files, 10 MB per file, only `.json/.md/.txt`, **3 submissions in progress** and **5 per day** per creator.
4. **Worker:** a **separate** process (`solvers-worker`, so it cannot take down the API that serves MCP and payments) extracts the ZIP, validates it, scans it and indexes the knowledge in a **staging** area, one at a time, resuming where it stopped if restarted.
5. **Human review** at `/admin/reviews` (whoever is in `ADMIN_WALLETS` can see it; it is a site permission only and **signs nothing on the blockchain**). The reviewer sees: validator errors/warnings, the manifest, a **diff of ALL files** against the published version, test searches over the knowledge, scans, declared vs. proven differentiators. Everything as **escaped text** (never HTML). To **approve**, they must tick the whole checklist (promise delivered, 2 of 5 differentiators, sources and rights, nothing against the user / no data sent out / no injection, coherent price and storefront) and write a reason. They can also **request changes**, **reject** or **revoke** an approval that has not been signed yet. Everything goes into an **insert-only trail** (`package_reviews`). Target: 5 business days.
6. **Co-signing:** once approved, the **creator signs in their wallet** `register_agent` (new solver) or `update_version` (update); the platform pays the fee. The platform **never holds a third-party creator's key**.
7. **On-chain approval (new solver only):** the owner runs `cli:approve <slug>` with the **cold wallet** (`approve_agent`). The command only approves if the on-chain account **matches** the version approved on the site. Only then does the solver appear on the storefront.

**Submission states:** `submitted -> validating -> (rejected_validation | pending_review) -> (changes_requested | rejected | awaiting_creator_signature) -> awaiting_onchain_approval -> publishing -> published`; afterwards `suspended`, `withdrawn` or `superseded` (new version). `publish_failed` = a step failed and the storefront **did not change**; the admin retries with "Finish" or `cli:approve` (safe to repeat). A submission stuck for 30 days in `changes_requested` or waiting for a signature **expires** and frees the name (cleanup every 6 h; rejected ZIPs disappear after 30 days).

**New version:** same `slug`, a **higher** `version`, and it **goes through the whole review again** (to stop "good version, then swap it"). Changing tools, calibration, requirements or the structure of the steps requires bumping the MAJOR version.
**Possible cheating and the defense:** the creator can call `update_version`/`update_pricing` **directly on-chain**, with no review. The indexer compares against the approved versions; if they diverge, it flags `unapproved_chain_version`, **keeps serving the approved package** and **blocks sales** (`price_in_review`) until the review approves or they revert.

The 6 older solvers and the platform ones (e.g. the Solver Builder) **do not go through this flow**: the authority for "being a platform solver" is a list on the server (`PLATFORM_AGENTS`), not the manifest field, and they ship through the CLI (`cli:publish`).

### 4.4 What goes on the blockchain at publication
- **The creator signs:** `register_agent` (creates the solver, the license collection and the stake) and, if the price changed, `update_pricing`.
- **The cold admin signs:** `approve_agent` (without it the solver stays `Pending` and cannot sell).
- Each new version: `update_version` (changes the fingerprint, **zeroes the rating**).
- Performance rating (`set_eval`): platform packages only.
- What does **not** go there: the package, the ZIP, the review text.

On-chain solver states: `Pending -> Active <-> Suspended`, and `Retired` (the creator asked to leave; the stake only comes out after 30 days).
**Kill switch:** `cli:suspend <slug>` does **both** things: sets `platform_status = suspended` in the database (drops open sessions, the storefront listing and sales immediately; the indexer never writes this field) **and** runs `suspend_agent` on-chain (otherwise someone could still buy directly). `--resume` undoes it. A solver leaves the storefront on its own with an **average rating < 3.5 after 10 reviews** (existing buyers keep using it).

### 4.5 The creator's money
At purchase, **in the same transaction**: the platform fee (`fee_bps`, capped at 20%) goes to the treasury and the rest **lands straight in the creator's USDC account**. There is no license refund. Resale pays the creator a **royalty** (section 9).

---

## 5. Human buyer flow

1. **Sign in:** email through Privy -> embedded wallet (or Phantom). Login = signing a message (SIWS, "Sign In With Solana") -> session token.
2. **Choose and pay:** storefront -> checkout. Options: USDC in the wallet · **Pix** · **SODAX**. (Prototype) In the demo, Pix and SODAX are **simulated** (they credit test USDC; SODAX gives a real quote but a fake payment). Mainnet rejects simulation.
3. **`POST /api/tx/purchase`:** the server builds the `purchase_license` transaction (with the **price the user saw**, `expected_price`: if the creator changes the price midway, the purchase **fails** instead of charging a different amount). The user signs; the platform pays the network fee.
4. **The program checks and executes all or nothing:** is the solver `Active`? stake >= minimum? price >= 5 USDC? not paused? cap not exceeded? Then: it splits the USDC (platform/creator), **creates the NFT in the buyer's wallet** and adds the sale to the reputation.
5. **Event -> indexer -> database -> `list_my_solvers` shows it.** If the database has not seen it yet, the connector checks the chain directly.

**License cap:** the creator can set a limit (e.g. 10). The **program** blocks sales beyond it (`SoldOut`); burning/reselling/transferring does **not** free a slot; the creator can only **raise** the cap. Never promise "only N will exist": say "the current limit is N and it can only go up".
**Other ways to buy:** **credits** (pay per use: `buy_credits`; each activation spends 1) and a **per-task guarantee** (section 8).

---

## 6. Using the solver (MCP connector)

1. **Connect:** the user pastes `https://solvers.wondervelop.com/mcp` into Claude/ChatGPT. `/mcp` answers 401 -> the client discovers **OAuth** by itself (automatic registration + PKCE) -> opens the "Connect your wallet" page -> the user signs -> the client receives a token **bound to the wallet**.
2. **Tools** (the AI calls them on its own): `list_my_solvers`, `find_solver` (search by meaning), `get_purchase_link`, `activate_solver`, `preflight_check`, `next_step`, `search_knowledge`, `run_tool`, `get_memory`, `save_memory`, `forget_memory`, `submit_deliverable`, `escalate_to_creator`, `list_open_guarantees`, `get_template` (the package's templates).
3. **Flow:** `activate_solver` checks the license (or credit, or trial) and opens a **session** -> `preflight_check` (does the AI have the required tools?) -> `next_step` delivers **one step at a time** (with a checklist the AI must complete) -> `search_knowledge` (**RAG**, section 7.1: 5 chunks of knowledge found by meaning, with source, date and a per-wallet watermark).
4. **Free trial:** 3 uses per wallet per solver (off-chain, in the database; only what the creator unlocks). **Agents get no trial** (a new wallet costs nothing).
5. **Memory and calibration** (section 7.2): user preferences, encrypted (AES-256-GCM); the key comes from a **second signature** by the user and is stored wrapped by the server's master key. It is **encryption at rest**: do not promise "only you can read it".
6. **Review:** `submit_review` requires a **license** (or purchased credits). One license proves **one** review (`license_review`). The text stays off-chain; **only the fingerprint + a 1-5 rating** go on-chain.
7. **Escalate:** `escalate_to_creator` sends a summary to the creator's Telegram (a human fallback).
8. **Usage log:** each verified use becomes a receipt; every 10 min a **batch** records the count + Merkle root on-chain (`record_usage_batch`).

---

## 7. RAG and calibration (how the specialist "knows" and "adapts")

Two problems, two pieces. **Neither trains or alters the AI model** (Claude/ChatGPT remain exactly the same).

| | **RAG** (what the specialist knows) | **Calibration** (what it knows about you) |
|---|---|---|
| **Analogy** | A **library with a librarian**: instead of the AI memorizing everything, it asks and receives only the right pages. | A **client file**: on the first visit the clerk asks the essentials and writes them down; on later visits they already know you. |
| **Whose it is** | The creator's (the same for every buyer). | The user's (one file per wallet **and** per specialist). |
| **Where it lives** | Database, as chunks with vectors (`knowledge_chunks`). | Database, **encrypted** (memory). |
| **When it acts** | When the AI calls `search_knowledge`. | On first use (`get_memory`) and in every step that reads the profile. |

### 7.1 RAG (Retrieval-Augmented Generation = "look it up before answering")

**Why it exists:** the AI cannot receive the whole knowledge base every time (expensive, slow, and it would give the product away). So we store the texts on the server and deliver **only 5 chunks** per query.

**Preparation (at publication, once):**
1. The creator writes `.md`/`.txt` texts in `knowledge/`, each with a header: title, **source**, source date, `valid_until` (validity) and, optionally, `trial: true` (unlocked in the free trial).
2. The server **cuts them into chunks** of ~2,000 characters (~500 "word pieces"), respecting headings and paragraphs and repeating ~200 characters between chunks so an idea is not cut in half.
3. Each chunk becomes a **vector** (an embedding): a list of 384 numbers that represents the text's **meaning**, so texts with similar meaning sit "close" to each other (like points on a map). The model runs locally on the VPS (`multilingual-e5-small`), at **zero cost** and without sending text to third parties. They go into Postgres with pgvector.

**At use (on every query):**
1. The user's AI calls `search_knowledge` with its question. The server turns the question into a vector and finds the **5 closest chunks**, only from the **solver and version** the user owns (solvers are never mixed).
2. Each chunk comes back with its **title, source and date**; if it is past `valid_until`, it comes back with a **"may be out of date" warning** and the AI is instructed to **cite the source** and suggest double-checking.
3. Every answer carries a **watermark** (a control phrase that varies per wallet) to trace leaks.
4. Protections: a **daily quota** of queries per wallet and solver (stops someone draining the base by copying); in the **free trial** only files marked `trial: true`; without a license, nothing.

**Same idea, another use:** `find_solver` and the storefront search also use vectors: each solver has a vector for its whole text and one per search phrase (`searchPhrases`), and the user's request ("I need a nice website") finds the closest one. Only those "right next to" the best result make it in. If the model did not load, it falls back to Postgres keyword search.

**Limits to be able to state:** RAG **finds** chunks, it does not guarantee the AI uses them well; quality depends on what the creator wrote; meaning-based search can return a similar but wrong chunk (which is why source and date are shown). The human reviewer checks the sources and the scan warns about expired or copied content. Third parties in the Core phase only submit `.md`/`.txt` (PDF is for the "Opening" phase).

### 7.2 Calibration: the "artificial fine-tuning" (without training anything)

**Real fine-tuning** = retraining the model with your data (expensive, slow, the model "changes inside"). **We do not do that here.** We do the practical equivalent: **ask the first time, store the answers and make every step read the file**. It feels as if the specialist was made for the user's case, but the model is the same.

**How the creator configures it:** in `manifest.onboarding` they declare **1 to 5 questions**, each with `ask` (the question), `why` (why it is asked, which the AI can explain) and optional `options` (2 to 6). Example: "What is your tax regime?" (why: "it changes which obligations apply to you"). The validator flags **sensitive-data** questions and the reviewer decides.

**Flow on first use:**
1. The user activates the solver. The server tells the AI to call `get_memory` **before step 1**.
2. There is no file yet -> the response carries `needs_onboarding` with the questions. The AI asks them in **at most 2 messages**, explaining the reason for each. **Every question can be skipped.**
3. The AI saves the answers (`save_memory`, kind `profile`). If the user skipped, it saves `skipped` and **does not ask again** every session.
4. In the following steps the AI reads the profile and **adapts** examples, language and choices. The user can ask to "recalibrate" at any time (this replaces the file).
5. Beyond calibration, the AI only stores **notes** (up to 30) when the **user asks** ("remember this").

**Safety rules:** the profile is **user data, not instruction**: it **cannot remove steps or checklist items** from the method (otherwise it would be a loophole to skip what the creator required). This also holds in the free trial. The file is **encrypted** (AES-256-GCM, key derived from a second wallet signature). It is encryption at rest: the server opens it while the token is valid, so **do not promise "only you can read it"**. Without the memory signature (a connection made without it) -> `onboarding_unavailable`: the solver carries on with defaults and tells the user how to reconnect. Memory is **per wallet + specialist**, does **not travel** with the license if it is resold, and the user can **delete** everything from the storefront.
**Data on the user's computer** (spreadsheets, files their AI reads) **stays there**; only what passes through the tools reaches the server.

---

## 8. Guarantee (escrow)

**Analogy:** you hire a painter and leave the money **in a notary's vault**. The painter only gets paid if the wall passes inspection. If it does not, the money comes back.

**What escrow is here:** the program opens an `Escrow` + a **PDA vault** (only the program touches it), with up to **5 milestones**, each with an amount and a **criterion agreed beforehand** (`criteria_hash` = the fingerprint of the acceptance tests). Nobody, not even the platform, can take the money out outside the rules.

| # | What happens | Who |
|---|---|---|
| 1 | Task, milestones, amounts, tests and deadline are agreed (default 14 days, max 60). USDC goes from the buyer to the vault (`create_escrow`). | Buyer signs |
| 2 | The AI delivers (`submit_deliverable`). The server runs the tests **agreed beforehand** (the deliverable cannot swap the tests) in a **disposable Docker container**: no internet, limited CPU/memory, 60 s, no privileges. | Server |
| 3 | Passed -> `mark_passed` on-chain (with the deliverable's fingerprint) + a **watermarked preview**. The **code is only released after approval**. | `verifier` |
| 4a | The buyer is happy -> `release_milestone`: the creator is paid (minus fee). | Buyer |
| 4b | Does nothing -> the **review window** passes (1 min to 30 days) -> **automatic release** (1-minute job). | Anyone/job |
| 4c | Not happy -> `open_dispute` -> the **admin judges** (`resolve_dispute`: refunds or pays). If the admin does not rule within **7 days**, anyone can send it back to the buyer (`resolve_stale_dispute`). | Admin |
| 5 | The creator **never delivered** by the deadline -> the buyer cancels (`cancel_undelivered`), **no fee**. | Buyer |
| 6 | Everything resolved -> `close_escrow` returns the rent to the platform. | Platform |

**Protections:** whoever loses a dispute gets a mark (`disputes_lost`; a buyer with **3** cannot open a new guarantee; the creator drops in the ranking). Limits by buyer reputation: **new account (<3 purchases) up to 20 USDC** (above 10, at least 2 milestones) · trusted up to 500 USDC · level "none" with >=3 lost disputes. Minimum purchase 5 USDC. Fee and deadlines are **frozen at creation** of the guarantee.
**Creator stake:** if they cheat, the admin **proposes a slash** -> a **72 h** wait -> the creator can contest (evidence only) -> **executes** (money goes to the treasury; 14-day window). Since `min_stake` is 0, there is nothing to slash today. Today **only platform packages** offer a guarantee; the dispute decision is **a manual admin call** (an arbitration simulation).

---

## 9. License resale

The owner lists the license at a price -> another person buys it through the Solvers marketplace -> the license **changes wallet in the same transaction**. **Non-custodial:** the license stays with the seller until the sale (they only authorize the program to transfer it). The price is split into a **royalty** to the creator + a platform **fee** + the **remainder** to the seller (e.g. 100 -> 5 creator, 10 platform, 85 seller; the two together <= 50%). A creator cannot resell their own license. The royalty applies **only in our marketplace** (transferring outside is free and carries no royalty). Memories do **not** travel with the license (they belong to the wallet). Resale does **not** consume a slot of the cap. Controlled by the `RESALE_ENABLED` flag; mainnet waits for the terms with the lawyer.

---

## 10. Autonomous purchases: x402

**x402** = using the HTTP **402 "Payment Required"** code (forgotten since 1990) so a robot can pay over the internet with no account, card or human.

**Step by step (`POST /api/x402/solvers/:id/license`):**
1. The agent asks to buy. The server creates an **order with a locked price** and answers **402** stating: how much, on which network, whom to pay and a **memo** (= the order id, tying the payment to that request).
2. The agent signs a USDC transfer and **repeats the request** with the `PAYMENT-SIGNATURE` header.
3. The **facilitator** (x402's "cashier") **checks** the transfer, **pays the network fee** on the agent's behalf (it only needs USDC) and **sends** it to Solana. It does **not convert currency** and has no relationship with SODAX.
4. Once the payment is confirmed, the platform's **custody** runs `purchase_license` and **transfers the NFT to whoever paid** (never to an address they supply: less abuse).
5. If the payment went through but the license **failed**, the order is **refunded** to the payer, and only after making sure the issuance will not land on the network (otherwise the agent would end up with both).

**Why custody exists:** x402 only accepts **one** simple USDC transfer; `purchase_license` is more complex. So the platform **receives** the USDC and **buys with it**. A consequence you should be able to explain: there is a moment when the platform holds third-party money; that is why there is reconciliation (every 60 s) and an idempotent refund. The program **did not change** because of x402.
**Order:** `created -> settling -> paid -> minting -> minted` (or `refunding -> refunded`, `expired`, `failed`). It settles **before** issuing (`upfront`): otherwise the license would be born free if the payment failed.
**Rules:** price between **5 and 100 USDC** per purchase; no free trial; errors `already_owned` (already has it) and `creator_cannot_buy`; the cap and the pause apply.
**Getting into the connector without a browser:** `GET /oauth/agent/nonce` + `POST /oauth/agent/token` (sign a message; 2 calls). The signature says "**this does not authorize payments**": login never moves funds. The token is marked as an agent (`client_id=agent`), and the responses swap "show the user" for x402 purchase instructions and "decide from context and record the assumption".
**Status:** validated on devnet on 2026-10-02; **mainnet blocked until a legal opinion** (custody of third-party money).

---

## 11. What is real and what is fake today

| Real | Simulated / planned |
|---|---|
| Purchase, NFT, cap, resale, credits, reviews, guarantee and Docker tests, x402, devnet upgrade | Pix, SODAX (payment) and USDC (test, on devnet) · dispute arbitration = manual admin · stake at 0 · upload and review: ready on the `feat/criador-solvers` branch, **not deployed yet** · mainnet (planned) · Cloak/Zcash (roadmap) |

---

## 12. Questions you need to be able to answer

1. **Where does the license live?** In an NFT in the user's wallet. Access is unlocked by our server reading the wallet.
2. **What does the blockchain store and what not?** Owner, price, sales, ratings (fingerprint), credits, guarantee, stake, version hash. It does **not** store the content, memories, sessions or the review text.
3. **Who pays the network fee?** The platform, always. That is why the minimum is 5 USDC (it covers the rent).
4. **How do I know a solver is not malicious?** Invite + validator + scans (warnings) + human review of 100% of versions, with a diff + no execution of third-party code + kill switch. There is no absolute guarantee, and the spec admits it.
5. **How do I know it works?** Evals (cases with checks); the rating only goes on-chain for platform packages.
6. **What is escrow and who decides?** A PDA vault; automatic tests release it, the buyer approves or contests, the **admin judges**, and there are deadlines that resolve things on their own (auto-release, 7 days of dispute, delivery deadline).
7. **What if the creator disappears?** Guarantee: cancel without a fee after the deadline. A license already paid for: there is no automatic refund (hence the stake, the kill switch and curation).
8. **What is x402 and why custody?** HTTP payment for robots; the platform receives and buys in the agent's name, delivers the NFT to the payer and refunds if it fails.
9. **Can an agent see the content without paying?** No: without a license there is no content, and agents get no trial.
10. **Can the creator "freeze" the offer?** They can cap licenses, but the cap only **goes up**; do not promise eternal scarcity.
11. **Who can move the money?** Only the program, under its rules. The server keys (`verifier`, `usage_authority`) cannot withdraw from vaults; `admin` is cold.
12. **What is RAG?** Look it up before answering: the creator's knowledge becomes chunks with "meaning as numbers" (vectors) in the database; the AI asks and receives only 5 relevant chunks with source and date. It does not train the model.
13. **What is Solvers' "fine-tuning"?** It is not fine-tuning: the model does not change. It is **calibration**: 1 to 5 questions on first use (skippable), answers stored encrypted in memory, and each step reads the profile to adapt. The profile never removes steps from the method.
14. **RAG vs. memory?** RAG = what the specialist knows (from the creator, the same for everyone). Memory = what it knows about you (from your wallet).
15. **What does mainnet require?** A legal opinion (x402/custody, resale, creator terms), simulations turned off, real keys and the open items in `docs/mainnet-runbook.md`.

---

## 13. Where everything is in the code

| Topic | File |
|---|---|
| On-chain rules | `programs/solvers/src/instructions/*.rs`, `state.rs` |
| Validator, scans | `apps/server/src/runtime/validate/` |
| Publishing | `apps/server/src/cli/publish.ts` |
| Evals | `scripts/src/eval.ts`, `agents/<slug>/evals/` |
| MCP connector, OAuth | `apps/server/src/mcp`, `oauth` |
| Guarantee and Docker tests | `apps/server/src/verifier`, `store/escrow.ts`, `jobs.ts` |
| x402 | `apps/server/src/x402`, `docs/x402-agentes.md`, `docs/agentes-login.md` |
| Resale, cap | `docs/resale.md`, `docs/licencas-limitadas.md` |
| Indexer | `apps/server/src/indexer` |
| RAG (chunking, vectors, search, quota) | `apps/server/src/knowledge` |
| Memory and calibration | `apps/server/src/memory`, `mcp/tools.ts` (`get_memory`, `save_memory`) |
