// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IVerdictSource
/// @notice The one thing another contract needs from Tiebreak: "has case N been decided, and what is the result number?"
///         An escrow, a multisig or any payout contract can read this and pay out by result number, so Tiebreak itself never holds funds.
///         `result` is the circuit's output for the rule set (for example 0 = Not covered, 3 = Covered); see the rule set's definitions.
interface IVerdictSource {
    function verdict(uint256 caseId) external view returns (bool isFinal, uint8 result, uint256 ruleSetId, uint64 finalAnswers);
}
