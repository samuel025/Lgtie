# Using LGtie alongside a contract

> **This is a template and a way of working, not legal advice.** Nobody has reviewed it with a lawyer. Have a lawyer in your jurisdiction read the clause before you rely on it.

## What it is

LGtie is a tool for **pre-agreed fact-finding**. Two parties agree, in their own written contract, that if they disagree about the facts they will:

1. answer the same published yes or no questions;
2. treat every question they answer the same way as agreed;
3. send only the questions they answered differently to a neutral person both accepted in advance, who decides those questions only and gives written reasons;
4. let the published rules turn the final answers into a result and a reason.

The closest familiar idea is **expert determination** (a neutral decides specific questions of fact, and the parties are bound by it as a matter of contract) or **mediation support**. It is not a new kind of court.

## What it is not

- **Not a court, and not arbitration.** Arbitration usually carries legal requirements (a written agreement, an impartial tribunal, a fair hearing, a reasoned award). LGtie's reviewer answers yes or no questions without a hearing. So the clause and the pages never call the outcome an "award" or a "judgment".
- **Not legal advice**, and not a substitute for a lawyer.
- **Not escrow.** LGtie holds no money. See `docs/VERDICT.md` for how another system could read a decided verdict.
- **Not able to tell whether an answer is true.** A false answer both sides agree on goes through unchecked, and a reviewer can be wrong.

## How to use it

1. **Pick a rule set.** Start from a [template](../site/templates.js) (`#templates`: second-hand sale, freelance milestone, rental deposit, bug bounty, warranty) or build your own. Try its checker for free.
2. **Copy the clause.** On the templates page, under "Put it in your contract", choose the rules and whether the outcome is **binding on the parties** (an expert determination of facts) or **advisory only**. Copy the clause into your written contract. The wording is deliberately cautious: it leaves each party's right to go to court or to arbitration untouched, says the record is evidence and not a judgment or award, and warns that the record is public.
3. **Name the neutral person.** A reviewer can sign a [named profile](SECURITY.md#named-reviewers), so the contract can name a real person and both sides can check who they are.
4. **Optionally lock it in on-chain.** Publish the rules and make an agreement on X Layer. From then on the rules, the reviewer and the time limits cannot be changed, and the agreement page offers the same clause filled in with its own reviewer and time limits.
5. **If a dispute comes,** each side answers, only the differences go to the reviewer, and the result comes with a receipt (`#receipt/<id>`).

## Where it fits best

Small, frequent disputes where a lawyer would cost more than the dispute: freelance scope and delivery, a landlord and tenant deciding a deposit, a small supplier's delivery.

Some courts expect the parties to have tried to settle before suing. A dated record that both sides answered the same questions and that a neutral person decided the rest may help show a genuine attempt. That depends on the local rules, so check them. The pages and the clause do not promise it.

## What the record is, and is not

The receipt shows which rules were agreed, what each side answered, which questions were disputed, who decided them and why, and a free re-run of the published rules. It is supporting evidence of what happened. Whether a court or a payment company accepts it is for them to decide, and rules on electronic evidence differ from place to place.

## Confidentiality: everything recorded is public

Answers, fingerprints of evidence and the reviewer's written reasons are recorded on a public blockchain, along with the wallet addresses, the times and the result. Files are never uploaded (only a fingerprint is recorded), reasons must not name people, and the pages say so. Even so, **do not use LGtie for matters that must stay confidential.** Anything recorded cannot be deleted.

## Questions to ask a lawyer before relying on it

- Is an expert-determination clause like this enforceable where you operate, and is "binding on the parties" the right strength for your case?
- If the parties want an arbitration, does this process meet what the arbitration law requires? (This design does not claim to.)
- For consumer contracts, are there mandatory rights (such as access to a court) that a clause like this cannot limit?
- Does accepting an agreement with a wallet or a passkey count as agreement in writing and as a signature where you are?
- How is personal data handled when wallet addresses and written reasons are public and cannot be erased?
- What does the neutral person need (qualifications, independence, conflict checks) to be accepted as one?

## Limits that apply to everything above

The contracts are unaudited and hold no funds. See the "Honest limits" section of the [README](../README.md) and [SECURITY.md](SECURITY.md).
