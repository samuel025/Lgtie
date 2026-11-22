# Browser and end-to-end tests

These drive the site with a real headless Chrome (puppeteer-core). They are not run by `npm` because this repo has no dependencies; install `puppeteer-core` somewhere and run them with `node`, with the site served on port 8090:

```
cd site && python3 -m http.server 8090 &
npm i puppeteer-core            # in any folder; then run: node <path>/checker.mjs
```

| File | What it covers | Needs |
| --- | --- | --- |
| `checker.mjs` | home, checker, shared links, builder error messages, verify, about, phone width; confirms results against circuit #13 on mainnet | network (reads X Layer) |
| `builder.mjs` | the visual rule builder: forms, text view, spreadsheet paste, AI-reply loading | none |
| `embed.mjs` | the embeddable checker and its demo page | network |
| `publish.mjs` | one-click publish with a simulated wallet (claim, mint, tape-out, register) and the verified published link | `anvil --fork-url https://rpc.xlayer.tech --port 8547` |
| `cases.mjs` | agreements (propose, terms check, accept), a case under an agreement, evidence hashing of a real file, an agreed reviewer deciding at once, helpers acting only for their side, "no decision" after a deadline, and the reviewer and business records (it deploys `AgreementRegistry` and `TiebreakCaseV3` on the fork itself) | the same anvil fork, and `forge` |

The simulated wallet signs with anvil's impersonated accounts, so these tests spend nothing. A real-wallet run (for example OKX Wallet on mainnet) has not been done.
