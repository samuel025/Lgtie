# LGtie

**Settle disputes fairly, with rules everyone can see first.**

**Live:** https://lgtie.vercel.app/ · [Try the fictional support page](https://lgtie.vercel.app/embed-demo.html) · [See a real case on X Layer](https://lgtie.vercel.app/#case/1)

LGtie is a prototype for the **X Layer TapeOut Accelerate** hackathon. It is early software: the contracts are unaudited and it has no customers yet.

## The problem

When a claim or a report is disputed (a warranty repair, a refund, a bug's severity), the rules usually live inside one side's own process. Both sides argue about the whole outcome, nobody can show afterwards that the rules were applied the same way every time, and the person who decides is often one of the parties.

## What LGtie does

1. A business **publishes its rules in advance** as simple yes or no questions. Once published they cannot be changed quietly.
2. Both sides **agree up front** on those rules, on a neutral person who would decide any disagreement, and on the time limits.
3. If a dispute comes, **both sides answer the same questions**. Where the answers match, it is settled.
4. **Only the questions they disagree on** go to the neutral person. Nothing else.
5. The published rules turn the final answers into a **result and a reason**, and **anyone can re-run it for free** and get the same result.

A customer does not need a crypto wallet: they can approve with the fingerprint or face scan that unlocks their phone.

LGtie never holds anyone's money. It records decisions and checks that rules were applied consistently. It cannot tell whether someone is telling the truth; a neutral person settles the facts the two sides disagree on.

## Try it (no wallet needed)

| What | Where |
| --- | --- |
| Check a warranty claim and see the result and the reason | https://lgtie.vercel.app/#check/warranty |
| Read a real case that was settled on X Layer (played by the team, so a demonstration, not a customer) | https://lgtie.vercel.app/#case/1 |
| Its one-page receipt, which you can print or save as a PDF | https://lgtie.vercel.app/#receipt/1 |
| A fictional support page with the fingerprint (passkey) flow embedded | https://lgtie.vercel.app/embed-demo.html |
| How it works, as a short animated story | https://lgtie.vercel.app/#about |
| Everything a business can do, including its inbox for customers' signed actions and the passkey cases | https://lgtie.vercel.app/#for-business |

## Screenshots

Taken from the live site, except the four marked "test environment", which come from the automated end-to-end test (a fork of X Layer, test wallets and a virtual passkey, so they show how the pages behave, not real customers).

**Check a claim, build the rules**

<p><img src="docs/img/home.png" alt="LGtie home page with the live rule circuit" width="100%"></p>
<p><sub>The home page runs the real published warranty circuit: tap an answer and the result and reason change.</sub></p>

<table><tr>
<td width="50%"><img src="docs/img/checker.png" alt="Claim checker with a result"><br><sub>The claim checker. The result is confirmed on X Layer.</sub></td>
<td width="50%"><img src="docs/img/builder.png" alt="Rule builder"><br><sub>The guided builder: questions, a click-to-cycle rule grid, a test, then publish.</sub></td>
</tr></table>

**A real case on X Layer** (played by the team, so a demonstration, not a customer)

<table><tr>
<td width="50%"><img src="docs/img/case.png" alt="Decided case page"><br><sub>Six answers matched. One differed, so only that question went to the reviewer.</sub></td>
<td width="50%"><img src="docs/img/receipt.png" alt="Printable receipt"><br><sub>The one-page receipt, which you can print or save as a PDF.</sub></td>
</tr></table>

**No wallet for the customer** (test environment)

<table><tr>
<td width="50%"><img src="docs/img/customer-evidence.png" alt="Customer adding evidence with a passkey"><br><sub>A customer adds evidence on their own device and signs it with their fingerprint. Nothing is uploaded.</sub></td>
<td width="50%"><img src="docs/img/inbox.png" alt="Business inbox with a waiting action"><br><sub>The business's inbox: the customer's signed action is waiting, and one click submits it.</sub></td>
</tr></table>

**The reviewer** (test environment)

<table><tr>
<td width="50%"><img src="docs/img/reviewer-form.png" alt="Reviewer decision form with required reasons"><br><sub>A reviewer must give written reasons and a no-conflict declaration before deciding.</sub></td>
<td width="50%"><img src="docs/img/case-decided.png" alt="Decided case showing the reviewer's reason"><br><sub>The decided case shows the reviewer's reason. Sides are labelled A and B while the reviewer decides.</sub></td>
</tr></table>

**For businesses, and on a phone**

<table><tr>
<td width="60%"><img src="docs/img/business.png" alt="For businesses page"><br><sub>Everything a business can do, in one place.</sub></td>
<td width="40%"><img src="docs/img/phone-case.png" alt="Case page on a phone"><br><sub>The pages are laid out for phones.</sub></td>
</tr></table>

<p><img src="docs/img/about.png" alt="How it works, as an animated story" width="100%"></p>
<p><sub>"How it works" tells the story in six animated steps.</sub></p>

## How it works

```
  1. The business publishes its rules          (yes/no questions, stored on X Layer)
                    |
                    v
  2. Both sides agree in advance on            the rules, a neutral person, the time limits
                    |
                    v
  3. Both sides answer the same questions ---- answers match --->  settled, no argument
                    |
              answers differ
                    v
  4. The neutral person answers ONLY the questions they differ on
                    |
                    v
  5. The published rules give the result and the reason
                    |
                    v
     Anyone can re-run it, for free, and get the same result
```

- **Rules.** A business writes questions and rules in a guided builder. The page turns them into a small logic circuit and proves, in the browser, that the circuit gives the same answer as the rules in **every possible situation**.
- **Publishing.** One click records the circuit on the TapeOut processor and registers it, with a fingerprint of the rules text, in a public registry. An entry never changes; a new version is a new entry.
- **Agreements (optional).** Two parties accept one published rule set, a neutral reviewer and the time limits. After that none of it can be changed or withdrawn.
- **Cases.** Each side answers before a deadline. Equal answers finish the case at once. Different answers go to the reviewer both sides accepted, who answers only the disputed questions. A case nobody finishes in time ends as **no decision**; nobody wins by default.
- **Result and replay.** The processor computes the result. Anyone can recompute it, and other contracts can read the decision with `verdict(id)` (see `docs/VERDICT.md`).
- **Reviewer accountability.** A reviewer has to write reasons and tick a conflict-of-interest declaration before deciding. The page saves the written statement as a file for the reviewer to send to both sides and records only its fingerprint on X Layer, with a one-line public reason that shows on the case page and receipt. While the reviewer decides, the page shows "Side A" and "Side B" instead of addresses (addresses are still public on-chain, so this reduces bias but is not true blind review).
- **Evidence.** Files are never uploaded. A party (including a customer with a passkey, who signs it) records a digital fingerprint of a file, or of a written explanation they download, plus a short note. A reviewer can drop the file they were sent into the case page, and the browser says whether it is identical to the recorded one. A fingerprint shows a file is unchanged, not that it is genuine.
- **Receipts.** Any decided case has a one-page receipt (`#receipt/<case id>`) with who answered what, who settled each question, and a live re-check of the rules.

### Customers without a wallet (passkeys)

A customer creates a **passkey** (the same thing that unlocks their phone) and gets a public claim code. The business registers it and proposes an agreement. The customer approves the agreement and their answers on their own device. Each approval covers the exact action, the case, a one-time number and a deadline, so it cannot be altered, replayed or moved. Anyone with a wallet, usually the business, submits it and pays the tiny network fee. X Layer verifies the passkey signature with its built-in P-256 check. The customer's own page first proves on-chain that the account is controlled by their passkey. Details and tests are in `docs/PASSKEYS.md`.

**The inbox.** A passkey can sign but cannot pay network fees, so someone with a wallet has to submit what the customer signed. After signing, the customer's page posts the signed action to a few public message relays (Nostr), addressed to the business's wallet address. The business opens `#inbox`, sees what is waiting, and submits it with one click. A relay cannot change a signed action (the contract rejects any change) and learns nothing that is not already public on-chain; it can drop a message, so a copy-link fallback is always shown. The business has to open the inbox; there are no notifications because there is no server. The same page lists cases waiting for the signed-in wallet's decision when that wallet is the neutral reviewer (found by reading the chain, not through the relays), and the agreement and case pages give the business a ready-made message to send the reviewer, with a link that opens the decision form directly. A reviewer still needs a wallet and pays the fee, and nothing reminds them.

### Writing rules

```
name: Warranty claims
about: One line shown to the person answering
question: Is it still within the warranty period? | Evidence to ask for (optional)
result: Not covered           (results are numbered in the order written)
result: Covered
rule: Q2=no -> Not covered : The reason shown        (top to bottom; the first rule that matches decides)
rule: Q1=yes & Q3=no -> Not covered : Join conditions with &
default: Covered : Shown when no rule matched
```

Two examples are built in: `warranty` (published) and `bounty` (bug-bounty severity, not yet published).

### Put it on your own website

```html
<div></div><script src="https://lgtie.vercel.app/embed.js" data-checker="warranty" async></script>
```

Add `data-flow="join"` to let customers create a passkey on your page (your page receives the claim code through `data-onclaim="yourFunction"`), or `data-flow="mine"` to show a customer their own cases. The embed only adds a frame and relays two checked messages. `site/embed-demo.html` is a complete example.

## What is live on X Layer (chain 196)

| Contract | Address |
| --- | --- |
| TapeOut processor (existing, reused) | `0x9e2849c04a513fe64db07521cbe52d078d905c0e` |
| Warranty rules | circuit #13: 7 questions, 39 logic gates, checked against the written rules on all 128 situations |
| `RuleSetRegistry` | `0x25E87D367316038a2d3B6A4fe3d58AA453D4c219` (rules #1 is "Warranty claims") |
| `AgreementRegistry` | `0xC3e61E38d977Be9e9B4649e5965892bF6f675180` |
| `TiebreakCaseV3` | `0xF6C636e1f08bdE711d1FDdc40eb23DEa7719Ec67` (wallet parties; used by the real case above) |
| `PasskeyRegistry` | `0xC3c0E2Fa6D8452A14063c01DC50159487E78522E` |
| `AgreementRegistryV2` | `0x802995325A576b69175DCE24e8D643553C9ba2ed` (the other party can be a passkey account) |
| `TiebreakCaseV4` | `0x178bB4ddC548F3456bD5AE2de7Abe67A8DCb02d0` (wallet or passkey parties; accepts only the official processor) |

The contract names keep the project's earlier name, Tiebreak. There is one real run on mainnet (agreement #1 and case #1), played by the team; there is no real passkey case yet. `node tests/mainnet-verify.mjs` checks circuit #13 against the rules for all 128 situations, read-only.

## Run it yourself

```
cd site && python3 -m http.server 8090        # then open http://localhost:8090
node tests/rules.test.mjs                      # rule engine
node tests/pkcore.test.mjs                     # passkey encoding, checked against Foundry's cast
cd contracts && forge test                     # 119 contract tests (some run on a fork of X Layer and need network access)
node tests/mainnet-verify.mjs                  # read-only check of circuit #13 on X Layer
```

Browser tests (checker, builder, embed, receipt, publishing, the full case flow, the passkey story including a cross-site frame, and a read-only smoke test of the live site) are in `tests/browser/`; see its README for what they need.

**Deploy.** The site is static: one page plus `embed.js` and `embed-demo.html`, in `dist/`. `node scripts/bundle.mjs` rebuilds it from `site/`. On Vercel, import the repository and keep the Framework Preset as **Other**; `vercel.json` already serves `dist/` with no build step. A passkey is tied to the site's exact address, so decide the final address before anyone creates real passkeys.

## Project layout

| Path | What is in it |
| --- | --- |
| `site/` | The web app, with no server: rule engine and compiler (`rules.js`), guided rule builder (`builder.js`), case, agreement, receipt and reviewer pages (`cases.js`, `reviewer.js`), passkey pages and inbox (`passkeys.js`, `nostr.js`, `pkcore.js`), one-click publishing (`publish.js`, `wallet.js`), animated graphics (`graphics.js`, `hero.js`), embed script (`embed.js`), addresses (`config.js`) |
| `contracts/` | Foundry project with the contracts above and their tests |
| `dist/` | The built site, a single self-contained page (about 300 KB including the embedded Inter typeface; no external assets) |
| `scripts/` | Deploy and publish scripts (`deploy-v3.sh`, `deploy-v4.sh`, `publish-rules.sh`, ...). Each has a read-only `preflight` mode and you run the spending steps with your own Foundry keystore |
| `tests/`, `test/` | Rule engine, passkey encoding, mainnet check and browser tests |
| `docs/` | `PASSKEYS.md` (passkey design and test log), `VERDICT.md` (reading a decision from another contract), `SECURITY.md` (a manual security review) |

## Honest limits

- **It does not check that answers are true.** The result follows the answers given. A reviewer decides disputed facts, and a reviewer can be wrong. LGtie shows the rules were applied consistently, nothing more.
- **A neutral reviewer can still be biased.** Both sides accept the reviewer, but nothing stops them agreeing on a bad one, or on the same false answers. There is no staking, jury or penalty. Written reasons make a bad decision visible, they do not prevent it.
- **A case nobody finishes ends as "no decision".** That is safe, but the sides then have to open a new case.
- **The inbox depends on public relays, and actions go in order.** They are run by other people, may be slow or drop messages, and nothing tells the business to look; messages older than three days are not shown. The customer's page says when relays could not be reached, and the copy-link fallback still works.
- **Passkeys prove a device, not a person.** The business ties a passkey to a customer through its own login. If someone loses every device with their passkey, recovery is not built yet (a second device or a synced passkey is the fallback). The passkey flows are tested in Chrome and have not been tried on real phones, Safari or Firefox.
- **A normal smart contract could hold the same decision table.** What TapeOut adds is a rule published as data, so it cannot hold hidden state or an admin key, and anyone can re-run it for free.
- **No escrow, on purpose.** Another system can read a decision and pay out; see `docs/VERDICT.md`.
- **Early prototype.** The contracts are unaudited and hold no funds. There are no customers, no revenue and no validated prices; any pricing ideas are hypotheses. Not built yet: assisted passkey recovery, and more than one published rule set.
