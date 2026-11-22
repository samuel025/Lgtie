# Tiebreak

A business publishes its policy as a checker. Customers answer plain yes/no questions and see the result and the reason. If a customer and the business answer a question differently, only that question goes to a neutral reviewer. The rules are stored on X Layer as a TapeOut circuit, so they can't be changed after a case starts, and anyone can re-run the same answers through the same circuit and get the same result, for free.

Prototype for the X Layer TapeOut Accelerate hackathon. Product brief: https://claude.ai/artifact/3pvHd82LCXz7Fc5kSuJ184

## What is live (X Layer mainnet, chain 196)

| Thing | Address / id |
| --- | --- |
| TapeOut processor (existing, reused) | `0x9e2849c04a513fe64db07521cbe52d078d905c0e` |
| Warranty rule set circuit | #13 (7 inputs, 2 outputs, 39 NAND gates) |
| `RuleSetRegistry` | `0x25E87D367316038a2d3B6A4fe3d58AA453D4c219` (rule set #1 = "Warranty claims") |
| `TiebreakCase` (v1, simple) | `0x14c9C106d0A785091F77Fc36F5b2152a5d8C9987` |
| `TiebreakCaseV2` | `0x0d45f65dC5C14cc4f4EE926e52979D3DcBd246B3` (reviewer acceptance, deadlines, verdict reader; used by the site) |

`node tests/mainnet-verify.mjs` runs circuit #13 on mainnet for all 128 answer combinations and compares with the rules (read-only).

## How it works

1. **Rules** are written as plain lines (see below). `site/rules.js` parses them, runs them directly, compiles them to a NAND netlist, and proves the circuit equals the rules on every answer combination.
2. **Publishing** tapes the circuit out on the TapeOut processor (a 0.0013 OKB fee plus one NAND token per gate) and registers it in `RuleSetRegistry` with the SHA-256 of the rules text. Entries never change; a new version is a new entry.
3. **A case** (`TiebreakCaseV2`): the filer and the decider each submit answers before a deadline. Equal answers finish the case at once. Different answers go to a reviewer **both sides have accepted** (the opener proposes one, the other side accepts or counter-proposes), whose answers count only for the disputed questions, also before a deadline. The processor's `eval` computes the result and anyone can call `replay(id)` to recompute it. A case nobody finishes in time can be closed by anyone and ends as **no decision**; nobody wins by default. Other contracts read the outcome with `verdict(id)` (see `docs/VERDICT.md`); Tiebreak itself never holds funds.
4. **The web page** needs no wallet to check a claim (it reads the processor over public RPC). Opening a case and answering as a party needs a wallet.

### Rules format

```
name: Warranty claims
about: One line shown to the person answering
question: Is it still within the warranty period? | Evidence to ask for (optional)
result: Not covered           (results are numbered in the order written)
result: Covered
rule: Q2=no -> Not covered : The reason shown        (top to bottom; the first rule that matches decides)
rule: Q1=yes & Q3=no -> Not covered : Join conditions with &
default: Covered : Shown when no rule matched
```

Two examples are built in: `warranty` and `bounty` (bug-bounty severity, not yet published on-chain).

## Layout

- `site/` the web app (static files, no server calls): `index.html`, `rules.js` (rule engine), `builder.js` (visual rule builder: forms, spreadsheet paste, text view, and a copy-paste prompt for drafting rules with any AI assistant), `wallet.js` and `publish.js` (one-click publish with the visitor's own wallet: claims or buys NAND if short, tapes the circuit out, registers it), `embed.js` (one script tag that puts a checker on any website; `embed-demo.html` shows it on a fictional support page), `cases.js` (on-chain case pages), `app.js`, `config.js` (addresses, which templates are published).
- `contracts/` Foundry project: `RuleSetRegistry`, `TiebreakCase`, unit tests with a mock processor, a fuzz test, and a fork test against the real processor.
- `compiler/` the first hand-built warranty circuit (14 gates) kept as a reference for the generic compiler.
- `dist/` is the build output: `node scripts/bundle.mjs` inlines every script into one self-contained `dist/index.html` (about 80 KB, no external assets), plus `embed.js` and `embed-demo.html`. Any static host can serve it as is; that is also the shape DeWEB needs.
- `docs/VERDICT.md` how another contract reads a case's verdict.
- `scripts/` `deploy.sh`, `deploy-case-v2.sh` and `publish-rules.sh` (each has a read-only `preflight` mode; you run the spending steps with your own Foundry keystore) and `compile.mjs`.
- `tests/` `rules.test.mjs`, `mainnet-verify.mjs`. `test/fork-tapeout.mjs` tapes the circuit out on a local fork.

## Run and test

```
cd site && python3 -m http.server 8090        # then open http://localhost:8090
node tests/rules.test.mjs                      # rule engine, 17 checks
cd contracts && forge test                     # unit and fuzz tests; add --match-contract TiebreakForkTest for the real-processor test (needs network)
node tests/mainnet-verify.mjs                  # read-only check of circuit #13 on X Layer
```

Browser and end-to-end tests are in `tests/browser/` (see its README): checker, builder, embed, one-click publish and the whole case flow with a simulated wallet on a fork. A real-wallet run on mainnet has not been done.

## Honest limits

- **It does not check that answers are true.** The result follows the answers given. A reviewer decides disputed facts and can be wrong. The circuit shows the rules were applied consistently, nothing more.
- A normal smart contract could hold the same decision table. What TapeOut adds is a published, immutable rule that anyone can re-run for free.
- A wallet is not a person. There is an "operator" role in the case contract so a website could submit for people without wallets, but no operator service is built; today each party needs a wallet to answer. Every submission records who sent it.
- A reviewer who never answers, or a side who never answers, ends the case as "no decision" after the deadline. That is safe but unhelpful: the sides have to open a new case.
- The reviewer is accepted by both sides, but nothing stops two parties from agreeing on a biased reviewer, or from agreeing on the same false answers. There is no staking, jury or slashing.
- No escrow on purpose. See `docs/VERDICT.md` for how a separate contract can pay out from a verdict.
- Contracts are unaudited and hold no funds. No customers, revenue or validated prices exist; plans in the brief are hypotheses.
- Publishing from the page spends the visitor's own OKB and needs a wallet; `scripts/publish-rules.sh` does the same from a terminal. Published custom checkers get a link (`#check/c=<rules>/rs=<id>`) that re-checks the rules text against the registry hash. Embed: `<div></div><script src=".../embed.js" data-checker="warranty" async></script>` (the checker page prints a ready snippet). Not built: link-based cases for people without wallets, hosting, the paid plans. Everything stays static on purpose, so it can move to DeWEB later.
