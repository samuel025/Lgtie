// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RuleSetRegistry, IProcessor} from "./RuleSetRegistry.sol";
import {AgreementRegistry} from "./AgreementRegistry.sol";
import {IVerdictSource} from "./IVerdictSource.sol";

/// @title TiebreakCaseV3
/// @notice Both sides answer the same yes/no questions of a published rule set. Where they agree the answer stands; only the disputed
///         questions go to a reviewer BOTH sides accepted; the rule set's circuit computes the result. Every stage has a deadline; a
///         case nobody completes ends as Expired ("no decision") and never decides by default. Holds no funds. Unaudited.
/// @dev Changes from V2:
///      1. SECURITY FIX: in V2 whoever opened a case became its "operator" and could answer and approve for BOTH sides. Here each side
///         can delegate only itself (`setOperator`), and an operator acts only for the side that named it.
///      2. Cases can be opened under an accepted agreement (`openFromAgreement`): rule set, reviewer and time limits were agreed
///         beforehand and cannot be swapped.
///      3. Evidence: either side, their operators or the reviewer can attach a hash (and a short note) to a question or to the case.
///         A hash shows a file has not changed since; it does not show the file is genuine.
contract TiebreakCaseV3 is IVerdictSource {
    enum Status { Open, AwaitingReview, Final, Expired }

    struct Case {
        uint256 ruleSetId;
        address filer;
        address decider;
        address reviewer;
        address filerOperator;     // optional helper chosen by the filer, acts only for the filer
        address deciderOperator;   // optional helper chosen by the decider, acts only for the decider
        bytes32 evidenceHash;      // hash of the evidence bundle shared off-chain; never the evidence itself
        uint256 agreementId;       // 0 for a case opened without an agreement
        uint64 openedAt;
        uint64 answerBy;
        uint32 reviewWindow;
        uint64 reviewBy;           // set when the case moves to AwaitingReview
        uint64 filerAnswers;
        uint64 deciderAnswers;
        bool filerIn;
        bool deciderIn;
        uint64 disputed;
        uint64 finalAnswers;
        uint8 result;
        bool filerOkReviewer;
        bool deciderOkReviewer;
        Status status;
    }

    struct Evidence { address by; uint8 question; uint64 at; bytes32 hash; string note; }

    uint32 public constant MIN_WINDOW = 1 hours;
    uint32 public constant MAX_WINDOW = 90 days;
    uint8 public constant WHOLE_CASE = 255;     // evidence question index meaning "the case as a whole"
    uint256 public constant MAX_EVIDENCE = 40;  // per case
    uint256 public constant MAX_NOTE = 60;      // bytes

    RuleSetRegistry public immutable registry;
    AgreementRegistry public immutable agreements;
    Case[] private cases; // id = index + 1
    mapping(uint256 => Evidence[]) private evidence;

    event CaseOpened(uint256 indexed id, uint256 indexed ruleSetId, address filer, address decider, address reviewer, bytes32 evidenceHash, uint256 agreementId, uint64 answerBy, uint32 reviewWindow);
    event OperatorSet(uint256 indexed id, bool forFiler, address operator);
    event ReviewerProposed(uint256 indexed id, address by, address reviewer);
    event ReviewerApproved(uint256 indexed id, address by, bool asFiler);
    event AnswersSubmitted(uint256 indexed id, bool asFiler, address submitter, uint64 answers);
    event EvidenceAttached(uint256 indexed id, uint8 question, address by, bytes32 hash);
    event NeedsReview(uint256 indexed id, uint64 disputed, uint64 reviewBy);
    event Reviewed(uint256 indexed id, address by, uint64 reviewedAnswers);
    event Finalized(uint256 indexed id, uint64 finalAnswers, uint8 result, uint64 disputed);
    event Expired(uint256 indexed id, Status stage);

    constructor(RuleSetRegistry r, AgreementRegistry a) { registry = r; agreements = a; }

    // ---------- opening ----------
    /// @notice Opens a case without an agreement. The caller is the filer. `reviewer` is only a proposal until the decider accepts it.
    function open(uint256 ruleSetId, address decider, address reviewer, bytes32 evidenceHash, uint32 answerWindow, uint32 reviewWindow) external returns (uint256 id) {
        registry.get(ruleSetId); // reverts if unknown
        require(decider != address(0) && reviewer != address(0), "zero party");
        require(msg.sender != decider, "filer and decider must differ");
        require(reviewer != msg.sender && reviewer != decider, "reviewer must be neutral");
        _windows(answerWindow, reviewWindow);
        id = _push(ruleSetId, msg.sender, decider, reviewer, evidenceHash, 0, answerWindow, reviewWindow, true, false);
    }

    /// @notice Opens a case under an accepted agreement. The caller (one of the two parties) is the filer; the other party is the decider.
    ///         Rule set, reviewer and time limits come from the agreement, and both sides have already accepted that reviewer.
    function openFromAgreement(uint256 agreementId, bytes32 evidenceHash) external returns (uint256 id) {
        AgreementRegistry.Agreement memory a = agreements.get(agreementId);
        require(a.acceptedAt != 0 && !a.cancelled, "agreement not in force");
        require(msg.sender == a.proposer || msg.sender == a.counterparty, "not a party to the agreement");
        address other = msg.sender == a.proposer ? a.counterparty : a.proposer;
        id = _push(a.ruleSetId, msg.sender, other, a.reviewer, evidenceHash, agreementId, a.answerWindow, a.reviewWindow, true, true);
    }

    // ---------- helpers for the two sides ----------
    /// @notice A side names (or clears, with address(0)) ONE helper that may act only for that side. Only the side itself can do this.
    function setOperator(uint256 id, bool forFiler, address operator) external {
        Case storage c = _live(id);
        require(msg.sender == (forFiler ? c.filer : c.decider), "only the side itself");
        require(operator != c.reviewer, "the reviewer cannot be a helper");
        if (forFiler) c.filerOperator = operator; else c.deciderOperator = operator;
        emit OperatorSet(id, forFiler, operator);
    }

    function approveReviewer(uint256 id, bool asFiler) external {
        Case storage c = _live(id); _side(c, asFiler);
        if (asFiler) c.filerOkReviewer = true; else c.deciderOkReviewer = true;
        emit ReviewerApproved(id, msg.sender, asFiler);
    }

    function proposeReviewer(uint256 id, bool asFiler, address newReviewer) external {
        Case storage c = _live(id); _side(c, asFiler);
        require(newReviewer != address(0) && newReviewer != c.filer && newReviewer != c.decider, "reviewer must be neutral");
        require(newReviewer != c.filerOperator && newReviewer != c.deciderOperator, "the reviewer cannot be a helper");
        c.reviewer = newReviewer; c.filerOkReviewer = asFiler; c.deciderOkReviewer = !asFiler;
        emit ReviewerProposed(id, msg.sender, newReviewer);
    }

    // ---------- answers, evidence, review ----------
    function submit(uint256 id, bool asFiler, uint64 answers) external {
        Case storage c = _case(id);
        require(c.status == Status.Open, "not open");
        require(block.timestamp <= c.answerBy, "answer deadline passed");
        _side(c, asFiler);
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

    /// @notice Attach a hash (and a short note, such as a file name) to one question, or to the whole case with WHOLE_CASE.
    ///         Allowed for either side, their helpers and the current reviewer, until the case's current deadline.
    function attachEvidence(uint256 id, uint8 question, bytes32 hash, string calldata note) external {
        Case storage c = _live(id);
        require(block.timestamp <= (c.status == Status.Open ? c.answerBy : c.reviewBy), "deadline passed");
        require(msg.sender == c.filer || msg.sender == c.decider || msg.sender == c.filerOperator || msg.sender == c.deciderOperator || msg.sender == c.reviewer, "not allowed");
        require(hash != bytes32(0), "empty hash");
        require(bytes(note).length <= MAX_NOTE, "note too long");
        require(evidence[id].length < MAX_EVIDENCE, "too much evidence");
        if (question != WHOLE_CASE) require(question < registry.get(c.ruleSetId).nQuestions, "no such question");
        evidence[id].push(Evidence(msg.sender, question, uint64(block.timestamp), hash, note));
        emit EvidenceAttached(id, question, msg.sender, hash);
    }

    /// @param reviewedAnswers the reviewer's answers; only the disputed bits are used, the rest are ignored
    function review(uint256 id, uint64 reviewedAnswers) external {
        Case storage c = _case(id);
        require(c.status == Status.AwaitingReview, "not awaiting review");
        require(block.timestamp <= c.reviewBy, "review deadline passed");
        require(c.filerOkReviewer && c.deciderOkReviewer, "reviewer not accepted by both sides");
        require(msg.sender == c.reviewer, "not allowed");
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

    // ---------- reads ----------
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
    function evidenceCount(uint256 id) external view returns (uint256) { _case(id); return evidence[id].length; }
    function evidenceAt(uint256 id, uint256 i) external view returns (Evidence memory) { _case(id); return evidence[id][i]; }

    // ---------- internals ----------
    function _push(uint256 ruleSetId, address filer, address decider, address reviewer, bytes32 evidenceHash, uint256 agreementId, uint32 answerWindow, uint32 reviewWindow, bool filerOk, bool deciderOk) private returns (uint256 id) {
        uint64 answerBy = uint64(block.timestamp) + answerWindow;
        cases.push(Case(ruleSetId, filer, decider, reviewer, address(0), address(0), evidenceHash, agreementId, uint64(block.timestamp), answerBy, reviewWindow, 0, 0, 0, false, false, 0, 0, 0, filerOk, deciderOk, Status.Open));
        id = cases.length;
        emit CaseOpened(id, ruleSetId, filer, decider, reviewer, evidenceHash, agreementId, answerBy, reviewWindow);
    }
    function _windows(uint32 a, uint32 r) private pure {
        require(a >= MIN_WINDOW && a <= MAX_WINDOW, "answer window 1 hour..90 days");
        require(r >= MIN_WINDOW && r <= MAX_WINDOW, "review window 1 hour..90 days");
    }
    function _case(uint256 id) private view returns (Case storage) {
        require(id >= 1 && id <= cases.length, "unknown case");
        return cases[id - 1];
    }
    function _live(uint256 id) private view returns (Case storage c) {
        c = _case(id);
        require(c.status == Status.Open || c.status == Status.AwaitingReview, "case is closed");
    }
    /// @dev The caller must be the side itself or the helper THAT SIDE named. A helper of one side can never act for the other.
    function _side(Case storage c, bool asFiler) private view {
        require(msg.sender == (asFiler ? c.filer : c.decider) || msg.sender == (asFiler ? c.filerOperator : c.deciderOperator), "not allowed");
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
