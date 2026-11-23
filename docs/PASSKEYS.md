# Passkey parties: design and gate log

Goal: let a party act without installing a wallet or paying gas, with high-stakes assurance and recoverable identity. A party's identity is a **passkey** (Face ID, fingerprint or PIN). Their device makes a P-256 signature; anyone can submit it; the contract verifies it. The business that needs the case pays the fee.

Status: **Gate 1 passed (feasibility). Nothing here is deployed, and no case contract uses it yet.** Unaudited.

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

## Next gates

- Gate 2: a new case contract version with signed answers and signed acceptance, replay protection, a signer set per side (for the second passkey), and the known limitations from `docs/SECURITY.md` fixed.
- Gate 3: the widget, the postMessage hand-off to a host page, the "your cases" lookup, and a demo on the Acme page.
- Gate 4: assisted recovery with reviewer countersignature and delay, and a written security review.

Stop rule: if any gate goes badly, fall back to crypto-native users plus the no-wallet demo.
