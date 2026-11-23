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

Use `TiebreakCaseV4` for new work, or `TiebreakCaseV3`; both are deployed on X Layer mainnet and `site/config.js` shows the current addresses (`caseContract` for V3, `v4.cases` for V4). `TiebreakCaseV2` has the same `verdict` function but a flaw that let a case's opener answer for both sides, so don't build on it; see the README.

## Deployed addresses

`TiebreakCaseV3` is at `0xF6C636e1f08bdE711d1FDdc40eb23DEa7719Ec67` and `TiebreakCaseV4` at `0x178bB4ddC548F3456bD5AE2de7Abe67A8DCb02d0` (both on X Layer mainnet). The flawed `TiebreakCaseV2` is at `0x0d45f65dC5C14cc4f4EE926e52979D3DcBd246B3` (`caseContractV2` in `site/config.js`) and should not be used. The first case contract (`caseContractV1`, `0x14c9C106d0A785091F77Fc36F5b2152a5d8C9987`) has no reviewer acceptance, no deadlines and no `verdict` function.

## TiebreakCaseV4

`TiebreakCaseV4` (deployed Nov 23, 2026 at `0x178bB4ddC548F3456bD5AE2de7Abe67A8DCb02d0`; also in `site/config.js` under `v4.cases`) has the same `verdict(uint256) returns (bool isFinal, uint8 result, uint256 ruleSetId, uint64 finalAnswers)` function and the same `IVerdictSource` interface, so a consumer written for V3 can read V4 cases by changing the address. Always check `isFinal` first. V4 also accepts only rule sets on the trusted TapeOut processor.
