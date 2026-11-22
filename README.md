# Tiebreak

Publish a decision table as a TapeOut circuit; both sides answer the same yes/no questions; only disputed questions go to a reviewer; the circuit computes the result and anyone can replay it.

Working notes, product brief: https://claude.ai/artifact/3pvHd82LCXz7Fc5kSuJ184

- `compiler/` turns a rule set into a NAND netlist (`nand.mjs`, `warranty.mjs`); `node compiler/check.mjs` proves it against the rule table on every input.
- `test/fork-tapeout.mjs` tapes the circuit out on a local fork of X Layer (needs `anvil --fork-url https://rpc.xlayer.tech --port 8546`) and compares the processor's `eval` with the rule table.
- `spike/` is the Foundry test that calls `eval` from a contract.

Status: warranty rule set compiles to 14 gates and matches on all 128 inputs, also on the real processor in a fork. Contracts and the web app are not built yet.
