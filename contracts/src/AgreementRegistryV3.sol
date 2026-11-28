// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RuleSetRegistry} from "./RuleSetRegistry.sol";
import {PasskeyRegistry} from "./PasskeyRegistry.sol";
import {Party} from "./Party.sol";

/// @title AgreementRegistryV3
/// @notice Like AgreementRegistryV2, but the person who PROPOSES can also be a passkey account: they sign the exact terms and anyone may submit the
///         signed proposal (so a freelancer or seller with no wallet can start a deal, with a friend, a marketplace or the other side submitting it).
///         The counterparty is a wallet or a passkey account, as before, and accepts the same way. Once accepted, nothing can change. Holds no funds.
///         Unaudited.
/// @dev The `Agreement` struct and the reads (`get`, `count`, `inForce`, `termsDigestOf`) are byte-for-byte the same as in AgreementRegistryV2, so the
///      existing TiebreakCaseV6 code can be deployed again pointing at this registry, with no new case contract. Who pays the network fee is not decided
///      here: a passkey can sign but not send, so whoever submits pays.
contract AgreementRegistryV3 {
    struct Agreement {
        Party proposer;
        Party counterparty;
        uint256 ruleSetId;
        bytes32 termsHash;
        address reviewer;
        uint32 answerWindow;
        uint32 reviewWindow;
        uint64 proposedAt;
        uint64 acceptedAt;
        bool cancelled;
    }

    uint32 public constant MIN_WINDOW = 1 hours;
    uint32 public constant MAX_WINDOW = 90 days;

    RuleSetRegistry public immutable rules;
    PasskeyRegistry public immutable passkeys;
    Agreement[] private list; // id = index + 1

    event AgreementProposed(uint256 indexed id, address indexed proposer, uint256 proposerPasskey, address counterpartyWallet, uint256 counterpartyPasskey, uint256 ruleSetId, bytes32 termsHash, address reviewer, uint32 answerWindow, uint32 reviewWindow);
    event AgreementAccepted(uint256 indexed id, address submittedBy);
    event AgreementCancelled(uint256 indexed id);

    constructor(RuleSetRegistry r, PasskeyRegistry p) { rules = r; passkeys = p; }

    // ---------- proposing ----------
    /// @notice A wallet proposes. Same as AgreementRegistryV2.
    function propose(Party calldata counterparty, uint256 ruleSetId, bytes32 termsHash, address reviewer, uint32 answerWindow, uint32 reviewWindow) external returns (uint256 id) {
        require(counterparty.wallet != msg.sender, "bad counterparty");
        require(reviewer != msg.sender, "reviewer must be neutral");
        id = _add(Party(msg.sender, 0), counterparty, ruleSetId, termsHash, reviewer, answerWindow, reviewWindow);
    }

    /// @notice A passkey account proposes, by signature over every term. Anyone may submit it. The signed action is bound to the exact terms
    ///         and to this contract, and its nonce is used up, so it cannot be changed or replayed.
    function proposeSigned(uint256 proposerPasskey, Party calldata counterparty, uint256 ruleSetId, bytes32 termsHash, address reviewer, uint32 answerWindow, uint32 reviewWindow, PasskeyRegistry.SigAuth calldata s) external returns (uint256 id) {
        require(proposerPasskey != 0 && passkeys.exists(proposerPasskey), "unknown passkey account");
        require(counterparty.passkey != proposerPasskey, "bad counterparty");
        id = _add(Party(address(0), proposerPasskey), counterparty, ruleSetId, termsHash, reviewer, answerWindow, reviewWindow);
        passkeys.verifyAndBump(proposerPasskey, keccak256(abi.encode("PROPOSE_AGREEMENT", proposerPasskey, counterparty, ruleSetId, termsHash, reviewer, answerWindow, reviewWindow)), s);
    }

    // ---------- accepting and withdrawing ----------
    /// @notice A wallet counterparty accepts everything as proposed.
    function accept(uint256 id) external {
        Agreement storage a = _get(id);
        require(a.counterparty.wallet != address(0) && msg.sender == a.counterparty.wallet, "only the counterparty");
        _accept(id, a);
    }

    /// @notice A passkey counterparty accepts by signature. The signed action is bound to every term, so nothing can be swapped.
    function acceptSigned(uint256 id, PasskeyRegistry.SigAuth calldata s) external {
        Agreement storage a = _get(id);
        require(a.counterparty.passkey != 0, "the counterparty is a wallet");
        require(a.acceptedAt == 0 && !a.cancelled, "not open for acceptance");
        passkeys.verifyAndBump(a.counterparty.passkey, keccak256(abi.encode("ACCEPT_AGREEMENT", id, termsDigest(a))), s);
        _accept(id, a);
    }

    /// @notice A wallet proposer can withdraw a proposal that has not been accepted.
    function cancel(uint256 id) external {
        Agreement storage a = _get(id);
        require(a.proposer.wallet != address(0) && msg.sender == a.proposer.wallet, "only the proposer");
        _cancel(id, a);
    }

    /// @notice A passkey proposer withdraws a proposal that has not been accepted, by signature.
    function cancelSigned(uint256 id, PasskeyRegistry.SigAuth calldata s) external {
        Agreement storage a = _get(id);
        require(a.proposer.passkey != 0, "the proposer is a wallet");
        require(a.acceptedAt == 0 && !a.cancelled, "not open for cancellation");
        passkeys.verifyAndBump(a.proposer.passkey, keccak256(abi.encode("CANCEL_AGREEMENT", id)), s);
        _cancel(id, a);
    }

    // ---------- reads ----------
    /// @notice A hash of every term, which a passkey owner signs when accepting.
    function termsDigest(Agreement storage a) private view returns (bytes32) {
        return keccak256(abi.encode(a.proposer, a.counterparty, a.ruleSetId, a.termsHash, a.reviewer, a.answerWindow, a.reviewWindow));
    }
    function termsDigestOf(uint256 id) external view returns (bytes32) { return termsDigest(_get(id)); }

    function get(uint256 id) external view returns (Agreement memory) { return _get(id); }
    function count() external view returns (uint256) { return list.length; }
    function inForce(uint256 id) external view returns (bool) { Agreement storage a = _get(id); return a.acceptedAt != 0 && !a.cancelled; }

    // ---------- internals ----------
    function _add(Party memory proposer, Party calldata counterparty, uint256 ruleSetId, bytes32 termsHash, address reviewer, uint32 answerWindow, uint32 reviewWindow) private returns (uint256 id) {
        rules.get(ruleSetId); // reverts if the rule set does not exist
        require((counterparty.wallet != address(0)) != (counterparty.passkey != 0), "counterparty is a wallet or a passkey account");
        if (counterparty.passkey != 0) require(passkeys.exists(counterparty.passkey), "unknown passkey account");
        require(reviewer != address(0) && reviewer != counterparty.wallet && reviewer != proposer.wallet, "reviewer must be neutral");
        require(answerWindow >= MIN_WINDOW && answerWindow <= MAX_WINDOW, "answer window 1 hour..90 days");
        require(reviewWindow >= MIN_WINDOW && reviewWindow <= MAX_WINDOW, "review window 1 hour..90 days");
        list.push(Agreement(proposer, counterparty, ruleSetId, termsHash, reviewer, answerWindow, reviewWindow, uint64(block.timestamp), 0, false));
        id = list.length;
        emit AgreementProposed(id, proposer.wallet, proposer.passkey, counterparty.wallet, counterparty.passkey, ruleSetId, termsHash, reviewer, answerWindow, reviewWindow);
    }
    function _accept(uint256 id, Agreement storage a) private {
        require(a.acceptedAt == 0 && !a.cancelled, "not open for acceptance");
        a.acceptedAt = uint64(block.timestamp);
        emit AgreementAccepted(id, msg.sender);
    }
    function _cancel(uint256 id, Agreement storage a) private {
        require(a.acceptedAt == 0 && !a.cancelled, "not open for cancellation");
        a.cancelled = true;
        emit AgreementCancelled(id);
    }
    function _get(uint256 id) private view returns (Agreement storage) {
        require(id >= 1 && id <= list.length, "unknown agreement");
        return list[id - 1];
    }
}
