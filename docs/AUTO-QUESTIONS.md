# Automatic questions: design (not built)

Status: a design to review. No contract or site code changes yet.

## The idea in one paragraph

Today every question in a rule set is answered by the two parties, and any question they answer differently goes to the reviewer. Some questions
do not need anyone's word: "was the work delivered before the deadline?" can be read from timestamps the chain already holds. An **automatic
question** is one whose answer the contract works out itself. Neither side can answer it, neither side can dispute it, and the reviewer cannot
change it. Fewer disputed questions means fewer cases reach a reviewer, which is cheaper and faster for everyone, and LGtie takes no cut of
that: the saving goes to the users.

## What is and is not worth automating

| Kind of question | Automatic? | Why |
|---|---|---|
| Was evidence for a question attached on time? | **Yes** (type A) | The case contract already stores a timestamp for every piece of evidence. No outside data. |
| Was the case opened / answered within N days of an event? | **Yes** (type A) | Block timestamps. |
| Does an on-chain value meet a threshold (a balance, a token transfer, an oracle price)? | **Yes, with care** (type B) | A read of a contract both sides can see. The trust moves from the reviewer to that contract. |
| Is what the evidence says true? | **No** | A hash anchored before the dispute proves the file *existed* then. It cannot prove the file is honest. This stays a human question. |
| Did the product really fail? | **No** | Judgment. This is what the reviewer is for. |

The honest line for the product page: automatic questions remove disputes about *time and on-chain facts*. They do not remove disputes about
*truth*.

## What a contract can and cannot read (limits found in review)

A second review suggested checks such as "did a contract emit this event", "was this amount transferred" and "did this wallet hold X at an agreed
block". A contract on X Layer can only read **current state** and block data. It cannot read past logs, and it cannot read a balance at an old
block. So these are handled differently:

| Suggested check | On-chain today? | How |
|---|---|---|
| Was the evidence commitment submitted before the cutoff? | Yes | Type A: our own evidence timestamps. |
| Is the balance / state at least X **now** (at case open or at answer time)? | Yes | Type B read, with the moment recorded in the case. |
| Was a transaction completed, an event emitted, an amount transferred, or a balance held **at a past block**? | **No**, not by reading | Needs a proof submitted by a party and verified on chain (a receipt or storage proof), or the target contract must record it itself. Later phase, and only after a reference implementation shows it is deterministic. |
| GitHub commit time, an API timestamp | **No** | Not trustworthy: a party controls or can race the source. Only a commitment anchored on chain counts. |

Every automatic question must also pin, **before both sides sign**: the source (contract and function, or the evidence slot), the exact moment it
is read (a deadline, or "at case open"), the comparison, and the rule for what counts as a pass. The case records the block number and timestamp
actually used, so nobody can later argue about which block or source was meant.

## The two types

**Type A, from the case itself (no oracle).** A question is bound to "evidence attached for question *q* by role *r* no later than *openedAt +
N seconds*", or to "the case was opened before a fixed date". The answer is yes or no, computed from stored timestamps. Nothing outside the chain
is trusted.

**Type B, from an on-chain read.** A question is bound to one `staticcall` on a pinned contract with pinned calldata, and a comparison
(`>= threshold`, `== value`) on the first returned word. The contract, calldata and threshold are written in the spec, so the business publishes
them and the customer sees them before agreeing. Limits: static call only (it cannot change state), a fixed gas cap, a return of at least 32 bytes.

If a type B call reverts or returns too little, the question **falls back to a normal human question** for that case, so a broken source cannot
freeze a case. (A source its own owner can make revert at will is a weakness: the guidance is to pin only sources neither party controls, and the
page shows a warning when a pinned contract is owned by the proposer.)

## How it plugs into the existing flow

The answers are already a bitmask and the disputed questions are `filerAnswers ^ deciderAnswers`. An automatic question is one more bit that the
contract fills in. In `_record` and `review`:

```
autoBits, autoMask  = facts.compute(caseId)          // only the questions marked automatic
answers             = (partyAnswers & ~autoMask) | autoBits
disputed            = (filerAnswers ^ deciderAnswers) & ~autoMask
reviewed            = (partyAnswers & ~disputed) | (reviewerAnswers & disputed)   // unchanged; auto bits are never in `disputed`
```

The circuit, the processor, the rule syntax and the receipts do not change. The grid and the rules page show an automatic question as
"Answered by the chain" with its source, and the questionnaire hides the Yes/No buttons for it.

## Where the spec lives, and the one rule that keeps it fair

A new `FactSpecRegistry` stores, per rule set, which questions are automatic and their source (type, parameters). It can be written **once** per
rule set, only by that rule set's `publisher` (already recorded in `RuleSetRegistry`).

The risk is a publisher adding an automatic question *after* a customer agreed. So the rule is:

> A spec applies to a case only if it was written **before the agreement was accepted** (or, for a case opened without an agreement, before the
> case was opened).

The case contract checks `spec.setAt <= agreement.acceptedAt`. A spec written later is ignored for that case. Published rules stay as fixed as
they are today.

Deadlines that differ per agreement (a delivery date) are the second phase, below.

## Phase 0: a reference implementation before any Solidity

Before V6, write the checks as plain code (a small Node module the site and tests both use), with one test file per question kind and a table of
cases: on time, late, exactly on the deadline, source reverts, evidence attached by the wrong side. Check that the same inputs always give the
same answer, and list the minimum contract changes the tests force. The Solidity then has to match this module, case by case. Nothing is
deployed in this phase and nothing changes for users.

## Build in two phases

**Phase 1: type A, fixed in the rule set.** Relative deadlines only ("within 14 days of opening"). No change to `AgreementRegistryV2`.
Needs: `FactSpecRegistry`, `TiebreakCaseV6` (V5 plus the lines above), site support in the builder, grid and questionnaire, and tests.

**Phase 2: per-agreement values and type B.** An agreement needs to commit to its own parameters (a deadline, a threshold). That means
`AgreementRegistryV3`, which adds a `factsHash` into the digest the passkey owner signs. Then type B.

## What a V6 costs, said plainly

- `TiebreakCaseV5` cannot take a new answer path, so this is a new case contract, `TiebreakCaseV6`.
- `LGtieBilling.setCases` can be called once, and it is already used. A V6 therefore needs a **new `LGtieBilling`**. Existing subscribers would
  have to subscribe again (or we give them the remaining time by hand). Plan for it.
- Older V5 cases stay readable, as V4 ones are today (a legacy reader and links).
- Re-run the full test suite against V6, including the V4/V5 suites with automatic questions off, and add: a spec written after acceptance is
  ignored; an automatic question cannot be answered, disputed or overridden by a reviewer; a reverting type B source falls back to a human
  question; gas stays bounded.
- New contracts are unaudited, as the existing ones are. Say so in `docs/SECURITY.md`.

## Positioning

With this, LGtie is a **verifiable agreement layer**: both sides agree beforehand on the rules and on the sources, LGtie checks what a chain can
check, and a human reviewer handles only what is left. It reduces the need for human judgment without pretending to remove it.

## Open questions for you

1. Do Phase 0 now and ship the contract change together with the other V6 changes (one billing migration instead of two). I recommend this.
2. Do you want type B at all before there is a real user asking for it? I would start with type A, which needs no outside data.
3. Fallback on a failing type B source (human question) versus failing the case. I recommend the fallback.

## Phase 0 result

`site/autoq.js` (pure functions, not loaded by the site yet) and `tests/autoq.test.mjs` (37 cases) are written and pass: `node tests/autoq.test.mjs`.
Contract changes the tests force, beyond what is listed above:

- The case must **record the evidence timestamps and, for type B, the value read and the block** when the case opens, because `compute` needs them
  later and a source can change.
- `evidenceBy` has to count only evidence by the named role for the named question (the V5 `Evidence` struct already has `by`/`passkey`, `question`
  and `at`; the role is derivable, but a loop over up to 15 items per side must stay inside the gas cap).
- "Exactly on the limit" counts as on time (`<=`), the same convention as the existing deadlines.
- A spec list needs a hard cap on its length (suggest 8) so the check cannot become expensive.
- With no specs the behaviour must be identical to V5 (tested here as "exactly the old behaviour"; repeat it against the real contract).

## Phase 1 contracts: built and tested, not deployed

- `contracts/src/FactSpecRegistry.sol`: the publisher writes the spec once (at most 8 entries, one per question, all limits in code).
- `contracts/src/TiebreakCaseV6.sol`: V5 plus automatic questions. Kinds 2 and 3 are fixed when the case opens; kind 1 (evidence timing) is fixed
  the moment both sides have answered, so evidence attached later does not change it. Evidence now records its `role`, so a helper who was later
  replaced still counts as the side. The on-chain read is one static call with a 100,000-gas cap that copies only the first word of the answer.
  A failing, short, non-contract or gas-hungry source leaves the question to the parties.
- Runtime size 18.9 KB (limit 24.6 KB).
- `contracts/test/AutoQuestions.t.sol` (24 tests, the same cases as `tests/autoq.test.mjs`) and `contracts/test/PasskeyV6.t.sol` (the whole V5 suite
  against V6 with no spec set, 36 tests). All 242 contract tests pass.
- `scripts/deploy-v6.sh` (preflight, then four transactions: FactSpecRegistry, a new LGtieBilling, TiebreakCaseV6, link). Preflight was run against mainnet
  (read-only, about 0.0002 OKB estimated) and a full deploy was run on a local fork; it writes a `v6:` line to `site/config.js`, which the site does not read yet.
- Not built yet: per-agreement values (`AgreementRegistryV3`), the site reading V6 cases, and the
  builder control to publish a spec. Deploying V6 needs a new billing contract because `setCases` can be called only once.
