// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RuleSetRegistry, IProcessor} from "./RuleSetRegistry.sol";
import {IVerdictSource} from "./IVerdictSource.sol";

/// @title TiebreakCaseV2
/// @notice Both sides answer the same yes/no questions of a published rule set. Where they agree the answer stands; only the
///         disputed questions go to a reviewer BOTH sides have accepted. The rule set's circuit computes the result. Every stage
///         has a deadline: a case nobody completes ends as Expired ("no decision"), it never decides by default.
///         Holds no funds. Checks who may act, not whether an answer is true. Unaudited.
/// @dev Changes from v1: (1) the reviewer must be accepted by the filer and the decider before they can review (the opener only
///      proposes one); (2) answer and review deadlines with a public `expire`; (3) `verdict` for other contracts to read.
///      "operator" still lets a website or staff member act for a party; every call records msg.sender in an event.
contract TiebreakCaseV2 is IVerdictSource {
    enum Status { Open, AwaitingReview, Final, Expired }

    struct Case {
        uint256 ruleSetId;
        address filer;
        address decider;
        address reviewer;
        address operator;
        bytes32 evidenceHash;   // hash of the evidence bundle shared off-chain; never the evidence itself
        uint64 openedAt;
        uint64 answerBy;        // answers must arrive before this
        uint32 reviewWindow;    // seconds the reviewer gets once the answers are in
        uint64 reviewBy;        // set when the case moves to AwaitingReview
        uint64 filerAnswers;
        uint64 deciderAnswers;
        bool filerIn;
        bool deciderIn;
        uint64 disputed;        // questions the two sides answered differently
        uint64 finalAnswers;
        uint8 result;
        bool filerOkReviewer;
        bool deciderOkReviewer;
        Status status;
    }

    uint32 public constant MIN_WINDOW = 1 hours;
    uint32 public constant MAX_WINDOW = 90 days;

    RuleSetRegistry public immutable registry;
    Case[] private cases; // id = index + 1

    event CaseOpened(uint256 indexed id, uint256 indexed ruleSetId, address filer, address decider, address reviewer, address operator, bytes32 evidenceHash, uint64 answerBy, uint32 reviewWindow);
    event ReviewerProposed(uint256 indexed id, address by, address reviewer);
    event ReviewerApproved(uint256 indexed id, address by, bool asFiler);
    event AnswersSubmitted(uint256 indexed id, bool asFiler, address submitter, uint64 answers);
    event NeedsReview(uint256 indexed id, uint64 disputed, uint64 reviewBy);
    event Reviewed(uint256 indexed id, address by, uint64 reviewedAnswers);
    event Finalized(uint256 indexed id, uint64 finalAnswers, uint8 result, uint64 disputed);
    event Expired(uint256 indexed id, Status stage);

    constructor(RuleSetRegistry r) { registry = r; }

    /// @notice Opens a case. The caller becomes the operator. `reviewer` is only a proposal until the decider accepts it.
    /// @param filer address of the person filing (the opener's approval of the reviewer counts for the filer)
    function open(uint256 ruleSetId, address filer, address decider, address reviewer, bytes32 evidenceHash, uint32 answerWindow, uint32 reviewWindow)
        external returns (uint256 id)
    {
        registry.get(ruleSetId); // reverts if unknown
        require(filer != address(0) && decider != address(0) && reviewer != address(0), "zero party");
        require(filer != decider, "filer and decider must differ");
        require(reviewer != filer && reviewer != decider, "reviewer must be neutral");
        require(answerWindow >= MIN_WINDOW && answerWindow <= MAX_WINDOW, "answer window 1 hour..90 days");
        require(reviewWindow >= MIN_WINDOW && reviewWindow <= MAX_WINDOW, "review window 1 hour..90 days");
        uint64 answerBy = uint64(block.timestamp) + answerWindow;
        cases.push(Case(ruleSetId, filer, decider, reviewer, msg.sender, evidenceHash, uint64(block.timestamp), answerBy, reviewWindow, 0, 0, 0, false, false, 0, 0, 0, true, false, Status.Open));
        id = cases.length;
        emit CaseOpened(id, ruleSetId, filer, decider, reviewer, msg.sender, evidenceHash, answerBy, reviewWindow);
    }

    /// @notice A side (or the operator for it) accepts the currently proposed reviewer.
    function approveReviewer(uint256 id, bool asFiler) external {
        Case storage c = _live(id); _party(c, asFiler);
        if (asFiler) c.filerOkReviewer = true; else c.deciderOkReviewer = true;
        emit ReviewerApproved(id, msg.sender, asFiler);
    }

    /// @notice A side (or the operator for it) proposes a different reviewer. The other side must accept before the reviewer can act.
    function proposeReviewer(uint256 id, bool asFiler, address newReviewer) external {
        Case storage c = _live(id); _party(c, asFiler);
        require(newReviewer != address(0) && newReviewer != c.filer && newReviewer != c.decider, "reviewer must be neutral");
        c.reviewer = newReviewer; c.filerOkReviewer = asFiler; c.deciderOkReviewer = !asFiler;
        emit ReviewerProposed(id, msg.sender, newReviewer);
    }

    function submit(uint256 id, bool asFiler, uint64 answers) external {
        Case storage c = _case(id);
        require(c.status == Status.Open, "not open");
        require(block.timestamp <= c.answerBy, "answer deadline passed");
        _party(c, asFiler);
        RuleSetRegistry.RuleSet memory rs = registry.get(c.ruleSetId);
        require(answers & ~_mask(rs.nQuestions) == 0, "answer outside the questions");
        if (asFiler) { require(!c.filerIn, "already answered"); c.filerAnswers = answers; c.filerIn = true; }
        else { require(!c.deciderIn, "already answered"); c.deciderAnswers = answers; c.deciderIn = true; }
        emit AnswersSubmitted(id, asFiler, msg.sender, answers);
        if (c.filerIn && c.deciderIn) {
            c.disputed = c.filerAnswers ^ c.deciderAnswers;
            if (c.disputed == 0) _finalize(id, c, rs, c.filerAnswers);
            else { c.status = Status.AwaitingReview; c.reviewBy = uint64(block.timestamp) + c.reviewWindow; emit NeedsReview(id, c.disputed, c.reviewBy); }
        }
    }

    /// @param reviewedAnswers the reviewer's answers; only the disputed bits are used, the rest are ignored
    function review(uint256 id, uint64 reviewedAnswers) external {
        Case storage c = _case(id);
        require(c.status == Status.AwaitingReview, "not awaiting review");
        require(block.timestamp <= c.reviewBy, "review deadline passed");
        require(c.filerOkReviewer && c.deciderOkReviewer, "reviewer not accepted by both sides");
        require(msg.sender == c.reviewer || msg.sender == c.operator, "not allowed");
        RuleSetRegistry.RuleSet memory rs = registry.get(c.ruleSetId);
        uint64 fin = (c.filerAnswers & ~c.disputed) | (reviewedAnswers & c.disputed);
        emit Reviewed(id, msg.sender, reviewedAnswers);
        _finalize(id, c, rs, fin);
    }

    /// @notice Anyone can close a case whose deadline has passed. It ends as Expired: no decision, and nobody wins by default.
    function expire(uint256 id) external {
        Case storage c = _case(id);
        require((c.status == Status.Open && block.timestamp > c.answerBy) || (c.status == Status.AwaitingReview && block.timestamp > c.reviewBy), "not expired yet");
        Status was = c.status; c.status = Status.Expired;
        emit Expired(id, was);
    }

    /// @notice Anyone can re-run the circuit on the recorded final answers and compare with the stored result.
    function replay(uint256 id) external view returns (uint8 recomputed, uint8 stored, bool matches) {
        Case storage c = _case(id);
        require(c.status == Status.Final, "not final");
        recomputed = _eval(registry.get(c.ruleSetId), c.finalAnswers);
        stored = c.result;
        matches = recomputed == stored;
    }

    /// @inheritdoc IVerdictSource
    function verdict(uint256 id) external view returns (bool isFinal, uint8 result, uint256 ruleSetId, uint64 finalAnswers) {
        Case storage c = _case(id);
        return (c.status == Status.Final, c.result, c.ruleSetId, c.finalAnswers);
    }

    function get(uint256 id) external view returns (Case memory) { return _case(id); }
    function count() external view returns (uint256) { return cases.length; }

    // ---- internals ----
    function _case(uint256 id) private view returns (Case storage) {
        require(id >= 1 && id <= cases.length, "unknown case");
        return cases[id - 1];
    }
    function _live(uint256 id) private view returns (Case storage c) {
        c = _case(id);
        require(c.status == Status.Open || c.status == Status.AwaitingReview, "case is closed");
    }
    function _party(Case storage c, bool asFiler) private view {
        require(msg.sender == (asFiler ? c.filer : c.decider) || msg.sender == c.operator, "not allowed");
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
