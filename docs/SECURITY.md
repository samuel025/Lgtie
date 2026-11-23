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
