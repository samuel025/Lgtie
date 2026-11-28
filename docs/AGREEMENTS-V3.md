# AgreementRegistryV3: a passkey can propose (deployed Nov 28, 2026)

Today a person with no wallet can only be the *other* side of an agreement: the proposer has to be a wallet (`AgreementRegistryV2`). V3 lets the proposer be a
passkey account too, so a seller or freelancer without a wallet can start a deal.

## What changes
- `proposeSigned(proposerPasskey, counterparty, ruleSetId, termsHash, reviewer, answerWindow, reviewWindow, sig)`: the passkey signs every term, and **anyone** may submit it.
  The signed action is bound to the exact terms and to this registry, and its nonce is used up, so it cannot be changed, replayed or spent elsewhere.
- `cancelSigned(id, sig)`: a passkey proposer withdraws a proposal that has not been accepted, the same way.
- Everything else (wallet `propose`, `accept`, `acceptSigned`, `cancel`) works as in V2.
- The `Agreement` struct and the reads (`get`, `count`, `inForce`, `termsDigestOf`) are **identical** to V2's. So a second instance of the existing `TiebreakCaseV6` is
  deployed pointing at V3, with no new case contract, and the whole earlier test suite passes against it unchanged (`contracts/test/PasskeyV7.t.sol`, 36 tests).
  New behaviour has 13 tests of its own (`contracts/test/AgreementV3.t.sol`), including a full case under a passkey-proposed agreement.

## What it does not decide: who pays
A passkey can sign but cannot send a transaction, so **whoever submits pays** the network fee (a fraction of a cent) and, when a case is opened, the per-case fee
unless a subscription covers it. Between two people with no wallet at all, nobody can submit. LGtie does not run a relayer. In practice one side, a friend or a
marketplace submits. A sponsored-fee service could be added later; it is not part of this.

## Deploying (you run it)
`scripts/deploy-v7.sh preflight`, then `scripts/deploy-v7.sh deploy`: four transactions (AgreementRegistryV3, a new `LGtieBilling` because the live one can be linked to a
case contract only once, a second `TiebreakCaseV6`, the link). It reuses the live passkey registry, rule-set registry, processor and spec registry, and writes a `v7:` line to
`site/config.js`. Existing subscribers would subscribe again on the new billing contract. Unaudited.

## On the site (built, tested on a fork)
- When `site/config.js` has a `v7:` line (written by `scripts/deploy-v7.sh`), the site uses the V3 registry, the second case contract and the new billing contract. Without it nothing changes.
- On **My cases** (`#mine`), after "Find my cases with my passkey", a person with only a passkey sees **Propose an agreement with my passkey**: the other side (a wallet address or a passkey account number), the reviewer, the rules, the time limits and written terms. They sign every term; the page then offers a link (and an inbox message) for someone with a wallet to submit.
- A pending proposal made by a passkey can be withdrawn the same way (**Withdraw this proposal**), and the agreement and case pages say "passkey account #n" for the proposer.
- Agreements on the older registry stay at `#pk/v2agreement/<id>`; cases on older contracts at `#pk/v6case`, `#pk/v5case` and `#pk/v4case`.
- A **deal link** (`#deal/<template>`) can carry a rule set number and fills in the terms when the sender invites someone or proposes with a passkey.
- `tests/browser/v7.mjs` runs the whole path on the real deployed contracts (on a fork): a person with only a virtual passkey proposes, someone else submits, the other side accepts, she opens a case, and a second proposal is withdrawn.
