# LGtie

**Settle disputes fairly, with rules everyone can see first.**

> **[Open the live app](https://lgtie.vercel.app/)** · **[A real case settled on X Layer](https://lgtie.vercel.app/#case/1)** · [Fictional support page with the embedded checker](https://lgtie.vercel.app/embed-demo.html) · [Features in detail](docs/FEATURES.md)

Built for the **X Layer TapeOut Accelerate** hackathon. It is early software: the contracts are unaudited, it holds no funds and it has no customers yet.

## Pitch

LGtie is a **dispute layer for published rules**. A business publishes its rules as yes or no questions on X Layer, before anything goes wrong. If a dispute comes, both sides answer the same questions, and **only the questions they disagree on** go to a neutral person both agreed on. The published rules turn the final answers into a result and a reason that **anyone can re-run for free**. There is no server, no escrow and no account: a customer approves with the fingerprint or face scan that unlocks their phone.

It is the step between "we disagree" and "we go to court": cheap, fast, and decided by rules nobody could change afterwards.

## Problem

When a claim or a report is disputed (a warranty repair, a refund, a bug's severity), the rules usually live inside one side's own process.

- Both sides argue about the **whole outcome**, not the one fact they actually disagree on.
- Nobody can show afterwards that the rules were **applied the same way every time**.
- The person who decides is often **one of the parties**.
- Courts and arbitration are slow and costly for small amounts, so most small disputes are settled by whoever has the most power.

## Solution

1. The business **publishes its rules in advance** as yes or no questions. Once published they cannot be changed quietly.
2. Both sides **agree up front** on those rules, on a neutral reviewer (who can sign a named, checkable identity) and on the time limits.
3. If a dispute comes, **both sides answer the same questions**. Where the answers match, it is settled.
4. **Only the disputed questions** go to the reviewer. Nothing else.
5. The published rules give a **result and a reason**. Anyone can recompute it and get the same result.

A customer needs no crypto wallet. LGtie never holds anyone's money, and it cannot tell whether someone is telling the truth; the reviewer settles the facts the two sides disagree on.

<p><img src="docs/img/home.png" alt="LGtie home page running the real published warranty circuit: tap an answer and the result and reason change" width="100%"></p>
<p><sub>The home page runs the real published warranty circuit: tap an answer and the result and the reason change.</sub></p>

## Architecture

```
  Business                       X Layer (chain 196)                       Customer
  ────────                       ───────────────────                       ────────
  writes rules  ──► compiles to a NAND circuit ──► TapeOut processor          (wallet,
  in the builder    (proved equal to the rules)    runs it: eval(inputs)       or passkey:
        │                                                  ▲                  fingerprint /
        └──► RuleSetRegistry  (rules fingerprint, versions)│                  face scan)
                  │                                        │                      │
                  ▼                                        │                      │
        AgreementRegistry  (rules + reviewer + deadlines, locked) ◄───────────────┘
                  │
                  ▼
        TiebreakCase V3 / V4   both sides answer ── match ──► settled
                               differ ──► reviewer answers ONLY those ──► result + reason
                                                   │
                                                   ▼
                         verdict(id): other contracts can read it;  anyone can re-run it
```

- **A static site.** No server and no database: the web app, the rule compiler and the checks run in the browser (`site/`). The built site is one page in `dist/`.
- **Rules are data, not code.** A rule set compiles to a small circuit of NAND gates and is stored on the existing **TapeOut processor**, so it cannot hold hidden state or an admin key.
- **Contracts** (`contracts/`, Foundry): `RuleSetRegistry`, `AgreementRegistry` (and V2), `TiebreakCase` V3 and V4, `PasskeyRegistry`. V4 accepts only the official processor and lets a party be a passkey account, using X Layer's built-in P-256 check.
- **No wallet for customers.** A passkey signs each action; any wallet (usually the business's) submits it and pays the small fee. Signed actions travel through public Nostr relays to the business's inbox.
- **Optional bridge** (`bridge/`): a script a business runs itself to forward those messages to Slack, Discord or any webhook.

The contract addresses and what is live are listed [below](#live-on-x-layer-chain-196).

<p><img src="docs/img/case.png" alt="A decided case on X Layer: six answers matched, one differed, so only that question went to the reviewer" width="100%"></p>
<p><sub>A real case on X Layer (played by the project's builder, so a demonstration, not a customer). Six answers matched, one differed, so only that question went to the reviewer.</sub></p>

## What makes it different

- **Only the disagreement is judged.** Matching answers settle at once; a neutral person answers only the questions the sides differ on, and must write reasons and declare no conflict of interest first.
- **The rules cannot be changed quietly.** Rule sets are permanent; a change is a new version with a public history, and an agreement stays bound to the exact version it accepted.
- **A formal proof, not a few examples.** The compiled circuit is proved equal to the written rules for every possible set of answers (a decision-diagram check, run in the browser and on the circuit read back from X Layer). A 40-question policy takes about 0.1 seconds. [How it works and its limits](docs/VERIFICATION.md).
- **Anyone can replay it for free.** The result is computed on-chain by the processor and re-checkable by anyone; other contracts can read a decision with `verdict(id)`.
- **No wallet for the customer.** Passkeys, with signed approvals that cannot be altered, replayed or moved.
- **Named reviewers.** A reviewer signs a name and a public page with their wallet, checked in the browser with no server and no contract change.
- **Rules you can trust before publishing.** An offline rule check flags judgement words, missing evidence and rules that can never fire; five ready-made templates (second-hand sale, freelance milestone, rental deposit, bug bounty, warranty) and a contract clause generator help a business start.
- **No server, no escrow, no custody.** Nothing to breach or shut down, and no money to lose.
- **Chinese and English**, with Chinese as the default.

Other entries also compile rules to TapeOut circuits; we do not claim to be first at that. What we have not seen elsewhere is the dispute process built around the rules.

## Business model and revenue

*None of this is validated. We have no customers, no revenue and have not interviewed buyers yet; these are hypotheses to test in a pilot.*

LGtie holds no money and takes no cut of any dispute, so the revenue would come from the tools around the rules, not from the disputes themselves.

| Who pays | For what | How (hypothesis) |
| --- | --- | --- |
| **Businesses with recurring claims or returns** (retail, marketplaces, repair, rental) | Publishing and maintaining their rule sets, an embedded checker on their support page, receipts for payment companies and platforms | Subscription per business or per checker; a small fee per published rule set and per case |
| **Protocols and bug-bounty programmes** | A shared severity rule set and a neutral reviewer panel before anyone pays for arbitration | Per-programme fee; a small fee per decided case |
| **Reviewers** | Earn a fee from the parties for settling disputed facts | Paid directly by the parties; LGtie takes no cut today |
| **Larger businesses** | Hosted notifications, reminders and analytics (the self-hosted bridge exists today) | Paid add-on, outside the no-server core |

**Why it could work:** disputes recur for the same business, so a rule set is written once and used for every claim; the receipt is useful evidence for a payment company or platform; and the network fee on X Layer is tiny. **What has to be true:** a business believes published rules reduce its arguments, and a payer says yes. The first step is a pilot with one real business, then a price test.

## Live on X Layer (chain 196)

| Contract | Address |
| --- | --- |
| TapeOut processor (existing, reused) | `0x9e2849c04a513fe64db07521cbe52d078d905c0e` |
| Warranty rules | circuit #13: 7 questions, 39 logic gates, checked against the written rules on all 128 situations |
| `RuleSetRegistry` | `0x25E87D367316038a2d3B6A4fe3d58AA453D4c219` (rules #1 is "Warranty claims") |
| `AgreementRegistry` | `0xC3e61E38d977Be9e9B4649e5965892bF6f675180` |
| `TiebreakCaseV3` | `0xF6C636e1f08bdE711d1FDdc40eb23DEa7719Ec67` (wallet parties; used by the real case) |
| `PasskeyRegistry` | `0xC3c0E2Fa6D8452A14063c01DC50159487E78522E` |
| `AgreementRegistryV2` | `0x802995325A576b69175DCE24e8D643553C9ba2ed` (the other party can be a passkey account) |
| `TiebreakCaseV4` | `0x178bB4ddC548F3456bD5AE2de7Abe67A8DCb02d0` (wallet or passkey parties; accepts only the official processor) |

The contract names keep the project's earlier name, Tiebreak. There is one real run on mainnet (agreement #1 and case #1), played by the project's builder; there is no real passkey case yet. `node tests/mainnet-verify.mjs` checks circuit #13 against the rules for all 128 situations, read-only.

## Try it (no wallet needed)

| What | Where |
| --- | --- |
| Check a warranty claim and see the result and the reason | https://lgtie.vercel.app/#check/warranty |
| A real case settled on X Layer, and its printable receipt | https://lgtie.vercel.app/#case/1 · https://lgtie.vercel.app/#receipt/1 |
| A fictional support page with the passkey flow embedded | https://lgtie.vercel.app/embed-demo.html |
| Ready-made templates (second-hand sale, freelance, rental deposit, bug bounty, warranty) | https://lgtie.vercel.app/#templates |
| Every published rule set and its version history | https://lgtie.vercel.app/#rules |
| Prove a circuit on X Layer implements its rules | https://lgtie.vercel.app/#verify |
| Everything a business can do | https://lgtie.vercel.app/#for-business |
| The same app in English (it opens in Chinese; use the 中文 / EN button) | https://lgtie.vercel.app/?lang=en |

## Run it yourself

```
cd site && python3 -m http.server 8090        # then open http://localhost:8090
node tests/rules.test.mjs                      # rule engine
node tests/pkcore.test.mjs                     # passkey encoding, checked against Foundry's cast
node tests/reviewer.test.mjs                   # reviewer statements and blind review
node tests/nostr.test.mjs                      # Nostr signatures, against the official test vectors
node tests/verify.test.mjs                     # the formal check: agrees with brute force on 400 random policies and 3,000 corrupted circuits
node scripts/verify-circuit.mjs warranty --circuit 13   # read circuit #13 from X Layer and prove it equals the warranty rules
node tests/lint.test.mjs                       # the rule check
node tests/templates.test.mjs                  # the five templates, in both languages
node tests/reviewerid.test.mjs                 # named reviewers: wallet signatures, profile codes
cd contracts && forge test                     # 119 contract tests (some run on a fork of X Layer and need network access)
node tests/mainnet-verify.mjs                  # read-only check of circuit #13 on X Layer
```

Browser tests are in `tests/browser/`; see its README for what they need. **Deploy:** the site is static. `node scripts/bundle.mjs` rebuilds `dist/` from `site/`; on Vercel keep the Framework Preset as **Other** (`vercel.json` serves `dist/`). A passkey is tied to the site's exact address, so decide the final address before anyone creates real passkeys.

## Project layout

| Path | What is in it |
| --- | --- |
| `site/` | The web app, with no server: rules and compiler, builder, cases, agreements, receipts, reviewers, templates, rule check, formal check, languages, passkeys and inbox, publishing, embed |
| `contracts/` | Foundry project with the contracts above and their tests |
| `bridge/` | The optional self-hosted bridge |
| `dist/` | The built site, a single self-contained page |
| `scripts/` | Deploy, publish and verify scripts. Each has a read-only `preflight` mode |
| `tests/`, `test/` | Rule engine, passkey encoding, mainnet check and browser tests |
| `docs/` | [FEATURES.md](docs/FEATURES.md) (every part in detail), [VERIFICATION.md](docs/VERIFICATION.md), [PASSKEYS.md](docs/PASSKEYS.md), [VERDICT.md](docs/VERDICT.md), [SECURITY.md](docs/SECURITY.md), [USING-WITH-CONTRACTS.md](docs/USING-WITH-CONTRACTS.md), [VALIDATION.md](docs/VALIDATION.md), [SUBMISSION.md](docs/SUBMISSION.md) |

## Honest limits

- **It does not check that answers are true.** The result follows the answers given. A reviewer decides disputed facts, and a reviewer can be wrong.
- **It is not a court, an arbitration or legal advice.** The outcome is an expert-style determination of facts if the parties' contract says so, not an arbitral award. Nobody has reviewed the clause with a lawyer. See [docs/USING-WITH-CONTRACTS.md](docs/USING-WITH-CONTRACTS.md).
- **Everything recorded is public.** Answers, evidence fingerprints, the reviewer's reasons, wallet addresses and times are on a public blockchain and cannot be deleted. Do not use LGtie for confidential matters.
- **A neutral reviewer can still be biased.** There is no staking, jury or penalty. Written reasons make a bad decision visible, they do not prevent it. A named reviewer proves who controls a wallet, not that the person is honest.
- **A case nobody finishes ends as "no decision".** That is safe, but the sides then have to open a new case.
- **The inbox depends on public relays.** They may be slow or drop messages, and nothing notifies the business. The copy-link fallback always works.
- **Passkeys prove a device, not a person.** Recovery after losing every device is not built yet. Tested in Chrome with a virtual authenticator and once on a real phone; Safari and Firefox are untested.
- **A normal smart contract could hold the same decision table.** What TapeOut adds is a rule published as data, with no hidden state or admin key, that anyone can re-run for free.
- **No escrow, on purpose.** Another system can read a decision and pay out; see [docs/VERDICT.md](docs/VERDICT.md).
- **Early prototype.** The contracts are unaudited and hold no funds. There are no customers, no revenue and no validated prices.

## Roadmap

1. **A first pilot with a real business**, to learn what it would pay for and which disputes matter, then a price test.
2. **Publish the templates people use** on mainnet (only the warranty rules are published today), so they can be used in agreements and cases.
3. **Assisted passkey recovery**, with a second device and a reviewer's countersignature.
4. **An independent security review** before any real customer relies on it.
5. **Hosted notifications and reminders** as an add-on to the self-hosted bridge.
6. **A shared reviewer directory** (needs an operator or on-chain attestations).
7. **Pay on a verdict (escrow)**, deliberately not built: it would hold real money and needs an audit first.
8. **A copy hosted on TapeOut's DeWEB**, if the passkey and relay features work there.
