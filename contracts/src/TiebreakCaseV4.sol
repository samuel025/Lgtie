// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RuleSetRegistry, IProcessor} from "./RuleSetRegistry.sol";
import {AgreementRegistryV2} from "./AgreementRegistryV2.sol";
import {PasskeyRegistry} from "./PasskeyRegistry.sol";
import {IVerdictSource} from "./IVerdictSource.sol";
import {Party} from "./Party.sol";

/// @title TiebreakCaseV4
/// @notice Both sides answer the same yes/no questions of a published rule set. Where they agree the answer stands; only the disputed
///         questions go to a reviewer; the rule set's circuit computes the result. Every stage has a deadline and an unfinished case
///         ends as Expired ("no decision"), never deciding by default. Holds no funds. Unaudited.
/// @dev Changes from V3:
///      1. A side can be a passkey account. It acts by signed message (`submitSigned`, `attachEvidenceSigned`, `openFromAgreementSigned`),
///         which anyone may submit, so a business can pay the fee for a customer who has no wallet. Passkey sides exist only under an
///         agreement, so the reviewer was fixed and accepted in advance.
///      2. F1 fixed: a case under an agreement cannot get a different reviewer.
///      3. F2 addressed in the data: `reviewerAcked` records whether the reviewer ever took part, so a record can tell "never involved"
///         from "accepted and did not decide".
///      4. F3 fixed: evidence is capped per role (filer, decider, reviewer), so one side cannot use up every slot.
///      5. F4 fixed: only rule sets on the trusted processor can be used.
contract TiebreakCaseV4 is IVerdictSource {
    enum Status { Open, AwaitingReview, Final, Expired }

    struct Case {
        uint256 ruleSetId;
        Party filer;
        Party decider;
        address reviewer;
        address filerOperator;     // optional helper chosen by a wallet filer, acts only for the filer
        address deciderOperator;   // optional helper chosen by a wallet decider, acts only for the decider
        bytes32 evidenceHash;
        uint256 agreementId;       // 0 for a case opened without an agreement
        uint64 openedAt;
        uint64 answerBy;
        uint32 reviewWindow;
        uint64 reviewBy;
        uint64 filerAnswers;
        uint64 deciderAnswers;
        bool filerIn;
        bool deciderIn;
        uint64 disputed;
        uint64 finalAnswers;
        uint8 result;
        bool filerOkReviewer;
        bool deciderOkReviewer;
        bool reviewerAcked;        // the reviewer has taken part (acknowledged or reviewed)
        Status status;
    }

    struct Evidence { address by; uint256 passkey; uint8 question; uint64 at; bytes32 hash; string note; }

    uint32 public constant MIN_WINDOW = 1 hours;
    uint32 public constant MAX_WINDOW = 90 days;
    uint8 public constant WHOLE_CASE = 255;
    uint8 public constant MAX_EVIDENCE_PER_SIDE = 15;
    uint8 public constant MAX_EVIDENCE_REVIEWER = 6;
    uint256 public constant MAX_NOTE = 60;

    RuleSetRegistry public immutable registry;
    AgreementRegistryV2 public immutable agreements;
    PasskeyRegistry public immutable passkeys;
    address public immutable trustedProcessor;
    Case[] private cases; // id = index + 1
    mapping(uint256 => Evidence[]) private evidence;
    mapping(uint256 => uint8[3]) private evidenceBy; // per case: filer, decider, reviewer counts

    event CaseOpened(uint256 indexed id, uint256 indexed ruleSetId, address filerWallet, uint256 filerPasskey, address deciderWallet, uint256 deciderPasskey, address reviewer, bytes32 evidenceHash, uint256 agreementId, uint64 answerBy, uint32 reviewWindow);
    event OperatorSet(uint256 indexed id, bool forFiler, address operator);
    event ReviewerProposed(uint256 indexed id, address by, address reviewer);
    event ReviewerApproved(uint256 indexed id, address by, bool asFiler);
    event ReviewerAcknowledged(uint256 indexed id, address reviewer);
    event AnswersSubmitted(uint256 indexed id, bool asFiler, address submitter, uint64 answers);
    event EvidenceAttached(uint256 indexed id, uint8 question, uint8 role, bytes32 hash);
    event NeedsReview(uint256 indexed id, uint64 disputed, uint64 reviewBy);
    event Reviewed(uint256 indexed id, address by, uint64 reviewedAnswers);
    event Finalized(uint256 indexed id, uint64 finalAnswers, uint8 result, uint64 disputed);
    event Expired(uint256 indexed id, Status stage);

    constructor(RuleSetRegistry r, AgreementRegistryV2 a, PasskeyRegistry p, address processor) {
        registry = r; agreements = a; passkeys = p; trustedProcessor = processor;
    }

    // ---------- opening ----------
    /// @notice Opens a case between two wallets without an agreement. The caller is the filer; `reviewer` is only a proposal until the decider accepts.
    function open(uint256 ruleSetId, address decider, address reviewer, bytes32 evidenceHash, uint32 answerWindow, uint32 reviewWindow) external returns (uint256 id) {
        require(decider != address(0) && reviewer != address(0), "zero party");
        require(msg.sender != decider, "filer and decider must differ");
        require(reviewer != msg.sender && reviewer != decider, "reviewer must be neutral");
        _windows(answerWindow, reviewWindow);
        id = _push(ruleSetId, Party(msg.sender, 0), Party(decider, 0), reviewer, evidenceHash, 0, answerWindow, reviewWindow, true, false);
    }

    /// @notice A wallet party opens a case under an accepted agreement. The other party (wallet or passkey) becomes the decider.
    function openFromAgreement(uint256 agreementId, bytes32 evidenceHash) external returns (uint256 id) {
        AgreementRegistryV2.Agreement memory a = _inForce(agreementId);
        bool isProposer = a.proposer.wallet != address(0) && msg.sender == a.proposer.wallet;
        bool isCounter = a.counterparty.wallet != address(0) && msg.sender == a.counterparty.wallet;
        require(isProposer || isCounter, "not a party to the agreement");
        (Party memory me, Party memory other) = isProposer ? (a.proposer, a.counterparty) : (a.counterparty, a.proposer);
        id = _push(a.ruleSetId, me, other, a.reviewer, evidenceHash, agreementId, a.answerWindow, a.reviewWindow, true, true);
    }

    /// @notice A passkey party opens a case under an accepted agreement, by signature (anyone may submit it).
    function openFromAgreementSigned(uint256 agreementId, bytes32 evidenceHash, bool asProposer, PasskeyRegistry.SigAuth calldata s) external returns (uint256 id) {
        AgreementRegistryV2.Agreement memory a = _inForce(agreementId);
        (Party memory me, Party memory other) = asProposer ? (a.proposer, a.counterparty) : (a.counterparty, a.proposer);
        require(me.passkey != 0, "that party is a wallet");
        passkeys.verifyAndBump(me.passkey, keccak256(abi.encode("OPEN_CASE", agreementId, evidenceHash, asProposer)), s);
        id = _push(a.ruleSetId, me, other, a.reviewer, evidenceHash, agreementId, a.answerWindow, a.reviewWindow, true, true);
    }

    // ---------- helpers for wallet sides ----------
    function setOperator(uint256 id, bool forFiler, address operator) external {
        Case storage c = _live(id);
        Party storage p = forFiler ? c.filer : c.decider;
        require(p.wallet != address(0) && msg.sender == p.wallet, "only the side itself");
        require(operator != c.reviewer, "the reviewer cannot be a helper");
        if (forFiler) c.filerOperator = operator; else c.deciderOperator = operator;
        emit OperatorSet(id, forFiler, operator);
    }

    function approveReviewer(uint256 id, bool asFiler) external {
        Case storage c = _live(id); _walletSide(c, asFiler);
        if (asFiler) c.filerOkReviewer = true; else c.deciderOkReviewer = true;
        emit ReviewerApproved(id, msg.sender, asFiler);
    }

    /// @notice Only for cases without an agreement. Under an agreement the reviewer was fixed in advance and cannot be replaced.
    function proposeReviewer(uint256 id, bool asFiler, address newReviewer) external {
        Case storage c = _live(id); _walletSide(c, asFiler);
        require(c.agreementId == 0, "the agreement fixed the reviewer");
        require(newReviewer != address(0) && newReviewer != c.filer.wallet && newReviewer != c.decider.wallet, "reviewer must be neutral");
        require(newReviewer != c.filerOperator && newReviewer != c.deciderOperator, "the reviewer cannot be a helper");
        c.reviewer = newReviewer; c.filerOkReviewer = asFiler; c.deciderOkReviewer = !asFiler; c.reviewerAcked = false;
        emit ReviewerProposed(id, msg.sender, newReviewer);
    }

    /// @notice The named reviewer says they are taking part. Not required to review (reviewing counts too), but it lets a public record
    ///         tell a reviewer who never knew about a case from one who accepted it and did not decide.
    function acknowledgeReviewer(uint256 id) external {
        Case storage c = _live(id);
        require(msg.sender == c.reviewer, "not allowed");
        c.reviewerAcked = true;
        emit ReviewerAcknowledged(id, msg.sender);
    }

    // ---------- answers, evidence, review ----------
    function submit(uint256 id, bool asFiler, uint64 answers) external {
        Case storage c = _case(id); _walletSide(c, asFiler);
        _record(id, c, asFiler, answers, msg.sender);
    }

    /// @notice A passkey side submits its answers by signature. Anyone may submit the signed message and pay the fee.
    function submitSigned(uint256 id, bool asFiler, uint64 answers, PasskeyRegistry.SigAuth calldata s) external {
        Case storage c = _case(id);
        _signed(c, asFiler, keccak256(abi.encode("SUBMIT", id, asFiler, answers)), s);
        _record(id, c, asFiler, answers, msg.sender);
    }

    function attachEvidence(uint256 id, uint8 question, bytes32 hash, string calldata note) external {
        Case storage c = _live(id);
        uint8 role;
        if (c.filer.wallet != address(0) && (msg.sender == c.filer.wallet || msg.sender == c.filerOperator)) role = 0;
        else if (c.decider.wallet != address(0) && (msg.sender == c.decider.wallet || msg.sender == c.deciderOperator)) role = 1;
        else if (msg.sender == c.reviewer) role = 2;
        else revert("not allowed");
        _addEvidence(id, c, role, msg.sender, 0, question, hash, note);
    }

    function attachEvidenceSigned(uint256 id, bool asFiler, uint8 question, bytes32 hash, string calldata note, PasskeyRegistry.SigAuth calldata s) external {
        Case storage c = _live(id);
        _signed(c, asFiler, keccak256(abi.encode("EVIDENCE", id, asFiler, question, hash, keccak256(bytes(note)))), s);
        _addEvidence(id, c, asFiler ? 0 : 1, address(0), (asFiler ? c.filer : c.decider).passkey, question, hash, note);
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
        c.reviewerAcked = true;
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
    function _inForce(uint256 agreementId) private view returns (AgreementRegistryV2.Agreement memory a) {
        a = agreements.get(agreementId);
        require(a.acceptedAt != 0 && !a.cancelled, "agreement not in force");
    }

    function _push(uint256 ruleSetId, Party memory filer, Party memory decider, address reviewer, bytes32 evidenceHash, uint256 agreementId, uint32 answerWindow, uint32 reviewWindow, bool filerOk, bool deciderOk) private returns (uint256 id) {
        require(registry.get(ruleSetId).processor == trustedProcessor, "untrusted processor");
        uint64 answerBy = uint64(block.timestamp) + answerWindow;
        Case memory c;
        c.ruleSetId = ruleSetId; c.filer = filer; c.decider = decider; c.reviewer = reviewer; c.evidenceHash = evidenceHash; c.agreementId = agreementId;
        c.openedAt = uint64(block.timestamp); c.answerBy = answerBy; c.reviewWindow = reviewWindow; c.filerOkReviewer = filerOk; c.deciderOkReviewer = deciderOk; c.status = Status.Open;
        cases.push(c);
        id = cases.length;
        _emitOpened(id, c);
    }

    function _emitOpened(uint256 id, Case memory c) private {
        emit CaseOpened(id, c.ruleSetId, c.filer.wallet, c.filer.passkey, c.decider.wallet, c.decider.passkey, c.reviewer, c.evidenceHash, c.agreementId, c.answerBy, c.reviewWindow);
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

    /// @dev Wallet path: the caller must be that side's wallet or the helper THAT SIDE named. A passkey side acts only by signature.
    function _walletSide(Case storage c, bool asFiler) private view {
        Party storage p = asFiler ? c.filer : c.decider;
        require(p.wallet != address(0), "this side acts by passkey");
        require(msg.sender == p.wallet || msg.sender == (asFiler ? c.filerOperator : c.deciderOperator), "not allowed");
    }

    /// @dev Passkey path: the side must be a passkey account, and the registry must accept the signed action for this exact payload.
    function _signed(Case storage c, bool asFiler, bytes32 payload, PasskeyRegistry.SigAuth calldata s) private {
        Party storage p = asFiler ? c.filer : c.decider;
        require(p.passkey != 0, "this side is a wallet");
        passkeys.verifyAndBump(p.passkey, payload, s);
    }

    function _record(uint256 id, Case storage c, bool asFiler, uint64 answers, address submitter) private {
        require(c.status == Status.Open, "not open");
        require(block.timestamp <= c.answerBy, "answer deadline passed");
        RuleSetRegistry.RuleSet memory rs = registry.get(c.ruleSetId);
        require(answers & ~_mask(rs.nQuestions) == 0, "answer outside the questions");
        if (asFiler) { require(!c.filerIn, "already answered"); c.filerAnswers = answers; c.filerIn = true; }
        else { require(!c.deciderIn, "already answered"); c.deciderAnswers = answers; c.deciderIn = true; }
        emit AnswersSubmitted(id, asFiler, submitter, answers);
        if (c.filerIn && c.deciderIn) {
            c.disputed = c.filerAnswers ^ c.deciderAnswers;
            if (c.disputed == 0) _finalize(id, c, rs, c.filerAnswers);
            else { c.status = Status.AwaitingReview; c.reviewBy = uint64(block.timestamp) + c.reviewWindow; emit NeedsReview(id, c.disputed, c.reviewBy); }
        }
    }

    function _addEvidence(uint256 id, Case storage c, uint8 role, address by, uint256 passkey, uint8 question, bytes32 hash, string calldata note) private {
        require(block.timestamp <= (c.status == Status.Open ? c.answerBy : c.reviewBy), "deadline passed");
        require(hash != bytes32(0), "empty hash");
        require(bytes(note).length <= MAX_NOTE, "note too long");
        require(evidenceBy[id][role] < (role == 2 ? MAX_EVIDENCE_REVIEWER : MAX_EVIDENCE_PER_SIDE), "too much evidence from this role");
        if (question != WHOLE_CASE) require(question < registry.get(c.ruleSetId).nQuestions, "no such question");
        evidenceBy[id][role]++;
        evidence[id].push(Evidence(by, passkey, question, uint64(block.timestamp), hash, note));
        emit EvidenceAttached(id, question, role, hash);
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
