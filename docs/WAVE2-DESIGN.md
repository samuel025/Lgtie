# Wave 2 contract design: passkey reviewers, appointments with fee terms, and billing that stops resetting subscribers

Status: a design for review. **Nothing here is built.** It follows [REVIEWER-DIRECTORY.md](REVIEWER-DIRECTORY.md) (Wave 2) and is written against the contracts that are live today
(`TiebreakCaseV7`, `AgreementRegistryV4`, `PasskeyRegistry`, `LGtieBilling`). Anything that cannot be known until a prototype is compiled is marked **to measure**.

## 1. Goals and non-goals

**Goals**
1. A reviewer can be a **passkey account** and never needs a wallet. They sign; anyone submits and pays the network fee.
2. An **appointment** is one explicit record: the reviewer, the case and a **fingerprint of the fee terms**. Both sides approve that exact record, and the reviewer accepts that same record, before anyone can decide.
3. The **billing contract accepts charges from case contracts added through a public delay**, so a new case contract never again forces subscribers to re-subscribe.
4. Nothing already deployed changes. Existing agreements, cards and cases keep working and stay readable.

**Non-goals**
- Escrow or any custody of a reviewer's fee. LGtie records the terms and the reviewer's confirmation; it does not move or enforce payment.
- On-chain payment receipts. The appointment record **reserves room** for one (a `bytes32 receiptRef`) so it can be added later without a new contract.
- Ratings or feedback (Wave 3).
- A reviewer **named in advance** inside an agreement or card as a passkey. See 3.6: agreements keep their reviewer as a wallet address, so passkey reviewers are appointed after a dispute starts. (Changing the agreement struct would force yet another registry migration.)

## 2. What stays the same (and why that matters)
- `PasskeyRegistry`, `RuleSetRegistry`, `FactSpecRegistry` and the processor are reused. `AgreementRegistryV4` is reused: **its `Agreement` struct is unchanged**, so a new case contract can read it exactly as V7 does.
- A reviewer **named by wallet in an agreement** works as it does in V7: fixed in advance, no appointment step beyond the existing acknowledgement.
- Every V7 test must still pass against V8 with wallet reviewers (the same "re-run the earlier suite against the new contract" method used for V6 and V7).

## 3. The case contract: `TiebreakCaseV8`

### 3.1 Reviewer identity
Today a reviewer is an `address`. V8 stores a **`Party`** (the existing `{wallet, passkey}` struct, exactly one set), the same shape as the two sides:
- `reviewer.wallet != 0`: a wallet reviewer, authorised by `msg.sender`, as today.
- `reviewer.passkey != 0`: a passkey reviewer, authorised by a signature that `PasskeyRegistry.verifyAndBump` checks for the account.

The passkey account must exist (`passkeys.exists`). **Neutrality checks:** a wallet reviewer may not be a side or a side's helper (as in V7); a passkey reviewer's account id may not equal either side's passkey account id; neither identity may be empty.

**Key rotation and recovery.** The reviewer is the **account id**, not a key. `PasskeyRegistry` already lets an account hold up to five keys, add one signed by an existing key, and remove one (never the last), so a reviewer keeps the same identity when changing devices. Past decisions are stored against the account id and stay valid. A profile statement is verified against the account's keys **at the time it is read**, so after a rotation the reviewer simply re-signs their profile (free, no transaction). **If every key is lost there is no recovery**, the same limit customers have; the profile page tells reviewers to add a second key.

### 3.2 The appointment
One record per case, replacing the loose `reviewer`, `filerOkReviewer`, `deciderOkReviewer` and `reviewerAcked` fields:

```
struct Appointment {
    Party   reviewer;
    bytes32 termsHash;        // fingerprint of the fee terms (who pays, how much, how); the text travels with the people, not the chain
    bool    filerOk;          // the filer approved exactly this reviewer and these terms
    bool    deciderOk;
    bool    accepted;         // the reviewer accepted exactly this appointment (and confirmed payment, or that they volunteer)
    bool    volunteer;        // shown to everyone; the reviewer's own statement
    bytes32 receiptRef;       // reserved: an optional payment receipt, set later; zero in V8
}
```

**State machine** (all transitions are events):

| State | Entered by | Leaves by |
|---|---|---|
| None | the case opening with no reviewer named, or the reviewer declining | `proposeReviewer` |
| Proposed | one side proposes `(reviewer, termsHash)`; that side's approval is implied | the other side approves, or anyone re-proposes |
| Approved | the other side approves the same `(reviewer, termsHash)` | the reviewer accepts or declines |
| Accepted | the reviewer accepts the same `(reviewer, termsHash, volunteer)` | `review`, or the reviewer declines |
| Decided | `review` | final |

Rules:
- A proposal, an approval and an acceptance each **name `(reviewer, termsHash)`**, and the contract compares them to the stored record. An approval signed for one appointment cannot be spent on another.
- **Proposing again before acceptance** replaces the record and clears both approvals (as V7 does for reviewers).
- **After the reviewer has accepted, the appointment is locked.** Only the reviewer can leave it, with `declineAppointment` (back to None, with an event), so the parties can pick someone else. This stops a side from re-proposing repeatedly to run out the clock.
- **No decision is possible until `filerOk && deciderOk && accepted`.** A case with no accepted appointment by its review deadline ends as `Expired`: no decision, nobody wins by default (unchanged).
- A reviewer **named in the agreement** starts in Approved with `termsHash = 0` (nothing to agree about fees) and needs only the acceptance, which replaces today's optional `acknowledgeReviewer` for those cases.

### 3.3 Functions (new or changed)
Each has a **wallet form** and a **signed form** for passkey identities, as the rest of the contract does.

| Function | Who | Binds |
|---|---|---|
| `proposeReviewer(id, asFiler, Party reviewer, bytes32 termsHash)` / `proposeReviewerSigned(..., SigAuth)` | a side | `("PROPOSE_REVIEWER", id, asFiler, reviewer, termsHash)` |
| `approveReviewer(id, asFiler, Party reviewer, bytes32 termsHash)` / `approveReviewerSigned(...)` | the other side | `("APPROVE_REVIEWER", id, asFiler, reviewer, termsHash)` |
| `acceptAppointment(id, bytes32 termsHash, bool volunteer)` / `acceptAppointmentSigned(...)` | the reviewer | `("ACCEPT_APPOINTMENT", id, reviewer, termsHash, volunteer)` |
| `declineAppointment(id)` / `declineAppointmentSigned(...)` | the reviewer | `("DECLINE_APPOINTMENT", id, reviewer, termsHash)` |
| `review(id, answers)` / `reviewSigned(id, answers, SigAuth)` | the reviewer | `("REVIEW", id, reviewer, termsHash, answers)` |
| `attachEvidence` for role 2 / `attachReviewerEvidenceSigned(...)` | the reviewer (their written reasons) | `("REVIEWER_EVIDENCE", id, question, hash, keccak(note))` |

Signed forms use the existing `PasskeyRegistry.verifyAndBump(account, payload, sig)`, whose challenge already commits to the chain, the registry, **this contract's address**, the account, a nonce and a deadline. So a signature cannot be replayed, moved to another contract, or reordered.

### 3.4 What a reviewer's decision commits to
`review` binds the **appointment** `(reviewer, termsHash)` as well as the answers, so a decision cannot be attributed to a reviewer who was later replaced, and the written reasons (the reviewer's evidence) are tied to the same identity. The existing statement flow (reasons, evidence list, no-conflict declaration) is unchanged; for a passkey reviewer the statement is signed by their passkey and checked in the browser the way agreement cards already are.

### 3.5 Events
`ReviewerProposed(id, by, reviewer.wallet, reviewer.passkey, termsHash)`, `ReviewerApproved(id, asFiler, reviewer…, termsHash)`, `AppointmentAccepted(id, reviewer…, termsHash, volunteer)`, `AppointmentDeclined(id, reviewer…)`, plus the existing `Reviewed`, `Finalized`, `Expired`. These make the directory statistics exact (offers, acceptances, declines) instead of inferred from final state, and let "accepted but never decided" be counted.

### 3.6 Agreements and cards are unchanged
`Agreement.reviewer` stays an `address`. A card that names a reviewer names a **wallet**. A passkey reviewer is therefore **appointed after the dispute starts** (the "reviewer to be agreed later" path built in V7), which is the common case for deal links anyway.

### 3.7 Size: the main risk (to measure)
`TiebreakCaseV7` is **19,794 bytes of the 24,576-byte limit** (4,782 spare). V8 adds about eight external functions and a larger record, which could use most of that.
1. **Prototype first.** Write the V8 functions and compile before any other work, and read the size.
2. If it fits with margin (target: under 23,500), proceed.
3. If not, in this order: shorten revert strings; move the automatic-question evaluation (`_openFacts`, `_evidenceFacts`, `_read`) into a linked library; and as a last resort move the appointment state machine into a companion `ReviewerAppointments` contract that the case contract asks (`ready(id)`, `reviewerOf(id)`), keeping `review` and the signatures in the case contract.
4. The decision and the measured size are recorded in this document before the release is built.

## 4. The billing contract: `LGtieBilling` (next instance, with a delayed allow-list)

Today `setCases` can be called once, so every new case contract forces a new billing contract and subscribers re-subscribe. The next billing contract keeps everything else (plans, caps, the treasury, the token, two-step ownership, payments straight to the treasury, no custody) and changes who may call `charge`.

### 4.1 Authorisation
```
mapping(address => State) public caseState;        // None, Proposed, Active, Revoked
mapping(address => uint64) public activatableAt;

proposeCases(address c)   onlyOwner   // c must have code; state None -> Proposed; activatableAt = now + 7 days; emits CasesProposed(c, activatableAt)
activateCases(address c)  anyone      // state Proposed and now >= activatableAt -> Active; emits CasesActivated(c)
revokeCases(address c)    onlyOwner   // Proposed or Active -> Revoked, immediately; emits CasesRevoked(c)
bootstrapCases(address c) onlyOwner   // ONCE, only before anything is Active: -> Active at once (the first case contract must exist before it can be added with a delay)
charge(business, payer)               // require(caseState[msg.sender] == Active)
```
- **The delay protects every addition after the first.** The first (`bootstrapCases`) is trusted exactly as `setCases` is today, and the contract says so.
- **Revoking is immediate, adding is delayed, on purpose.** Revoking can only stop charging (it cannot move money), and a buggy contract should stop at once. A revoked address is final; a replacement needs a new address.
- Removal **never** touches subscriptions, plans or existing cases. A revoked case contract just can no longer charge, so it cannot open new billed cases.
- `charge` still checks the **calling contract's address**, never a claim about who is calling.

### 4.2 What the delay does and does not do
It gives the public seven days to see a proposed contract (events, the address, its code) before it can charge anyone. It does **not** remove the risk of a compromised owner: a malicious proposal that nobody notices could drain the allowance of anyone who approved the billing contract. The limits that still apply: each charge is capped (10 USDT), and the site approves only the exact fee or plan price each time, so what is exposed is one outstanding approval per person. The proposal, activation and emergency-revocation steps are documented in `docs/SECURITY.md`, and the owner is a wallet that should become a multisig before significant volume.

### 4.3 Migration
Subscribers re-subscribe **once more**, on this contract. It is the last time: later case contracts are added through `proposeCases`.

## 5. Deploying
`scripts/deploy-v9.sh preflight|deploy` (a new script, the same pattern as the others): the new billing contract, `TiebreakCaseV8` (pointed at the live `AgreementRegistryV4`, passkey registry, rule-set registry, spec registry and processor), `bootstrapCases`, and a `v9:` line in `site/config.js`. The site picks the newest era, as before.

## 6. The site (after the contracts)
- `decodeCase`: V8's layout differs (the reviewer is now two words, and the appointment replaces four fields), recognised by length as V6 and V7 already are.
- **Reviewer as a passkey:** profile setup signs the statement with a passkey; verification reads the account's keys; the directory and picker list passkey reviewers; a **reviewer's inbox** is a link the appointing party sends (no server; a notification must never carry evidence, and opening one still needs the passkey).
- **Appointment screen:** a terms builder (who pays: split / business / volunteer, the amount, how) produces the text and its fingerprint; both sides approve; the reviewer's screen shows exactly those terms and a single **Accept (I have been paid, or I volunteer)**. The case page shows the appointment state and the terms fingerprint, with a field to paste the text and check it.
- **The decision form** for a passkey reviewer: the same questions-only view, reasons and conflict declaration, signed with the passkey.
- Pricing: a note that subscriptions on earlier billing contracts do not carry over (existing wording).

## 7. Tests (written before the contracts are called done)
**Contracts**
- The whole V7 suite against V8 with wallet reviewers (identical behaviour), plus the card and automatic-question suites.
- Appointment: every transition above; approval/acceptance for the wrong `(reviewer, termsHash)` rejected; replay and cross-contract replay rejected; proposing again resets approvals only before acceptance; locked after acceptance; decline reopens; no decision until all three flags; expiry with none; neutrality checks for wallet and passkey reviewers; a passkey reviewer decides and their reasons are tied to the same account; two different people cannot share one account's authority.
- Billing: proposing and activation timing (exactly at and one second before the delay); only the owner proposes and revokes; anyone activates; `charge` from a Proposed, Revoked or unknown address reverts; revocation does not affect subscriptions or other contracts; bootstrap only once and only while empty; the old payment tests (nothing held, caps, subscriptions) re-run unchanged.
- Gas and **size** assertions (under the limit with margin).

**Browser** (on a fork, as `v8.mjs` does): a passkey-only reviewer is appointed with fee terms, both sides approve, the reviewer accepts and decides, and the case finalises with nobody holding a wallet except whoever submits.

## 8. Open questions
1. **Size** (3.7): does the prototype fit, or does the appointment state machine need its own contract?
2. **Who owns the billing owner key** and when does it move to a multisig (4.2)?
3. Should a **volunteer** reviewer still have to accept explicitly? The design says yes (one rule for everyone).
4. Should the declined/accepted counts shown in the directory be computed from the new events only, with older cases excluded, or mixed with the inferred figures for older cases? (The design leaves older cases as they are, and labels the difference.)
