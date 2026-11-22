// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RuleSetRegistry, IProcessor} from "./RuleSetRegistry.sol";

/// @title TiebreakCase
/// @notice One case = two sides answer the same yes/no questions of a published rule set. Where they agree the answer stands;
///         where they differ only those questions go to a named reviewer. The rule set's circuit then computes the result.
///         Holds no funds. The contract checks who may act, not whether an answer is true. Unaudited.
/// @dev "operator" lets a website submit on behalf of people who have no wallet. Every submission records msg.sender in an event,
///      so a reader can see whether a person or the operator submitted.
contract TiebreakCase {
    enum Status { Open, AwaitingReview, Final }

    struct Case {
        uint256 ruleSetId;
        address filer;
        address decider;
        address reviewer;
        address operator;
        bytes32 evidenceHash;   // hash of the evidence bundle shared off-chain; never the evidence itself
        uint64 openedAt;
        uint64 filerAnswers;
        uint64 deciderAnswers;
        bool filerIn;
        bool deciderIn;
        uint64 disputed;        // questions the two sides answered differently
        uint64 finalAnswers;
        uint8 result;
        Status status;
    }

    RuleSetRegistry public immutable registry;
    Case[] private cases; // id = index + 1

    event CaseOpened(uint256 indexed id, uint256 indexed ruleSetId, address filer, address decider, address reviewer, address operator, bytes32 evidenceHash);
    event AnswersSubmitted(uint256 indexed id, bool asFiler, address submitter, uint64 answers);
    event NeedsReview(uint256 indexed id, uint64 disputed);
    event Reviewed(uint256 indexed id, address by, uint64 reviewedAnswers);
    event Finalized(uint256 indexed id, uint64 finalAnswers, uint8 result, uint64 disputed);

    constructor(RuleSetRegistry r) { registry = r; }

    /// @param filer address of the person filing (may be an address the operator controls for them)
    function open(uint256 ruleSetId, address filer, address decider, address reviewer, bytes32 evidenceHash) external returns (uint256 id) {
        registry.get(ruleSetId); // reverts if unknown
        require(filer != address(0) && decider != address(0) && reviewer != address(0), "zero party");
        require(reviewer != filer && reviewer != decider, "reviewer must be neutral");
        cases.push(Case(ruleSetId, filer, decider, reviewer, msg.sender, evidenceHash, uint64(block.timestamp), 0, 0, false, false, 0, 0, 0, Status.Open));
        id = cases.length;
        emit CaseOpened(id, ruleSetId, filer, decider, reviewer, msg.sender, evidenceHash);
    }

    function submit(uint256 id, bool asFiler, uint64 answers) external {
        Case storage c = _case(id);
        require(c.status == Status.Open, "not open");
        require(msg.sender == (asFiler ? c.filer : c.decider) || msg.sender == c.operator, "not allowed");
        RuleSetRegistry.RuleSet memory rs = registry.get(c.ruleSetId);
        require(answers & ~_mask(rs.nQuestions) == 0, "answer outside the questions");
        if (asFiler) { require(!c.filerIn, "already answered"); c.filerAnswers = answers; c.filerIn = true; }
        else { require(!c.deciderIn, "already answered"); c.deciderAnswers = answers; c.deciderIn = true; }
        emit AnswersSubmitted(id, asFiler, msg.sender, answers);
        if (c.filerIn && c.deciderIn) {
            c.disputed = c.filerAnswers ^ c.deciderAnswers;
            if (c.disputed == 0) _finalize(id, c, rs, c.filerAnswers);
            else { c.status = Status.AwaitingReview; emit NeedsReview(id, c.disputed); }
        }
    }

    /// @param reviewedAnswers the reviewer's answers; only the disputed bits are used, the rest are ignored
    function review(uint256 id, uint64 reviewedAnswers) external {
        Case storage c = _case(id);
        require(c.status == Status.AwaitingReview, "not awaiting review");
        require(msg.sender == c.reviewer || msg.sender == c.operator, "not allowed");
        RuleSetRegistry.RuleSet memory rs = registry.get(c.ruleSetId);
        uint64 fin = (c.filerAnswers & ~c.disputed) | (reviewedAnswers & c.disputed);
        emit Reviewed(id, msg.sender, reviewedAnswers);
        _finalize(id, c, rs, fin);
    }

    /// @notice Anyone can re-run the circuit on the recorded final answers and compare with the stored result.
    function replay(uint256 id) external view returns (uint8 recomputed, uint8 stored, bool matches) {
        Case storage c = _case(id);
        require(c.status == Status.Final, "not final");
        recomputed = _eval(registry.get(c.ruleSetId), c.finalAnswers);
        stored = c.result;
        matches = recomputed == stored;
    }

    function get(uint256 id) external view returns (Case memory) { return _case(id); }
    function count() external view returns (uint256) { return cases.length; }

    function _case(uint256 id) private view returns (Case storage) {
        require(id >= 1 && id <= cases.length, "unknown case");
        return cases[id - 1];
    }

    function _finalize(uint256 id, Case storage c, RuleSetRegistry.RuleSet memory rs, uint64 fin) private {
        c.finalAnswers = fin;
        c.result = _eval(rs, fin);
        c.status = Status.Final;
        emit Finalized(id, fin, c.result, c.disputed);
    }

    function _mask(uint8 nQ) private pure returns (uint64) { return nQ == 64 ? type(uint64).max : (uint64(1) << nQ) - 1; }

    function _eval(RuleSetRegistry.RuleSet memory rs, uint64 answers) private view returns (uint8) {
        bytes memory input = new bytes((uint256(rs.nQuestions) + 7) / 8);
        for (uint256 j = 0; j < input.length; j++) input[j] = bytes1(uint8(answers >> (8 * j)));
        bytes memory out = IProcessor(rs.processor).eval(rs.circuitId, input);
        require(out.length > 0, "empty result");
        return uint8(out[0]) & uint8((uint256(1) << rs.nResultBits) - 1);
    }
}
