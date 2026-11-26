# Security review of the deployed contracts

Scope: `RuleSetRegistry`, `AgreementRegistry` and `TiebreakCaseV3` as deployed on X Layer mainnet (addresses in the README). A manual read of the source plus tests that pin down each finding (`contracts/test/TiebreakV3Review.t.sol`). This is **not** an audit by an independent firm. The contracts are unaudited, hold no funds, and are immutable, so a fix needs a new version and new addresses.

## What was checked and held up

- **No funds at risk.** None of the three contracts receives, holds or sends value.
- **No reentrancy.** The only external call is `eval` on the rule set's processor, declared `view`, so it is a static call that cannot change state.
- **One side cannot act for the other.** A helper named by one side acts only for that side, only a side itself can name its helper, and the reviewer cannot be a helper (tested, and it was the bug found in V2).
- **Only disputed answers come from the reviewer.** Bits outside the disputed set are ignored.
- **Deadlines are enforced** on answering, evidence and review, and a case nobody finishes ends as "no decision" rather than deciding by default.
- **Accepted agreements cannot change.** Only the counterparty can accept, only before acceptance, and cancel works only before acceptance.
- **Arithmetic and bounds.** Solidity 0.8 checked math, question counts 1..64, result bits 1..8, windows 1 hour..90 days, note length and evidence count capped.

## Findings

None can lose funds. Severity is about integrity of the process, not money.

| # | Finding | Severity | Pinned by test |
|---|---|---|---|
| F1 | **A side can replace the reviewer even under an agreement.** The agreement fixes the reviewer, but `proposeReviewer` is not blocked for cases opened from an agreement. Proposing a new reviewer resets the other side's approval, so nobody can review until they accept. The losing side can stall the case until it ends as "no decision". The site does not offer this button for agreement cases, but a direct contract call works. This contradicts the claim that neither side can swap the reviewer. | Medium | `test_F1_...` |
| F2 | **A reviewer never consents.** Both sides name a reviewer; the reviewer need not do anything on-chain. A reviewer can therefore be named in agreements or cases they know nothing about, and a case that expires shows them as not deciding in time. The reviewer record could be used to smear a name. | Medium | `test_F2_...` |
| F3 | **Evidence slots are shared.** A case holds 40 evidence entries in total. One side can use them all and block the other side from attaching anything. | Low to medium | `test_F3_...` |
| F4 | **Any address can be a "processor".** The registry checks only that the circuit shape matches. A rule set whose processor is not the real TapeOut processor could return anything, or revert so a case can never finish (the last answer reverts). | Low on the site, higher for direct users | `test_F4_...` |
| F5 | **Opening needs no consent.** Anyone can name any address as the decider, or propose any reviewer. This allows spam and unwanted cases. | Low | `test_F5_...` |
| F6 | **A non-final verdict reads as result 0.** A contract reading `verdict(id)` must check `isFinal` first, or it may treat an unfinished case as result 0. | Informational | `test_F6_...` |

## What the site does about it today

- The site only displays rule sets it knows (the built-in templates published on the official processor), so a rule set pointing at another processor shows as "not known" instead of as a checker. Custom checkers must match the registry hash **and** the official processor address.
- The reviewer record no longer says a reviewer "missed the deadline". It says "no decision in time", and it says that a reviewer's own consent is not recorded.
- The agreement and case pages do not offer a reviewer swap for agreement cases.
- `docs/VERDICT.md` tells consuming contracts to check `isFinal`.

## What a next version would change (not deployed)

1. F1: reject `proposeReviewer` when the case has an agreement.
2. F2: require the reviewer to acknowledge an agreement or a case before it can count against them, or record the acknowledgement on-chain.
3. F3: cap evidence per address, not per case.
4. F4: have the registry check a processor allowlist, or the processor's code hash.
5. F5: let the named decider reject or ignore a case that was opened without an agreement.

## What this review did not cover

- The TapeOut processor and its circuits (not our code).
- Economic or game-theory attacks beyond the cases above.
- Front-end issues other than those listed.
- Formal verification or fuzzing beyond the existing fuzz test.

## Reporting

This is a prototype. If you find a problem, open an issue on the repository.

## Update: the V4 contracts (deployed Nov 23, 2026)

`TiebreakCaseV4`, `AgreementRegistryV2` and `PasskeyRegistry` are deployed on mainnet (addresses in the README). They address the limitations above for **new** cases; V3 cases already on-chain keep them.

| Finding | In V4 |
| --- | --- |
| F1 reviewer swap under an agreement | Fixed: `proposeReviewer` is refused when the case has an agreement. Tested. |
| F2 reviewer never consents | Addressed in the data: `reviewerAcked` records whether the reviewer ever took part. The reviewer record can use it. A reviewer is still named without their prior consent. |
| F3 shared evidence slots | Fixed: evidence is capped per role (filer 15, decider 15, reviewer 6). Tested. |
| F4 any processor | Fixed: only rule sets on the trusted processor (set at deployment) can be used. Tested. |
| F5 no consent to be named | Unchanged. |
| F6 non-final verdict reads as result 0 | Unchanged. Consumers must check `isFinal`. |

**New surface added by passkeys, and what was checked** (`contracts/test/PasskeyV4.t.sol`, `WebAuthn.t.sol`, `tests/browser/passkeys.mjs`):
- Signatures are not unique, so replay protection is a per-account nonce consumed on success, with a deadline. Tested: replay, wrong nonce, expired, altered action, another case, another contract, and that a failed call leaves the nonce untouched.
- A signature meant for one contract cannot be spent through another, and a stranger cannot burn someone's nonce, because the calling contract's address is inside the signed challenge.
- Someone else's passkey, a wrong key index, an unknown account, an assertion for another site (relying-party hash) and a missing user-verification flag are refused.
- **Fake account under a customer's identifier.** Anyone can register an account with any key, so a business could register one under a customer's handle with its own key. The contract cannot prevent that. The customer's page calls `isControlledBy` and warns her if her passkey does not control the account. Tested in the browser.
- The relay page only sends to the three LGtie passkey contracts on the right chain, and shows whether the call would succeed.
- Signature deadlines are taken from the chain's latest block, not the browser clock.

**Not covered, and open:** this is my own review, not an independent audit. Passkey recovery after losing every device is not built. One real-phone run by the builder worked; Safari and Firefox are untested. The page can only show a person what it displays, since WebAuthn cannot show the signed hash, so a compromised page could show one thing and sign another. The business creates the customer's account and can stall by not submitting a signed action (the signed action can be submitted by anyone, so the customer can ask another wallet holder).

## Versions of published rules

A published rule set is permanent. A business that changes its rules publishes a new rule set that names the old one (`previousId`); the registry only accepts this from the address that published the old one, so a stranger cannot extend or hijack someone else's chain. An agreement stores one rule set number and keeps it for good, and a case under it is decided by that version's circuit, so a newer version never rewrites an existing agreement. The history page (`#rules/<number>`) shows the chain read from the registry. Limits: the registry stores a fingerprint, not the rules text, so the page can show the text only for rule sets it knows; effective dates, deprecation and migration declarations are not recorded; the page reads the latest 300 rule sets and the latest 200 agreements and cases when counting use.

## Which evidence the reviewer examined

A reviewer's written statement (fingerprinted on-chain as the reviewer's own evidence entry) lists every evidence entry recorded on the case when it was written, in on-chain order, with a digest: SHA-256 of the lines `number|submitter|passkey account|question|time|fingerprint|note`. Anyone holding the statement can recompute the digest from the case's evidence list on X Layer. The case page does this when the statement is dropped on it, and reports: the entries match; how many entries were added after the statement (not examined); or that the statement leaves out entries that were recorded before it, or lists a digest that is not the chain's.

This makes it visible which evidence existed before a decision, and that evidence added or changed afterwards was not examined. It does not show that the reviewer read the evidence, that the evidence is genuine, or anything about files (only fingerprints are recorded). It needs no contract change. A reviewer who races an addition between reading the list and recording the statement can show one "left out" entry; the page words this as a fact, not an accusation. Statements written before this feature have no evidence section and are shown as such.

## Checking the compiler

The circuit that runs on X Layer is produced by LGtie's rule compiler. A bug there would silently change what the rules mean, so the circuit is checked against the rules by a separate, formal method (`site/verify.js`, described in [VERIFICATION.md](VERIFICATION.md)): a symbolic proof, for every possible set of answers, that the two agree, runnable on any published circuit by anyone. It proves the circuit implements the rules as written; it does not prove the rules are fair, the answers true, or the contracts safe.

## What is public

Everything LGtie records is on a public blockchain and cannot be deleted: answers, fingerprints of evidence, the reviewer's written reasons and one-line reason, wallet addresses, times and results. Files are never uploaded and reasons must not name people, but the case and its outcome are visible to anyone. Do not use LGtie for matters that must stay confidential. See `docs/USING-WITH-CONTRACTS.md` for the legal questions this raises.

## Named reviewers

A reviewer used to be shown only as a wallet address, so neither side could tell who they were agreeing to. A reviewer can now attach an identity, with no contract change and no server.

How it works: the reviewer signs a short statement with their wallet (`personal_sign`: name, role, the address of a public page they control). The page recovers the signer in the browser and shows the name only if the signature matches the address. The reviewer puts the same signed code on their public page, and the page can fetch it to confirm that the page and the wallet share an owner (where a site does not allow the browser to read it, the page says so and links to it). The code is also posted to public relays under its own tag so both sides can see it. An agreement form can add the identity to the written terms, so it is part of what both sides fingerprint.

A profile can also state what the reviewer can judge (a specialty) and what they charge (a fee). Both are signed with the rest, so they cannot be changed afterwards, but they are the reviewer's own claims: the signature proves they said it, not that it is true. LGtie holds no money, so any fee is agreed and paid directly between the parties and the reviewer.

What it proves: that the person who controls the wallet also controls the public page, and that the name was signed by that wallet. What it does not prove: that the person is honest, qualified or free of conflicts. The written reasons and conflict declaration still do that work.

Limits: a relay can drop a profile (it cannot change one, because any change breaks the signature), so a profile may take a moment to appear or may need republishing. A profile code kept on one device is found on that device first. A person can sign a new profile later; the newest valid one found is shown, and an agreement's terms keep the fingerprint of the one that was signed when it was made. The reviewer's address is still fixed on-chain by the agreement; the identity is not on-chain.

## Billing (LGtieBilling and TiebreakCaseV5)

Deployed on X Layer mainnet (LGtieBilling `0x03a36B3183b2Be2dCe7F821db674DeD9B6C003De`, TiebreakCaseV5 `0x1c261952b583fc6DA59e1525Ff52c15b39eD146a`), tested, unaudited. After deployment the settings were read back from the chain: token, treasury, owner, the linked case contract, the caps and plans, and both contracts hold 0 OKB. The owner is the deployer's wallet, so that key can change prices (within the caps) and the treasury.

- **No custody.** Payments go from the payer to the treasury in the same transaction (`transferFrom(payer, treasury, amount)`). The billing and case contracts never hold tokens or OKB; a test checks this after every kind of payment.
- **Who can charge.** Only the case contract, set once by the owner, can call `charge`, and it can only take the per-case fee from the account that is already submitting the opening transaction. It cannot pull from anyone else, so an allowance given to the billing contract can be used for nothing but that wallet's own case fee or subscription.
- **A business cannot block a customer.** Without a subscription the opener pays the fee. If the opener cannot pay, the opening reverts and nothing is recorded, but the customer is never made to depend on the business paying.
- **Price caps.** The owner can change prices only within hard caps in the code: 10 USDT per case, 500 per month, 5,000 per year, 10,000 cases per month. The per-case fee can be set to zero. The treasury can be changed by the owner; ownership transfer is two-step.
- **Approvals.** The site asks for an approval of exactly the amount due, not an unlimited one, so one case costs two wallet confirmations (allow, then open) unless a subscription covers it.
- **Token.** Any 6-decimal token that returns `true` or nothing from `transferFrom` works. The deploy script checks the decimals on-chain. A token that can freeze or blacklist the payer or treasury (USDT-style) can stop a payment; a failed payment reverts the whole opening.
- **Limits.** A subscription does not renew by itself. Switching to a higher plan starts now and does not refund the rest of the old one. A lower plan is refused until the current one ends. Only the V5 case contract is billed: cases opened on V3 are free. Fees and subscriptions are public on-chain, including who opened which case.
