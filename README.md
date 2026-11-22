# Tiebreak

Publish a decision table as a TapeOut circuit; both sides answer the same yes/no questions; only disputed questions go to a reviewer; the circuit computes the result and anyone can replay it.

Working notes, product brief: https://claude.ai/artifact/3pvHd82LCXz7Fc5kSuJ184

- `compiler/` turns a rule set into a NAND netlist (`nand.mjs`, `warranty.mjs`); `node compiler/check.mjs` proves it against the rule table on every input.
- `test/fork-tapeout.mjs` tapes the circuit out on a local fork of X Layer (needs `anvil --fork-url https://rpc.xlayer.tech --port 8546`) and compares the processor's `eval` with the rule table.
- `contracts/` is the Foundry project: `RuleSetRegistry`, `TiebreakCase`, unit tests (mock processor) and a fork test against the real processor. Run `cd contracts && forge test`.

Status: warranty rule set compiles to 14 gates and matches on all 128 inputs, also on the real processor in a fork. Contracts done and tested (15 unit tests incl. a fuzz test, 1 fork test); unaudited, hold no funds. Web app not built yet.
