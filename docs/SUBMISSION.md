# LGtie: submission text

Draft for the X Layer TapeOut Accelerate form. Fill the three `TODO` items before sending. Everything else is true as of this commit; re-check the numbers if anything changes.

## One line

LGtie is the dispute layer for published rules: both sides answer the same questions under rules published on X Layer, only the answers they disagree on go to a reviewer they both accepted, and anyone can re-run the result for free.

## The problem

Rules are easy to publish and hard to apply when two people disagree about the facts. A customer says the product was bought from an authorised seller, the business says it wasn't. A researcher says a bug is critical, the protocol says it is low. Today the whole outcome is argued, usually inside one side's own process, and nobody can later show the rule was applied consistently.

## What it costs when disputes go the heavy route (sourced, not ours)

Most disputes turn on one or two facts, yet the usual process treats the whole case as one big argument. The cost of that is visible in public numbers:

- **Card chargebacks:** Mastercard puts the average cost to a merchant at about **$128 per chargeback** (fees plus internal costs), about 45% of chargeback volume is fraud, and global losses are forecast to rise from about $34B (2025) to about $42B (2028).
- **Bug-bounty arbitration:** Immunefi's legally binding arbitration has a **floor of £7,500** (for claims up to £1M) and takes weeks to months. Researchers and projects also use free mediation first.
- **Freelance platforms:** escalation fees are reported as a few hundred dollars per side on one major platform, and 5% or $5 per side on another (third-party comparison, November 2026).

LGtie is not a replacement for any of these. It targets the stage before them: agree the rules in advance, have both sides answer the same questions, and send only the facts they disagree on to a person.

## What LGtie does

1. **Publish the rules.** A business writes its policy as yes or no questions and rules in a guided builder. The page compiles it into a NAND circuit and proves in the browser that the circuit gives the same answer as the rules on every combination of answers. One click tapes it out on the TapeOut processor and registers it, with a fingerprint of the rules text, in a registry.
2. **Agree before there is a dispute (optional).** Two parties accept one published rule set, a neutral reviewer and the time limits. Once accepted it can never be changed or withdrawn.
3. **Settle a case.** Each side answers the same questions before a deadline. Equal answers finish the case at once. Only the questions they answered differently go to the reviewer, and only that reviewer's answers to those questions count. A case nobody finishes in time ends as **no decision**; nobody wins by default.
4. **Anyone can re-run it.** The processor's `eval` is a free read, so anyone can recompute the result. Other contracts can read `verdict(id)` from the case contract. LGtie holds no funds.
5. **Evidence without uploads.** Parties attach a SHA-256 fingerprint of a file and a short note. The files stay with the people. A reviewer can drop a file they were sent into the case page to check it is identical to the recorded one.
6. **Customers without a wallet.** A customer can act with a passkey, the fingerprint or face scan that unlocks their phone. The business invites them with a claim code, they approve the agreement and their answers on their own device, and anyone with a wallet submits the signed approval and pays the fee. The signature covers the exact action, so it cannot be changed, replayed or moved to another case, and the customer's own page proves on-chain that the account is controlled by her passkey. X Layer's native P-256 verifier checks the signature. A business can offer this on its own site with one embed line.
7. **A one-page receipt** for any decided case, printable as a PDF, with a live re-run of the published rules.

## Why TapeOut

A TapeOut circuit is a pure function by construction: no state, no external calls, no admin key. Customers do not have to audit each business's contract; only the shared processor and registry need trust. Publishing a rule set is data, not a deployment, and evaluation is a free `staticcall`, which is what lets another contract consume a verdict. A normal smart contract could hold the same table; what the circuit adds is a published, immutable rule that anyone can re-run for free.

## What is live (X Layer mainnet, chain 196)

- TapeOut processor (reused): `0x9e2849c04a513fe64db07521cbe52d078d905c0e`
- Warranty rule set: circuit #13 (7 inputs, 2 outputs, 39 NAND gates), checked on all 128 answer combinations on mainnet (`node tests/mainnet-verify.mjs`)
- `RuleSetRegistry`: `0x25E87D367316038a2d3B6A4fe3d58AA453D4c219` (rule set #1)
- `AgreementRegistry`: `0xC3e61E38d977Be9e9B4649e5965892bF6f675180`
- `TiebreakCaseV3`: `0xF6C636e1f08bdE711d1FDdc40eb23DEa7719Ec67`
- Passkey system (deployed Nov 23, 2026; no real cases yet): `PasskeyRegistry` `0xC3c0E2Fa6D8452A14063c01DC50159487E78522E`, `AgreementRegistryV2` `0x802995325A576b69175DCE24e8D643553C9ba2ed`, `TiebreakCaseV4` `0x178bB4ddC548F3456bD5AE2de7Abe67A8DCb02d0` (trusts only the official TapeOut processor)
- One real run, played by the team with three wallets it controls: agreement #1 and case #1, decided "Covered" with one question settled by the reviewer. It is a demonstration, not a customer. The home page reads it live.

## Try it

- Live site: `TODO: public URL`
- Demo video: `TODO: link`
- Source: https://github.com/samuel025/Lgtie
- No wallet is needed to check a claim, watch the circuit, or read the real case and its receipt. Publishing and answering as a party need a wallet and cost a few millionths of an OKB in gas, plus the circuit fee for publishing.

## What we tested and fixed

119 contract tests plus browser end-to-end tests (checker, builder, embed, publish, the whole case flow, receipt, the passkey story including a cross-site frame, and the same passkey story against the deployed contracts on a fork of mainnet). While building, we found a flaw in our own earlier case contract (the opener could answer for both sides). We fixed it in `TiebreakCaseV3`, disclosed it in the README, and the site no longer uses the flawed contract. A later manual review of the deployed V3 contracts (`docs/SECURITY.md`) found six more limitations, none of which can lose funds; each is pinned by a test and listed with what a next version would change.

## Honest limits

- It does not check that answers are true. The result follows the answers given; a reviewer decides disputed facts and can be wrong. The circuit shows the rules were applied consistently, nothing more.
- A reviewer both sides accepted can still be biased, and two parties can agree on the same false answer. There is no staking, jury or slashing.
- The contracts are unaudited and hold no funds. The passkey system is new: recovery after losing every device is not built, and it is untested on real phones and in Safari and Firefox (it was tested in Chrome with a virtual authenticator, including inside a cross-site frame). There are no customers, no revenue and no validated price.
- Only one rule set is published on mainnet so far.
- Other entries also compile rules to TapeOut circuits. We do not claim to be first at that. What we built that we have not seen elsewhere is the dispute process around the rules.

## Who would use it, and who might pay (hypotheses, not facts)

- **Businesses with recurring claim or return disputes** that want a clear, replayable rule and a record they can show afterwards. A possible price is a per-seat or per-checker fee for tooling, which we have not tested.
- **Protocols and security researchers** disputing bug severity, using a mediator both accept before anyone pays for arbitration. A possible price is a small fee for a reviewer's work or a permanent receipt.
- **Reviewers** who earn a fee from the parties for settling disputed facts. LGtie takes no cut today and holds no funds.
- We have not interviewed buyers yet. `docs/VALIDATION.md` has the questions we plan to ask. Until someone says they would use or pay for it, treat all of this as a guess.

## How it maps to the judging criteria

- **User value and commercial potential:** a concrete dispute workflow, with the payer still unproven.
- **Innovation:** the two-sided process (agreement, consent to the reviewer, only-the-differences review, deadlines, no-decision outcome, evidence fingerprints).
- **Ecosystem use:** the TapeOut processor, a registry of rule sets, mainnet deployments, a verdict other contracts can read.
- **Product completeness and UX:** a guided builder, agreements, cases, evidence, receipts, an embeddable checker, tests, and a real mainnet run.

## Team

`TODO: names and roles`
