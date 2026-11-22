# Tiebreak

Publish a decision table as a TapeOut circuit; both sides answer the same yes/no questions; only disputed questions go to a reviewer; the circuit computes the result and anyone can replay it.

Working notes, product brief: https://claude.ai/artifact/3pvHd82LCXz7Fc5kSuJ184

- `compiler/` turns a rule set into a NAND netlist (`nand.mjs`, `warranty.mjs`); `node compiler/check.mjs` proves it against the rule table on every input.
- `test/fork-tapeout.mjs` tapes the circuit out on a local fork of X Layer (needs `anvil --fork-url https://rpc.xlayer.tech --port 8546`) and compares the processor's `eval` with the rule table.
- `contracts/` is the Foundry project: `RuleSetRegistry`, `TiebreakCase`, unit tests (mock processor) and a fork test against the real processor. Run `cd contracts && forge test`.

- `site/` is the web app (static files: `index.html`, `rules.js` rule engine, `cases.js` on-chain case pages, `app.js`, `config.js`). Serve it with any static server, e.g. `cd site && python3 -m http.server 8090`.
- `scripts/` has `deploy.sh` and `publish-rules.sh` (both have a read-only `preflight` mode; you run the spending steps yourself with your Foundry keystore).

Status: live on X Layer mainnet. RuleSetRegistry 0x25E87D367316038a2d3B6A4fe3d58AA453D4c219, TiebreakCase 0x14c9C106d0A785091F77Fc36F5b2152a5d8C9987, warranty rule set = circuit #13 on processor 0x9e2849c04a513fe64db07521cbe52d078d905c0e (verified on all 128 inputs, `node tests/mainnet-verify.mjs`). Web app: checker, builder, verify, and on-chain case pages (tested end to end on a fork with a simulated wallet). Unaudited; contracts hold no funds. Not built: no-wallet relay, one-click publish, hosting.