# Passkey parties: design and gate log

Goal: let a party act without installing a wallet or paying gas, with high-stakes assurance and recoverable identity. A party's identity is a **passkey** (Face ID, fingerprint or PIN). Their device makes a P-256 signature; anyone can submit it; the contract verifies it. The business that needs the case pays the fee.

Status: **Gates 1 and 2 passed. The contracts are written and tested but NOT deployed, and the site does not use them yet.** Unaudited.

## Design in short

1. **Enroll.** On the business's logged-in page, an embedded LGtie widget asks the person to create a passkey. The widget returns the passkey's public key (x, y) and credential id to the page; the business stores them with the account.
2. **Bind.** The business opens the agreement or case naming that public key as the other party. The business knows it is the right person because the key came through its own authenticated session.
3. **Check.** On any device holding the passkey, the person can see which cases name their key, so the business cannot quietly name a different one.
4. **Act.** The person reviews the exact answers and confirms with Face ID. The signature covers the chain, the contract, the case, the side, the answers and a deadline, so it cannot be reused or altered. Anyone may submit it.
5. **Recovery, in layers.**
   - Synced passkeys (iCloud Keychain, Google Password Manager) follow the person to new devices.
   - A second passkey (another device or a security key) registered at enrollment can replace the first.
   - Assisted recovery: the business vouches for the person, the **reviewer countersigns**, a waiting period passes, and the old passkey can veto. The business alone can never take over an identity.

## Gate 1: can the chain verify a real passkey cheaply? Yes.

| Check | Result |
| --- | --- |
| X Layer has the RIP-7212 P-256 precompile at `0x100` | Yes. A valid signature returns `1`, a tampered one returns empty (eth_call on mainnet). |
| A real browser passkey assertion, verified by the mainnet precompile | Yes. Chrome's virtual authenticator produced the authenticator data, client data and signature; the precompile returned `1`, and a one-bit change returned empty. |
| Fallback verifier on mainnet (Daimo P256Verifier `0xc2b7…4De4`) | Present (3,537 bytes of code). The Solidity test passes through it (about 393k gas). The precompile path is far cheaper. |
| `contracts/src/WebAuthnP256.sol` | Checks the relying-party id hash, user presence and verification flags, the `webauthn.get` type, the exact challenge, and the P-256 signature. 11 tests, including wrong challenge, tampered signature, wrong key, another site, edited authenticator or client data, wrong indices, missing flags, out-of-range values. |

Reproduce: `node prototypes/passkey/gen-vector.mjs > contracts/test/WebAuthnVector.sol` (needs `puppeteer-core` and Chrome), then `forge test --match-contract WebAuthnTest`.

### Things Gate 1 taught us

- **A signature is not unique.** `(r, s)` and `(r, N - s)` both verify (tested). Replay protection must come from a nonce or a one-time state change in the signed challenge, never from the signature.
- **A passkey is bound to the site's domain** (the relying-party id). We need the final public domain before real enrollment, and changing it later means re-enrolling everyone.
- **Not yet tested:** passkeys inside an embedded frame or pop-up, real phone authenticators, and cross-ecosystem sync (Apple to Google is not automatic).

## Gate 2: the contracts (written, tested, not deployed)

| Contract | What it does |
| --- | --- |
| `PasskeyRegistry` | Accounts owned by passkeys (up to 5 each). A caller contract asks it to check one signed action. The signed challenge binds the chain, the registry, the **calling contract**, the account, a per-account **nonce**, a **deadline** and the action's own hash. Add a second passkey (signed by an existing one), remove a lost one (never the last). Look an account up by WebAuthn user handle, so a device can find its account. |
| `AgreementRegistryV2` | The counterparty may be a passkey account; it accepts by signature over a hash of every term. Anyone may submit the signed message, so the business pays the fee. |
| `TiebreakCaseV4` | A side can be a wallet or a passkey account. A passkey side acts by `submitSigned`, `attachEvidenceSigned` or `openFromAgreementSigned`. Passkey sides exist only under an agreement, so the reviewer was fixed in advance. |

**What is tested (115 contract tests in total, 30 of them new for Gate 2, all on a fork of X Layer so a real P-256 verifier runs):**
a passkey customer settles a dispute without a wallet, including against the real TapeOut processor and circuit #13; signed actions cannot be replayed, altered, moved to another case or contract, used after the deadline, or burned by a stranger (a failed call leaves the nonce untouched); someone else's passkey is refused; a second passkey can be added and can act; a lost passkey can be removed but never the last one; the business cannot answer for the customer.

**Fixes carried over from `docs/SECURITY.md`:** F1 (reviewer cannot be replaced under an agreement), F2 (a `reviewerAcked` flag records whether the reviewer ever took part), F3 (evidence caps per role), F4 (only rule sets on the trusted processor). F5 and F6 are unchanged.

**Practical notes**
- The compiler optimizer was off in this project. With it off, `TiebreakCaseV4` is about 28 KB, over the 24,576-byte limit; with it on it is about 16 KB. `foundry.toml` now enables it.
- Gas on the fork is about 400k per signed action because the fork uses the fallback verifier. On X Layer the native precompile is used first, which is far cheaper. Either way it costs a few millionths of an OKB.

**Known limits of this design (Gate 2)**
- The business creates the customer's account, so it could create one with a key it controls and call it hers. The check "which cases name my passkey" on her side (Gate 3) is what catches this; the contract cannot.
- A passkey account is not recoverable if every passkey is lost. Assisted recovery with the reviewer's countersignature is Gate 4.
- Nonces are sequential. If a person signs two actions with the same nonce, only one can be used, so the page must fetch the current nonce right before each signature.
- Signing shows the person whatever the page displays; WebAuthn cannot show the hash. The page must display exactly what the payload encodes.
- A passkey is bound to the site's domain (the relying-party id). A key made on `localhost` will not work on the final domain; the key set lets a person add a second key for the new domain.

## Next gates

- Gate 3: the widget, the postMessage hand-off to a host page, the "your cases" lookup, and a demo on the Acme page.
- Gate 4: assisted recovery with reviewer countersignature and delay, and a written security review.

Stop rule: if any gate goes badly, fall back to crypto-native users plus the no-wallet demo.
