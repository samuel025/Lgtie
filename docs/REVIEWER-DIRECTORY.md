# Reviewer directory, payment and reputation: specification (not built)

Status: **Wave 1 is built** (site only, no contract change): the extended signed profile, the directory at `#directory`, the chain statistics, the picker and the appointment panel. Waves 2 and 3 are not built. Tests: `tests/reviewerid.test.mjs`, `tests/directory.test.mjs`, `tests/browser/directory.mjs`.

## Principles
- LGtie is a **neutral platform**, not the reviewers' employer or a payment intermediary. It holds no money and takes **no cut** of what a reviewer earns.
- **Evidence, not scores.** Reputation is built from facts a reader can verify on the chain. There is no combined score, no stars and no ranking by rating.
- **Visible is not certified.** A profile being listed never means LGtie checked the person's skill, independence or honesty. Every listing says so.
- The directory helps people choose. **Both sides must still accept the reviewer**, and either can refuse any name.

## Wave 1: the directory (site only, no contract change)

### What a profile shows, and where each fact comes from
| Information | Source | Shown as |
|---|---|---|
| Name, role, public page, relationship declaration | the reviewer, signed with their wallet (already built) | self-declared, signature checked |
| Specialties, regions they know (information only, never legal competence), quoted fee, fee arrangement | the reviewer | self-declared |
| Availability, maximum cases at once, typical response time | the reviewer | self-declared, **with the date last confirmed**; shows "not confirmed recently" after 30 days (the profile stays listed) |
| Cases proposed to them, acknowledged, decided, expired | the chain (events from every case contract) | counts with the denominator |
| Decided within the deadline | the chain | calculated, with the denominator |
| Active cases now against their stated maximum | the chain | calculated; the maximum is labelled self-declared |
| Distinct counterparties; share of cases from their most frequent business; number of distinct businesses | the chain | calculated |
| Acceptance rate (acknowledged of proposed) | the chain (`ReviewerProposed` and `ReviewerAcknowledged` events) | counts, then a percentage once there are five |
| Prior cases where they acted for one of the two parties | the chain | shown at the moment someone proposes them |
| Process feedback from parties | the parties | **not in Wave 1** (see Wave 3) |

Rules: show **counts from the first case**; show a **percentage only after five distinct counterparties**, always next to its denominator. Conflict information distinguishes **declared** relationships from relationships **inferred** from chain activity, and neither is presented as a complete conflict check.

### Fee arrangements (chosen when a reviewer is appointed, shown to both sides)
1. **Split:** each side pays half (the default).
2. **Business-sponsored:** the business pays the whole fee.
3. **Volunteer:** no fee.
The complaining party never pays by default. Payment is **off-chain and direct** between the parties and the reviewer; LGtie records the agreed terms and the reviewer's acknowledgement but **cannot enforce a transfer**, and says so on the appointment screen.

Sequence: both sides select and approve a reviewer, the reviewer accepts and confirms the fee, the parties agree who pays and how, the reviewer confirms receipt (or that they are volunteering), then decides. The confirmation protects the reviewer and gives the parties a visible status. It is not enforcement, and a reviewer who confirms and then does not decide shows up as "accepted but expired".

### Where it appears
`#reviewers` (the existing page) gains listings, filters (specialty, availability, fee arrangement) and a "self-listed, not checked by LGtie" label on every entry. In the step where the two sides agree a reviewer, a **Choose from the directory** button fills the proposal. Profiles are published to public relays as they are today; availability and fee fields are added to the signed profile.

### Moderation policy (to be published before launch)
- A listing may be **hidden** for impersonation, false credentials, abuse, or at the reviewer's own request.
- Anyone can report one; the report and the decision are kept in the public repository, so there is a visible history.
- A reviewer can ask for a decision to be reconsidered.
- **Hiding is only in LGtie's pages.** Profiles live on public relays, so deletion cannot be promised, and hiding never erases chain history.
- LGtie does not certify expertise because a profile is visible.
- Legal advice should be taken before promoting the directory widely: a directory of paid decision-makers can attract regulation in some places.

## Wave 2: one coordinated contract release (V8)

### Reviewers who use a passkey
Today a reviewer's wallet address does five jobs: identity, authenticating their profile and declaration, signing decisions and reasons, receiving appointments, and authorizing contract actions. V8 separates them.
- **Identity:** a reviewer is a wallet **or a passkey account** (`PasskeyRegistry`). The contract stores which, and verifies the same identity later.
- **Profile and declaration:** signed by that identity. Passkey signatures are checked in the browser (as agreement cards already are).
- **Appointment:** names the reviewer, the case and a **fingerprint of the fee terms**. Both sides approve that exact appointment, and the reviewer accepts it by signing the same fingerprint. A reviewer who has not accepted cannot decide. The appointment record leaves room for an optional payment receipt later.
- **Decision and reasons:** submitted by the reviewer's passkey signature; anyone may submit it and pay the network fee.
- **Key rotation and recovery (decided):** the identity is the **passkey account id**, not a key. `PasskeyRegistry` already lets an account hold up to five keys, add one signed by an existing key, and remove one (never the last). So a reviewer keeps the same identity when replacing a device, and profiles, appointments and past decisions stay attached to it. **If every key is lost there is no recovery**, which is the same limit as for customers; the profile page should tell reviewers to add a second key.
- **Notification:** a passkey cannot notify anyone and LGtie runs no server. So, as today, the party who appoints a reviewer **sends them a link** (the invite-the-reviewer message already exists). Email or push would need a server and is out of scope; a notification must never carry evidence, and opening it still requires authentication.

### Billing that stops resetting subscribers
Every new case contract currently needs a new billing contract, so subscribers re-subscribe. V8's billing contract accepts charges only from **activated** case contracts, with a public delay:
1. The owner **proposes** a case contract (address and metadata are public).
2. A **seven-day delay** starts; anyone can inspect it.
3. After the delay, **anyone can activate** it if the proposal is still valid.
4. `charge` accepts calls **only from an activated contract**, checked by address, never by a caller's claim.
5. **Revoking** a contract is immediate (the safe direction: it can only stop charging, not take money) but never touches subscriptions or existing cases.
Per-charge caps and the treasury rules stay as they are. The delay reduces the risk of a compromised owner; it does not remove it, so the proposal, activation and emergency steps are documented. This is the **last time** subscribers re-subscribe.

### Out of scope for V8
Escrow (LGtie would hold funds). On-chain payment receipts are optional and can be added later without delaying the release, provided the appointment record leaves room.

## Wave 3: process feedback, after real cases exist
After a decision each party answers independently, signed by their passkey or wallet and tied to that case (checked in the browser against the chain, so no server and no fee):
- Did the reviewer explain the decision clearly?
- Did the reviewer follow the agreed process?
- Would you accept this reviewer again?
Answers are shown **separately for each side, with counts**, never as an overall score. The questions are about the reviewer's conduct, never about whether the respondent won. Only a party to a decided case can answer. Collusion between fake counterparties is possible, so the number of distinct counterparties stays visible.

## Open questions
1. Is **split** the right default fee arrangement?
2. Who owns the moderation decisions, and where is the report channel?
3. Legal review: which places matter first?
