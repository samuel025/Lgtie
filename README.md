# LGtie

A business publishes its policy as a checker. Customers answer plain yes/no questions and see the result and the reason. If a customer and the business answer a question differently, only that question goes to a neutral reviewer. The rules are stored on X Layer as a TapeOut circuit, so they can't be changed after a case starts, and anyone can re-run the same answers through the same circuit and get the same result, for free.

Prototype for the X Layer TapeOut Accelerate hackathon. The project was first called Tiebreak; it is now **LGtie**. The deployed contracts keep their original names (`RuleSetRegistry`, `TiebreakCase`, `TiebreakCaseV2`) because renaming them in the source would no longer match the bytecode on-chain. Product brief: https://claude.ai/artifact/3pvHd82LCXz7Fc5kSuJ184

## What is live (X Layer mainnet, chain 196)

| Thing | Address / id |
| --- | --- |
| TapeOut processor (existing, reused) | `0x9e2849c04a513fe64db07521cbe52d078d905c0e` |
| Warranty rule set circuit | #13 (7 inputs, 2 outputs, 39 NAND gates) |
| `RuleSetRegistry` | `0x25E87D367316038a2d3B6A4fe3d58AA453D4c219` (rule set #1 = "Warranty claims") |
| `TiebreakCase` (v1, simple) | `0x14c9C106d0A785091F77Fc36F5b2152a5d8C9987` |
| `TiebreakCaseV2` | `0x0d45f65dC5C14cc4f4EE926e52979D3DcBd246B3`. **Has a flaw, no longer used by the site** (see below) |
| `AgreementRegistry` + `TiebreakCaseV3` | written and tested (66 contract tests), **not deployed yet**: run `scripts/deploy-v3.sh preflight`, then `deploy` (about 0.0002 OKB) |

`node tests/mainnet-verify.mjs` runs circuit #13 on mainnet for all 128 answer combinations and compares with the rules (read-only).

## How it works

1. **Rules** are written as plain lines (see below). `site/rules.js` parses them, runs them directly, compiles them to a NAND netlist, and proves the circuit equals the rules on every answer combination.
2. **Publishing** tapes the circuit out on the TapeOut processor (a 0.0013 OKB fee plus one NAND token per gate) and registers it in `RuleSetRegistry` with the SHA-256 of the rules text. Entries never change; a new version is a new entry.
3. **An agreement (optional, before any dispute)** (`AgreementRegistry`): two parties accept one published rule set, a neutral reviewer, the time limits and a fingerprint of their written terms. Once accepted it can never be changed or withdrawn, so neither side can swap the rules or the reviewer halfway through. Either party can then open a case under it.
4. **A case** (`TiebreakCaseV3`): the filer and the decider each submit answers before a deadline. Equal answers finish the case at once. Different answers go to a reviewer **both sides have accepted** (the opener proposes one, the other side accepts or counter-proposes), whose answers count only for the disputed questions, also before a deadline. The processor's `eval` computes the result and anyone can call `replay(id)` to recompute it. A case nobody finishes in time can be closed by anyone and ends as **no decision**; nobody wins by default. Other contracts read the outcome with `verdict(id)` (see `docs/VERDICT.md`); LGtie itself never holds funds.
5. **Evidence:** either side, their helper or the reviewer can attach a SHA-256 fingerprint (and a short note) to a question or to the whole case. The page hashes the file in the browser; nothing is uploaded. A fingerprint shows a file has not changed since, not that it is genuine.
6. **The web page** needs no wallet to check a claim (it reads the processor over public RPC). Opening a case and answering as a party needs a wallet.

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

- `site/` the web app (static files, no server calls): `index.html`, `rules.js` (rule engine), `builder.js` (visual rule builder: forms, spreadsheet paste, text view, and a copy-paste prompt for drafting rules with any AI assistant), `wallet.js` and `publish.js` (one-click publish with the visitor's own wallet: claims or buys NAND if short, tapes the circuit out, registers it), `embed.js` (one script tag that puts a checker on any website; `embed-demo.html` shows it on a fictional support page), `cases.js` (on-chain pages: agreements at `#agree`, cases at `#case`, reviewer records at `#reviewer`, business records at `#business/<address>`), `app.js`, `config.js` (addresses, which templates are published).
- `contracts/` Foundry project: `RuleSetRegistry`, `TiebreakCase`, unit tests with a mock processor, a fuzz test, and a fork test against the real processor.
- `compiler/` the first hand-built warranty circuit (14 gates) kept as a reference for the generic compiler.
- `dist/` is the build output: `node scripts/bundle.mjs` inlines every script into one self-contained `dist/index.html` (about 80 KB, no external assets), plus `embed.js` and `embed-demo.html`. Any static host can serve it as is; that is also the shape DeWEB needs.
- `docs/VERDICT.md` how another contract reads a case's verdict.
- `scripts/` `deploy.sh`, `deploy-case-v2.sh`, `deploy-v3.sh` and `publish-rules.sh` (each has a read-only `preflight` mode; you run the spending steps with your own Foundry keystore) and `compile.mjs`.
- `tests/` `rules.test.mjs`, `mainnet-verify.mjs`. `test/fork-tapeout.mjs` tapes the circuit out on a local fork.

## Run and test

```
cd site && python3 -m http.server 8090        # then open http://localhost:8090
node tests/rules.test.mjs                      # rule engine, 17 checks
cd contracts && forge test                     # unit and fuzz tests; add --match-contract TiebreakForkTest for the real-processor test (needs network)
node tests/mainnet-verify.mjs                  # read-only check of circuit #13 on X Layer
```

Browser and end-to-end tests are in `tests/browser/` (see its README): checker, builder, embed, one-click publish and the whole case flow with a simulated wallet on a fork. A real-wallet run on mainnet has not been done.

## Security note: a flaw in the V2 case contract

In `TiebreakCaseV2` (and V1), the wallet that opened a case automatically became its "operator", and an operator could answer and approve the reviewer for **both** sides. A filer could therefore submit the decider's answers first, and the decider would be locked out by "already answered". No funds were at risk (the contracts hold none) and no real case had been opened, but it would have let one side decide a case alone. `TiebreakCaseV3` fixes it: each side can name only its own single helper, a helper acts only for the side that named it, and nobody can appoint a helper for the other side. `contracts/test/TiebreakV3.t.sol` includes a test that demonstrates the attack on the real V2 code and tests that it no longer works. The site no longer uses V2.

## Honest limits

- **It does not check that answers are true.** The result follows the answers given. A reviewer decides disputed facts and can be wrong. The circuit shows the rules were applied consistently, nothing more.
- A normal smart contract could hold the same decision table. What TapeOut adds is a published, immutable rule that anyone can re-run for free.
- **Why a circuit and not a contract per business:** a circuit is a pure function by construction (no state, no external calls, no admin key), so customers need not audit each business's code; only the shared processor and registry need trust. Publishing a rule set is data, not a deployment. It does not compute anything a contract cannot.
- A wallet is not a person. There is an "operator" role in the case contract so a website could submit for people without wallets, but no operator service is built; today each party needs a wallet to answer. Every submission records who sent it.
- A reviewer who never answers, or a side who never answers, ends the case as "no decision" after the deadline. That is safe but unhelpful: the sides have to open a new case.
- The reviewer is accepted by both sides, but nothing stops two parties from agreeing on a biased reviewer, or from agreeing on the same false answers. There is no staking, jury or slashing.
- No escrow on purpose. See `docs/VERDICT.md` for how a separate contract can pay out from a verdict.
- Contracts are unaudited and hold no funds. No customers, revenue or validated prices exist; plans in the brief are hypotheses.
- Publishing from the page spends the visitor's own OKB and needs a wallet; `scripts/publish-rules.sh` does the same from a terminal. Published custom checkers get a link (`#check/c=<rules>/rs=<id>`) that re-checks the rules text against the registry hash. Embed: `<div></div><script src=".../embed.js" data-checker="warranty" async></script>` (the checker page prints a ready snippet). Not built: link-based cases for people without wallets, hosting, the paid plans. Everything stays static on purpose, so it can move to DeWEB later.
