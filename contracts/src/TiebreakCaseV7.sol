// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RuleSetRegistry, IProcessor} from "./RuleSetRegistry.sol";
import {AgreementRegistryV2} from "./AgreementRegistryV2.sol";
import {PasskeyRegistry} from "./PasskeyRegistry.sol";
import {IVerdictSource} from "./IVerdictSource.sol";
import {Party} from "./Party.sol";
import {LGtieBilling} from "./LGtieBilling.sol";
import {FactSpecRegistry} from "./FactSpecRegistry.sol";

/// @title TiebreakCaseV7
/// @notice Both sides answer the same yes/no questions of a published rule set. Where they agree the answer stands; only the disputed
///         questions go to a reviewer; the rule set's circuit computes the result. Every stage has a deadline and an unfinished case
///         ends as Expired ("no decision"), never deciding by default. Holds no funds. Unaudited.
/// @dev V7 is V6 plus a reviewer who can be agreed LATER. An agreement (an agreement card recorded by AgreementRegistryV4) may leave the reviewer
///      empty. A case under it then starts with no reviewer, and the two sides agree on one after the dispute begins: either side proposes (their own
///      approval is implied) and the other approves, by wallet or by passkey signature. No decision can be made until both have approved, and a case
///      with no agreed reviewer by its review deadline ends as Expired, never deciding by default. An agreement that DID name a reviewer still fixes it.
///      V6 is V5 plus automatic questions (docs/AUTO-QUESTIONS.md): questions the rule set's publisher marked in FactSpecRegistry are answered by
///      this contract, not by the parties. They are never disputed and a reviewer cannot change them. Facts from the case opening (kinds 2 and 3) are
///      fixed when the case opens; evidence-timing facts (kind 1) are fixed the moment both sides have answered. A rule set with no spec behaves exactly
///      like V5. A failing on-chain read leaves that question to the parties.
///      V5 is V4 plus billing: opening a case calls `billing.charge(business, payer)`. A business with an active subscription that still has
///      cases left in its monthly allowance pays nothing more; otherwise the caller of the opening transaction pays the small per-case fee, which
///      goes straight to the treasury in the same transaction (this contract and the billing contract never hold funds). Nothing else changed from
///      V4, so a business that does not pay cannot stop a customer from opening a case: the customer, or whoever submits for them, can always pay.
///      Changes from V3 (all kept in V4 and V5):
///      1. A side can be a passkey account. It acts by signed message (`submitSigned`, `attachEvidenceSigned`, `openFromAgreementSigned`),
///         which anyone may submit, so a business can pay the fee for a customer who has no wallet. Passkey sides exist only under an
///         agreement, so the reviewer was fixed and accepted in advance.
///      2. F1 fixed: a case under an agreement cannot get a different reviewer.
///      3. F2 addressed in the data: `reviewerAcked` records whether the reviewer ever took part, so a record can tell "never involved"
///         from "accepted and did not decide".
///      4. F3 fixed: evidence is capped per role (filer, decider, reviewer), so one side cannot use up every slot.
///      5. F4 fixed: only rule sets on the trusted processor can be used.
contract TiebreakCaseV7 is IVerdictSource {
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
        uint64 autoMask;           // questions answered by the contract
        uint64 autoBits;           // and their answers
        uint64 evMask;             // evidence-timing questions still to be worked out when both sides have answered
        Status status;
    }

    struct Evidence { address by; uint256 passkey; uint8 question; uint64 at; bytes32 hash; string note; uint8 role; }

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
    LGtieBilling public immutable billing;
    FactSpecRegistry public immutable facts;
    uint256 public constant READ_GAS = 100000;
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
    event AutoAnswered(uint256 indexed id, uint64 mask, uint64 bits);

    constructor(RuleSetRegistry r, AgreementRegistryV2 a, PasskeyRegistry p, address processor, LGtieBilling b, FactSpecRegistry f) {
        registry = r; agreements = a; passkeys = p; trustedProcessor = processor; billing = b; facts = f;
    }

    // ---------- opening ----------
    /// @notice Opens a case between two wallets without an agreement. The caller is the filer; `reviewer` is only a proposal until the decider accepts.
    function open(uint256 ruleSetId, address decider, address reviewer, bytes32 evidenceHash, uint32 answerWindow, uint32 reviewWindow) external returns (uint256 id) {
        require(decider != address(0) && reviewer != address(0), "zero party");
        require(msg.sender != decider, "filer and decider must differ");
        require(reviewer != msg.sender && reviewer != decider, "reviewer must be neutral");
        _windows(answerWindow, reviewWindow);
        billing.charge(msg.sender, msg.sender);
        id = _push(ruleSetId, Party(msg.sender, 0), Party(decider, 0), reviewer, evidenceHash, 0, answerWindow, reviewWindow, true, false);
    }

    /// @notice A wallet party opens a case under an accepted agreement. The other party (wallet or passkey) becomes the decider.
    function openFromAgreement(uint256 agreementId, bytes32 evidenceHash) external returns (uint256 id) {
        AgreementRegistryV2.Agreement memory a = _inForce(agreementId);
        bool isProposer = a.proposer.wallet != address(0) && msg.sender == a.proposer.wallet;
        bool isCounter = a.counterparty.wallet != address(0) && msg.sender == a.counterparty.wallet;
        require(isProposer || isCounter, "not a party to the agreement");
        (Party memory me, Party memory other) = isProposer ? (a.proposer, a.counterparty) : (a.counterparty, a.proposer);
        billing.charge(a.proposer.wallet, msg.sender);
        id = _push(a.ruleSetId, me, other, a.reviewer, evidenceHash, agreementId, a.answerWindow, a.reviewWindow, a.reviewer != address(0), a.reviewer != address(0));
    }

    /// @notice A passkey party opens a case under an accepted agreement, by signature (anyone may submit it).
    function openFromAgreementSigned(uint256 agreementId, bytes32 evidenceHash, bool asProposer, PasskeyRegistry.SigAuth calldata s) external returns (uint256 id) {
        AgreementRegistryV2.Agreement memory a = _inForce(agreementId);
        (Party memory me, Party memory other) = asProposer ? (a.proposer, a.counterparty) : (a.counterparty, a.proposer);
        require(me.passkey != 0, "that party is a wallet");
        passkeys.verifyAndBump(me.passkey, keccak256(abi.encode("OPEN_CASE", agreementId, evidenceHash, asProposer)), s);
        billing.charge(a.proposer.wallet, msg.sender);
        id = _push(a.ruleSetId, me, other, a.reviewer, evidenceHash, agreementId, a.answerWindow, a.reviewWindow, a.reviewer != address(0), a.reviewer != address(0));
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
        require(c.reviewer != address(0), "no reviewer has been proposed");
        if (asFiler) c.filerOkReviewer = true; else c.deciderOkReviewer = true;
        emit ReviewerApproved(id, msg.sender, asFiler);
    }

    /// @notice For cases without an agreement, or whose agreement left the reviewer open. An agreement that named a reviewer fixes it.
    function proposeReviewer(uint256 id, bool asFiler, address newReviewer) external {
        Case storage c = _live(id); _walletSide(c, asFiler);
        _propose(id, c, asFiler, newReviewer, msg.sender);
    }

    /// @notice A passkey side proposes a reviewer by signature (anyone may submit it). Only when no reviewer was fixed in advance.
    function proposeReviewerSigned(uint256 id, bool asFiler, address newReviewer, PasskeyRegistry.SigAuth calldata s) external {
        Case storage c = _live(id);
        _signed(c, asFiler, keccak256(abi.encode("PROPOSE_REVIEWER", id, asFiler, newReviewer)), s);
        _propose(id, c, asFiler, newReviewer, msg.sender);
    }

    /// @notice A passkey side approves the reviewer now named on the case. The signed action names that reviewer, so it cannot be spent on a later one.
    function approveReviewerSigned(uint256 id, bool asFiler, PasskeyRegistry.SigAuth calldata s) external {
        Case storage c = _live(id);
        require(c.reviewer != address(0), "no reviewer has been proposed");
        _signed(c, asFiler, keccak256(abi.encode("APPROVE_REVIEWER", id, asFiler, c.reviewer)), s);
        if (asFiler) c.filerOkReviewer = true; else c.deciderOkReviewer = true;
        emit ReviewerApproved(id, msg.sender, asFiler);
    }

    function _propose(uint256 id, Case storage c, bool asFiler, address newReviewer, address by) private {
        require(c.agreementId == 0 || agreements.get(c.agreementId).reviewer == address(0), "the agreement fixed the reviewer");
        require(newReviewer != address(0) && newReviewer != c.filer.wallet && newReviewer != c.decider.wallet, "reviewer must be neutral");
        require(newReviewer != c.filerOperator && newReviewer != c.deciderOperator, "the reviewer cannot be a helper");
        c.reviewer = newReviewer; c.filerOkReviewer = asFiler; c.deciderOkReviewer = !asFiler; c.reviewerAcked = false;
        emit ReviewerProposed(id, by, newReviewer);
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
        uint64 fin = _fixed(c) | (reviewedAnswers & c.disputed);
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
        _openFacts(c);
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
            _evidenceFacts(id, c);
            c.disputed = (c.filerAnswers ^ c.deciderAnswers) & ~c.autoMask;
            if (c.disputed == 0) _finalize(id, c, rs, _fixed(c));
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
        evidence[id].push(Evidence(by, passkey, question, uint64(block.timestamp), hash, note, role));
        emit EvidenceAttached(id, question, role, hash);
    }

    function _finalize(uint256 id, Case storage c, RuleSetRegistry.RuleSet memory rs, uint64 fin) private {
        c.finalAnswers = fin;
        c.result = _eval(rs, fin);
        c.status = Status.Final;
        emit Finalized(id, fin, c.result, c.disputed);
    }

    /// @dev The answers that are settled without the reviewer: what both sides agree on, with the contract's answers on automatic questions.
    function _fixed(Case storage c) private view returns (uint64) {
        return (c.filerAnswers & ~c.disputed & ~c.autoMask) | c.autoBits;
    }

    /// @dev At opening: apply the spec only if it was written before the agreement was accepted (or before the case opened, with no agreement).
    function _openFacts(Case memory c) private view {
        (FactSpecRegistry.Spec[] memory list, uint64 writtenAt) = facts.get(c.ruleSetId);
        if (list.length == 0) return;
        uint64 cutoff = c.agreementId == 0 ? c.openedAt : agreements.get(c.agreementId).acceptedAt;
        if (writtenAt > cutoff) return;
        for (uint256 i = 0; i < list.length; i++) {
            FactSpecRegistry.Spec memory s = list[i];
            uint64 bit = uint64(1) << s.q;
            if (s.kind == 1) c.evMask |= bit;
            else if (s.kind == 2) { c.autoMask |= bit; if (c.openedAt <= s.deadline) c.autoBits |= bit; }
            else {
                (bool ok, uint256 v) = _read(s.target, s.data);
                if (!ok) continue;   // the source failed: this question stays with the parties
                c.autoMask |= bit;
                if (s.cmp == 1 ? v >= s.threshold : v == s.threshold) c.autoBits |= bit;
            }
        }
    }

    /// @dev One static call, gas-capped, reading only the first word of the answer so a hostile source cannot make this expensive.
    function _read(address target, bytes memory data) private view returns (bool ok, uint256 v) {
        if (target.code.length == 0) return (false, 0);
        uint256 gasCap = READ_GAS;
        assembly {
            ok := staticcall(gasCap, target, add(data, 32), mload(data), 0, 0)
            if lt(returndatasize(), 32) { ok := 0 }
            if ok { returndatacopy(0, 0, 32) v := mload(0) }
        }
    }

    /// @dev When both sides have answered: work out the evidence-timing questions from the evidence recorded so far, and fix them.
    function _evidenceFacts(uint256 id, Case storage c) private {
        if (c.evMask != 0) {
            (FactSpecRegistry.Spec[] memory list,) = facts.get(c.ruleSetId);
            Evidence[] storage ev = evidence[id];
            for (uint256 i = 0; i < list.length; i++) {
                FactSpecRegistry.Spec memory s = list[i];
                if (s.kind != 1) continue;
                uint64 bit = uint64(1) << s.q; uint64 limit = c.openedAt + s.withinSeconds;
                c.autoMask |= bit;
                for (uint256 j = 0; j < ev.length; j++) {
                    if (ev[j].role == s.role && ev[j].question == s.question && ev[j].at <= limit) { c.autoBits |= bit; break; }
                }
            }
            c.evMask = 0;
        }
        if (c.autoMask != 0) emit AutoAnswered(id, c.autoMask, c.autoBits);
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
