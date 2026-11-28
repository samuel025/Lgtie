# Agreement cards: sign now, record only if there is a dispute (contracts built and tested, not deployed)

A chat deal should not need a wallet, a fee or a reviewer's address before anything has gone wrong. An **agreement card** is one deal that both people sign
with their passkeys, off-chain. It is recorded on X Layer only if it is ever needed (a dispute), and anyone can do that.

## The card
Both passkeys sign the same digest, which commits to: both public keys (in order), the rule set, a fingerprint of the written terms, the reviewer (or
none yet), both time windows, a last day to record it, and a random salt, plus the chain and the registry's address. So a card cannot be changed, spent on
another chain or registry, or recorded twice, and a third passkey cannot take the other person's seat. Verified by 14 contract tests
(`contracts/test/AgreementCards.t.sol`).

## Recording it: `AgreementRegistryV4.anchor`
`AgreementRegistryV4` is `AgreementRegistryV3` plus `anchor(terms, signerA, signerB)`. Anyone may submit a card (and pays the network fee). It verifies both
signatures, creates the two passkey accounts if they do not exist (or reuses an account registered under the same handle with the same key), and stores an
agreement **already in force**. The struct and reads are identical to V2 and V3, so the existing case contract code works against it.
If a handle was already registered to a different key, recording that card reverts: the people make a new passkey and card (the same limit as before).

## The reviewer can be agreed later: `TiebreakCaseV7`
`TiebreakCaseV7` is `TiebreakCaseV6` plus:
- A card (or any V4 agreement) may leave the reviewer empty. A case under it starts with no reviewer and nobody having approved one.
- Either side proposes a reviewer (their own approval is implied) and the other approves, by wallet or by passkey signature (`proposeReviewerSigned`,
  `approveReviewerSigned`). An approval names the reviewer, so it cannot be spent on a later one. Proposing again resets the approvals.
- No decision is possible until both sides have approved. If none is agreed by the review deadline the case ends as `Expired`: nobody wins by default.
- An agreement that **did** name a reviewer still fixes it. With every agreement naming one, V7 behaves exactly like V6 (the whole V6 suite is re-run
  against it: `PasskeyV9.t.sol`, `AutoQuestionsV7.t.sol`; new behaviour: `ReviewerLater.t.sol`, 13 tests).

## What it costs, said plainly
- **Dispute time:** whoever records the card and opens the case pays the small network fees and the 3 USDT case fee (unless covered by a subscription). The two
  accounts are created then. This moves the cost to the rare case that needs it.
- **A reviewer still needs a wallet** to decide, so at dispute time someone has to find one both sides accept. The card can name one up front if they already have someone.
- **A card nobody records is only a signed record.** It proves both people agreed to those terms; it does not decide anything by itself.
- **Handle squatting** can block recording a card (see above). Unaudited.

## Deploying (you run it)
`scripts/deploy-v8.sh preflight`, then `deploy`: four transactions (AgreementRegistryV4, a new `LGtieBilling` because the live one can be linked to a case contract
only once, TiebreakCaseV7, the link). It reuses the live passkey registry, rule-set registry, processor and spec registry, and writes a `v8:` line to
`site/config.js`. Existing subscribers would subscribe again on the new billing contract.
