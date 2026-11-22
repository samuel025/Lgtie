# Reading a LGtie verdict from another contract

LGtie never holds funds. If you want money to move on the result of a case, a separate contract (an escrow, a multisig, a payout module) can read the verdict and act on it.

```solidity
interface IVerdictSource {
    function verdict(uint256 caseId) external view returns (bool isFinal, uint8 result, uint256 ruleSetId, uint64 finalAnswers);
}
```

- `isFinal` is true only when the case was decided. It is false while a case is open, waiting for a reviewer, or expired. An expired case never has a verdict, and nobody wins by default.
- `result` is the circuit's output number for the rule set. What each number means is defined by the rule set's text (for the warranty example: 0 Not covered, 1 Needs review, 2 Partly covered, 3 Covered). The registry publishes a hash of that text with the circuit.
- `ruleSetId` lets you check that the case used the rule set you expect.
- `finalAnswers` is the agreed answer bitmask (question 1 is bit 0), useful for audit.

## Sketch of a consumer (not deployed, not audited, moves no funds here)

```solidity
function settle(uint256 caseId) external {
    (bool isFinal, uint8 result, uint256 ruleSetId,) = tiebreak.verdict(caseId);
    require(isFinal && ruleSetId == EXPECTED_RULE_SET, "no usable verdict");
    // map the result number to what your contract does, for example:
    // 3 -> pay the filer in full, 2 -> pay parts only, 1 -> hold for manual review, 0 -> pay nothing
}
```

`contracts/test/TiebreakV2.t.sol` contains a test-only `ExampleConsumer` that reads a verdict this way.

## Why LGtie does not hold the money itself

A contract that holds funds is a much bigger target than one that only records decisions, and this one is unaudited. Keeping custody out means a bug here can produce a wrong verdict, but cannot drain anyone. If you build a consumer that holds funds, that contract is the one that needs an audit, a refund path, and its own timeout.

## Which contract

Use `TiebreakCaseV3` once it is deployed (`site/config.js` shows the current address). `TiebreakCaseV2` has the same `verdict` function but a flaw that let a case's opener answer for both sides, so don't build on it; see the README.

## Deployed addresses

`TiebreakCaseV2` is on X Layer mainnet at `0x0d45f65dC5C14cc4f4EE926e52979D3DcBd246B3` (also in `site/config.js` as `caseContract`). The first case contract (`caseContractV1`, `0x14c9C106d0A785091F77Fc36F5b2152a5d8C9987`) has no reviewer acceptance, no deadlines and no `verdict` function.
