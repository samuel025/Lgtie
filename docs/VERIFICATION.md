# How LGtie checks that a circuit implements the rules

A business writes rules. LGtie compiles them into a small NAND circuit, and the circuit is what runs on X Layer. The question a judge, a customer or a business should ask is: **how do you know the circuit published on-chain really implements the written rules?**

LGtie answers it with a formal check, not a handful of examples.

## What the check does

It proves that the circuit and the rules give the **same result for every possible set of answers**, however many questions there are (up to the limit of 64). It does this symbolically, so it never has to try the combinations one by one: 40 questions is more than a trillion combinations, and the check takes about 0.1 seconds.

1. **The rules side** is turned into a *reduced ordered binary decision diagram* (ROBDD), a canonical form of a boolean function, straight from the parsed rules: which questions each rule tests, which result each rule gives, first match wins, then the default. It does **not** call the compiler or the reference evaluator, so a bug in either cannot hide itself.
2. **The circuit side** is turned into a diagram from the raw netlist, record by record: each 7-byte record is a type byte (0 = NAND) and two 3-byte references (0 and 1 are the constants 0 and 1, inputs start at 2, the outputs are the last gates). This is the same format the TapeOut processor stores and runs. The netlist can come from the compiler in the page, or it can be **read back from X Layer** (`netlist(uint256)` on the processor), which checks what was actually published.
3. **Compare.** Two functions are equal exactly when their diagrams are the same node. If they differ, the check finds a concrete set of answers where the circuit and the rules disagree (a counterexample), and confirms it by running both.

## Where to use it

| Where | What it does |
| --- | --- |
| The builder (step 3, "Test") | Proves the circuit it just compiled for every answer combination, and offers a downloadable report. |
| A published checker page | "Formal check of the published circuit": reads circuit #N from X Layer and proves it equal to the rules on the page. |
| `#verify` | "Check a circuit against its rules": any circuit number against the warranty rules, the bug-bounty rules or rules you paste. |
| `node scripts/verify-circuit.mjs <warranty\|bounty\|rules.txt> [--circuit N] [--out report.json]` | The same proof from the command line. Exit code 0 only when the circuit is proved equivalent. |
| `node tests/mainnet-verify.mjs` | Reads the published warranty circuit from X Layer, runs all 128 answer combinations on-chain, and proves the netlist equal to the rules. |

## The report

Every check can produce a JSON report with: the tool and version, the compiler version, the method, the rules name and counts, the **rules fingerprint** (SHA-256 of the canonical rules text, which is the same value the registry records for a published rule set), the **netlist fingerprint** (SHA-256 of the netlist bytes), how many records and of what type, how many gates feed no output, the result (`equivalent`, `different`, `unsupported` or `inconclusive`), the counterexample if there is one, the size of the diagrams and the time taken, and an explicit list of what it does **not** prove.

## What it proves, and what it does not

**Proves:** the circuit and the rules compute the same result for all 2^n answer combinations.

**Does not prove:**
- that the rules are fair, complete or sensible;
- that any answer is true;
- that the questions mean what the business intends;
- anything about the contracts that run a case (they are unaudited).

## Limits and honesty

- **Same author, two encodings.** The rules side and the circuit side are built by separate code paths, but a shared misunderstanding of what "first match wins" means would pass. Two things reduce that risk: the netlist semantics (NAND, the reference numbering) are confirmed against the real processor, by running all 128 answer combinations of circuit #13 on-chain and comparing; and the checker is tested against brute force (below).
- **How the checker itself is tested** (`tests/verify.test.mjs`): on 400 random policies and 3,000 randomly corrupted circuits, it agrees with brute force every time: it says "equivalent" exactly when every combination matches, and every counterexample it reports is a real disagreement. It also proves a 40-question and a 64-question policy, catches corrupted circuits at that size, and refuses malformed input instead of guessing. A test also checks that `verify.js` does not use the compiler or the reference evaluator.
- **Only NAND records.** TapeOut also has other record types (REF, LATCH). The checker reports those as `unsupported` and makes no claim.
- **Size limit.** A decision diagram can in theory grow very large for unusual logic. There is a size limit; past it the result is `inconclusive`, never a guess. Decision-table logic like LGtie's rules stays small (88 nodes for the warranty rules).
- **It does not verify the processor.** It checks that the published netlist implements the rules; that the on-chain processor evaluates a netlist correctly is checked only by the 128-combination comparison on circuit #13.

See also [SECURITY.md](SECURITY.md) and the "Honest limits" section of [SUBMISSION.md](SUBMISSION.md).
