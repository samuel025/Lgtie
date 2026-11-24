# Passkey parties: design and gate log

Goal: let a party act without installing a wallet or paying gas, with high-stakes assurance and recoverable identity. A party's identity is a **passkey** (Face ID, fingerprint or PIN). Their device makes a P-256 signature; anyone can submit it; the contract verifies it. The business that needs the case pays the fee.

Status: **Gates 1, 2 and 3 passed. Deployed on X Layer mainnet on Nov 23, 2026** (addresses below; no accounts, agreements or cases yet). The pages and contracts were tested end to end in a real browser, including against the deployed contracts on a fork of mainnet. Unaudited.

| Contract | Address |
| --- | --- |
| `PasskeyRegistry` | `0xC3c0E2Fa6D8452A14063c01DC50159487E78522E` |
| `AgreementRegistryV2` | `0x802995325A576b69175DCE24e8D643553C9ba2ed` |
| `TiebreakCaseV4` | `0x178bB4ddC548F3456bD5AE2de7Abe67A8DCb02d0` (trusts only the TapeOut processor `0x9e28…5c0e`) |

The first deployment attempt stopped after the registry because `deploy-v4.sh` passed `--constructor-args` before another option; the script was fixed and resumed with `PASSKEYS_EXISTING`.

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
- **Tested by hand once:** the builder ran the whole flow (passkey, agreement, evidence, inbox) on a real phone and it worked. **Not yet tested:** many devices and browsers, passkeys inside an embedded frame on a real phone, and cross-ecosystem sync (Apple to Google is not automatic).

## Gate 2: the contracts (written, tested, not deployed)

| Contract | What it does |
| --- | --- |
| `PasskeyRegistry` | Accounts owned by passkeys (up to 5 each). A caller contract asks it to check one signed action. The signed challenge binds the chain, the registry, the **calling contract**, the account, a per-account **nonce**, a **deadline** and the action's own hash. Add a second passkey (signed by an existing one), remove a lost one (never the last). Look an account up by WebAuthn user handle, so a device can find its account. |
| `AgreementRegistryV2` | The counterparty may be a passkey account; it accepts by signature over a hash of every term. Anyone may submit the signed message, so the business pays the fee. |
| `TiebreakCaseV4` | A side can be a wallet or a passkey account. A passkey side acts by `submitSigned`, `attachEvidenceSigned` or `openFromAgreementSigned`. Passkey sides exist only under an agreement, so the reviewer was fixed in advance. |

**What is tested (115 contract tests in total, 32 of them new for Gate 2, all on a fork of X Layer so a real P-256 verifier runs):**
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

## Gate 3: the pages (built and tested; not deployed)

| Page | What it does |
| --- | --- |
| `#join` | A customer creates a passkey. The page shows a **claim code** (public key, relying-party hash and a handle hash; nothing secret) and a short read-back code for a phone or chat check. When embedded, it also posts the claim code to the host page. |
| `#pk/agree` | The business pastes the claim code, registers the customer's passkey (small fee, paid by the business) and proposes an agreement. It refuses a handle already registered to a different key. |
| `#mine` | The customer finds her agreements and cases with her passkey. The page first proves, on-chain, that **her passkey controls the account** it found by handle, and warns her not to use an account it does not control. She accepts, opens a dispute, answers questions and signs. Nothing is sent from her device. |
| `#relay/<pack>` | Anyone with a wallet submits a signed action and pays the fee. The page refuses links to any contract other than the three LGtie passkey contracts or for another chain, shows whether the call would succeed right now, and the contract rejects altered or replayed actions. |
| `#pk/agreement/<id>`, `#pk/case/<id>` | The business and the reviewer act with wallets: open a dispute, answer, decide, confirm taking part, close an expired case. |

Built on `site/pkcore.js`: keccak256, ABI encoding, the payload hashes and the WebAuthn challenge are computed **in the browser**, not asked of an RPC node, and checked byte for byte against Foundry's `cast` (`node tests/pkcore.test.mjs`, 10 checks). `PasskeyRegistry` gained a read-only `isControlledBy` check so a device can confirm it controls an account it found by handle.

**What the end-to-end test proves** (`tests/browser/passkeys.mjs`, real pages, a Chrome virtual authenticator, the three contracts deployed on a fork, the real TapeOut circuit #13): a customer with no wallet creates a passkey, is registered and invited, accepts and answers by signature, a stranger's wallet relays both, the reviewer decides only the disputed question, and the circuit gives the result. It also checks that a link to another contract or chain is refused, that altered answers and replays fail, that a stranger's passkey finds no account, and that an account registered under someone's handle with another key is flagged to that person.

**Found while testing:** signature deadlines were first set from the browser clock. A chain clock ahead of the browser could make a fresh signature look expired. They now use the latest block's timestamp.

**Frame test (`tests/browser/passkeys-frame.mjs`).** A fictional Acme page served from a different site embeds LGtie with `<script src=".../embed.js" data-flow="join" data-onclaim="...">`. Passkey creation, the account-control check and signing all work inside the cross-site frame; the host page receives the claim code through a postMessage that checks the sender's origin, and a forged message from the page itself is ignored. The embed adds `allow="publickey-credentials-create *; publickey-credentials-get *"`, which cross-site frames need. `site/embed-demo.html` is now the Acme demo: checker, "file a claim with your fingerprint or face", "my claim", and a stand-in staff view that shows how a real back end would store the claim code and send an invite link.

**Still open**
- Other phones and browsers: one real-phone run worked, but the frame test used Chrome with a virtual authenticator. Safari and Firefox rules for passkeys in cross-site frames, and storage partitioning there, are untested. (The pages avoid relying on local storage inside the frame: they find the account by the passkey itself.)
- The final public domain is not chosen; a passkey made on `localhost` will not work there.
- Evidence signing now has a page: a customer adds a file fingerprint or a written explanation on My cases, signs it, and it reaches the business's inbox. Signed actions queue in order (the page remembers the next number for a day).
- The business inbox uses public Nostr relays (`site/nostr.js`); relays can drop messages, so a copy-link fallback remains.
- Gate 4 (assisted recovery) is not built.

## Next gates

- Gate 3 follow-ups: a demo on the Acme page, frame and phone tests on the real domain.
- Gate 4: assisted recovery with reviewer countersignature and delay, and a written security review.

Stop rule: if any gate goes badly, fall back to crypto-native users plus the no-wallet demo.
