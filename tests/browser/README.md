# Browser and end-to-end tests

These drive the site with a real headless Chrome (puppeteer-core). They are not run by `npm` because this repo has no dependencies; install `puppeteer-core` somewhere and run them with `node`, with the site served on port 8090:

```
cd site && python3 -m http.server 8090 &
npm i puppeteer-core            # in any folder; then run: node <path>/checker.mjs
```

| File | What it covers | Needs |
| --- | --- | --- |
| `checker.mjs` | home, checker, shared links, builder error messages, verify, about, phone width; confirms results against circuit #13 on mainnet | network (reads X Layer) |
| `receipt.mjs` | the home page's real-case card and the printable receipt (read live from mainnet case #1; print layout hides the site chrome) | network |
| `passkeys.mjs` | a customer with no wallet settles a dispute with a passkey: real pages, a Chrome virtual authenticator, V4 contracts on a fork, the real circuit; plus relay-link and fake-account attacks | anvil fork, forge |
| `passkeys-frame.mjs` | passkeys inside a cross-site frame: a fictional Acme page embeds LGtie, creates and uses a passkey, receives the claim code by checked postMessage | anvil fork, forge |
| `live.mjs` | the deployed site: home and the real case, receipt, checker with on-chain confirmation, claim pack, passkey creation on the live domain, and a cross-site frame embedding the live site. Read-only | network, Chrome |
| `hero.mjs` | the home hero draws the real 39-gate circuit, tapping an answer changes the result, autoplay, the count-up facts, the card icons, and the circuit on checker pages | network |
| `builder.mjs` | the visual rule builder: forms, text view, spreadsheet paste, AI-reply loading | none |
| `embed.mjs` | the embeddable checker and its demo page | network |
| `bridge.mjs` | the optional bridge (`bridge/`): notify-only mode, auto-submit and ordering, reviewer pings, garbage ignored, daily cap; starts a local relay and webhook receiver and needs `npm install` inside `bridge/` | anvil fork, forge |
| `publish.mjs` | one-click publish with a simulated wallet (claim, mint, tape-out, register) and the verified published link | `anvil --fork-url https://rpc.xlayer.tech --port 8547` |
| `cases.mjs` | agreements (propose, terms check, accept), a case under an agreement, evidence hashing of a real file, an agreed reviewer deciding at once, helpers acting only for their side, "no decision" after a deadline, and the reviewer and business records (it deploys `AgreementRegistry` and `TiebreakCaseV3` on the fork itself) | the same anvil fork, and `forge` |

The simulated wallet signs with anvil's impersonated accounts, so these tests spend nothing. A real-wallet run (for example OKX Wallet on mainnet) has not been done.

`passkeys.mjs` and `passkeys-frame.mjs` deploy fresh contracts to the fork by default. Run them with `USE_DEPLOYED=1` to use the contracts already deployed on mainnet (read from `site/config.js`).

`passkeys.mjs` also covers the business inbox (a customer's signed action is posted to a relay and submitted from `#inbox`, including queued actions and the relays-unreachable fallback), passkey evidence, and the reviewer's written reasons with the Side A / Side B view. It starts a tiny local Nostr relay from `nostr-relay.mjs`, which needs the `ws` package next to `puppeteer-core` (`npm i ws`). Set `SHOTS=/some/dir` to save screenshots.

Unit tests (no browser): `node tests/rules.test.mjs`, `node tests/pkcore.test.mjs`, `node tests/reviewer.test.mjs` and `node tests/nostr.test.mjs` (BIP-340 signatures against the official vectors).
