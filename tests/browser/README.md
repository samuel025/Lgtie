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
| `history.mjs` | the rules history page read from the real registry (index, rule set #1, its fingerprint, publisher and counts of the real agreements and cases that use it), links to it from agreements, the business record, the checker and the footer, and Chinese. A multi-version chain, a replacement and a forged replacement are covered in `publish.mjs` | network (read-only) |
| `verify.mjs` | the formal proof in the product: the builder proves its circuit and offers a report, a big policy is proved in full, circuit #13 is read from X Layer and proved equal to the warranty rules (checker page and `#verify`), wrong or missing circuits are explained, and it all works in Chinese | network (reads circuit #13) |
| `lint.mjs` | the rule check in the builder: built-in templates are clean, a bad question is flagged with advice, a suggested piece of evidence is added with one click, Show jumps to the problem, publishing is never blocked, nothing is sent anywhere, and all of it in Chinese | none |
| `agreements.mjs` | standing agreements: an agreement page (wallet and passkey) says it stays in force for any number of cases and lists the cases under it with a count and outcomes, in Chinese too (reads real agreement #1 from X Layer) | network (read-only) |
| `links.mjs` | finding things: the header's More menu (opens, closes on Escape, on a click elsewhere and when you pick something), the quick links under the home headline (plain words, no jargon), the grouped footer sitemap, in Chinese, and on a phone | none |
| `templates.mjs` | the #templates page, a free checker for a template, opening it in the builder, the contract clause (on the templates page and on a real agreement) and all of it in Chinese (the published warranty checker stays in English rules) | network (reads agreement #1 from X Layer) |
| `i18n.mjs` | languages: Chinese by default on a fresh profile, the 中文 / EN switch and its persistence, translated results, counters, dates and placeholders, and a real case read from mainnet | network (reads X Layer) |
| `reviewerid.mjs` | named reviewers: a real wallet signature (made with `cast`), profile setup, publishing to a local relay, the public-page check against a fake page, a stranger's browser finding the name, and the agreement form refusing a profile for the wrong address | `cast`, `ws`; reads mainnet for the case list only |
| `bridge.mjs` | the optional bridge (`bridge/`): notify-only mode, auto-submit and ordering, reviewer pings, garbage ignored, daily cap; starts a local relay and webhook receiver and needs `npm install` inside `bridge/` | anvil fork, forge |
| `publish.mjs` | one-click publish with a simulated wallet (claim, mint, tape-out, register) and the verified published link | `anvil --fork-url https://rpc.xlayer.tech --port 8547` |
| `cases.mjs` | agreements (propose, terms check, accept), a case under an agreement, evidence hashing of a real file, an agreed reviewer deciding at once, helpers acting only for their side, "no decision" after a deadline, and the reviewer and business records (it deploys `AgreementRegistry` and `TiebreakCaseV3` on the fork itself) | the same anvil fork, and `forge` |

The app defaults to Chinese, so the other browser tests set `localStorage["lgtie.lang"] = "en"` before the page loads and read English text.

The simulated wallet signs with anvil's impersonated accounts, so these tests spend nothing. A real-wallet run (for example OKX Wallet on mainnet) has not been done.

`passkeys.mjs` and `passkeys-frame.mjs` deploy fresh contracts to the fork by default. Run them with `USE_DEPLOYED=1` to use the contracts already deployed on mainnet (read from `site/config.js`).

`passkeys.mjs` also covers the business inbox (a customer's signed action is posted to a relay and submitted from `#inbox`, including queued actions and the relays-unreachable fallback), passkey evidence, and the reviewer's written reasons with the Side A / Side B view. It starts a tiny local Nostr relay from `nostr-relay.mjs`, which needs the `ws` package next to `puppeteer-core` (`npm i ws`). Set `SHOTS=/some/dir` to save screenshots.

Unit tests (no browser): `node tests/rules.test.mjs`, `node tests/pkcore.test.mjs`, `node tests/reviewer.test.mjs` and `node tests/nostr.test.mjs` (BIP-340 signatures against the official vectors) `node tests/verify.test.mjs` (the formal check against brute force), `node tests/reviewer.test.mjs` (the reviewer statement, including the evidence digest and its check), `node tests/lint.test.mjs` (the rule check) and `node tests/templates.test.mjs` (every template, English and Chinese) and `node tests/reviewerid.test.mjs` (wallet-signature recovery against a real signature, profile codes, the page check).

- `billing.mjs`: revenue end to end on a fork of X Layer (needs `anvil --fork-url https://rpc.xlayer.tech --port 8547 --auto-impersonate --silent`). Deploys a mock dollar token and the real `scripts/deploy-v5.sh` contracts, then drives the pricing page, subscribing, and opening a case with and without a subscription, in English and Chinese.
- `autopreview.mjs`: the unlisted `#auto/<template>` preview of automatic questions (marking a question as answered by the chain changes what goes to the reviewer). No network.
- `autowrite.mjs`: `#auto/<rule set number>`: a publisher reviews and writes a rule set's automatic questions once, everyone else reads them, a second write is refused. Fork of X Layer (the spec registry is deployed on mainnet).
- `deal.mjs`: deal links: the creator form and share buttons, the page the other person opens, hostile link text, the static preview pages and pictures chat apps read (needs `dist/` served on port 8095: `cd dist && python3 -m http.server 8095`), the one-tap "Agree with my passkey" reply with a virtual authenticator, and the sender's pre-filled invite.
- `v6.mjs`: TiebreakCaseV6 on the live contracts (on a fork): cases and billing, the "Answered by the chain" display, older V5 and V4 case routes, the pricing note for earlier subscribers.
- `v7.mjs`: AgreementRegistryV3 on the contracts `scripts/deploy-v7.sh` really deploys (fork): a person with only a passkey proposes, someone else submits, the other side accepts, a case opens, a proposal is withdrawn.
- `v8.mjs`: agreement cards end to end on the contracts `scripts/deploy-v8.sh` really deploys (fork), with two separate simulated phones: signing a card with no wallet and no fee, tampering caught, recording it, a case, a disagreement, a reviewer agreed afterwards by passkey signatures.
