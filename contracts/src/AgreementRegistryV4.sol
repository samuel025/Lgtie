// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RuleSetRegistry} from "./RuleSetRegistry.sol";
import {PasskeyRegistry} from "./PasskeyRegistry.sol";
import {Party} from "./Party.sol";
import {WebAuthnP256} from "./WebAuthnP256.sol";

/// @title AgreementRegistryV4
/// @notice AgreementRegistryV3 (a passkey can propose, accept and withdraw) plus **agreement cards**: two people each sign the same deal with their
///         passkey, off-chain, with no wallet and no fee, and the card is recorded on-chain only if it is ever needed (a dispute). Anyone may submit
///         a card. It then becomes an agreement already in force, between two passkey accounts that are created at that moment if they do not exist.
///         Holds no funds. Unaudited.
/// @dev What a card commits to: both public keys, the rule set, a fingerprint of the written terms, the reviewer (or none yet: to be agreed if a
///      dispute starts), both time windows, a last day to record it, and a random salt. Each signer's passkey signs that one digest, which also
///      carries the chain and this contract's address, so a card cannot be spent on another chain or registry. A card is recorded at most once.
///      The `Agreement` struct and the reads are identical to V2 and V3, so the existing case contract code works against it unchanged.
contract AgreementRegistryV4 {
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

    struct Terms { uint256 ruleSetId; bytes32 termsHash; address reviewer; uint32 answerWindow; uint32 reviewWindow; uint64 expiry; bytes32 salt; }
    /// One signer of a card: their public key, the handle their account is found by, and their WebAuthn signature over the card digest.
    struct Signer { PasskeyRegistry.Key key; bytes32 handleHash; WebAuthnP256.Assertion assertion; }

    bytes32 private constant CARD = keccak256("LGtie.AgreementCard.v1");
    uint32 public constant MIN_WINDOW = 1 hours;
    uint32 public constant MAX_WINDOW = 90 days;

    RuleSetRegistry public immutable rules;
    PasskeyRegistry public immutable passkeys;
    Agreement[] private list; // id = index + 1
    mapping(bytes32 => uint256) public anchoredAs;   // card digest -> the agreement it became

    event AgreementProposed(uint256 indexed id, address indexed proposer, uint256 proposerPasskey, address counterpartyWallet, uint256 counterpartyPasskey, uint256 ruleSetId, bytes32 termsHash, address reviewer, uint32 answerWindow, uint32 reviewWindow);
    event AgreementAccepted(uint256 indexed id, address submittedBy);
    event AgreementCancelled(uint256 indexed id);
    event CardRecorded(uint256 indexed id, bytes32 indexed digest, uint256 proposerPasskey, uint256 counterpartyPasskey, address submittedBy);

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

    // ---------- agreement cards ----------
    /// @notice The digest both signers' passkeys sign. A page computes this to build the WebAuthn challenge. Order matters: `a` is the first signer.
    function cardDigest(Terms calldata t, PasskeyRegistry.Key calldata a, PasskeyRegistry.Key calldata b) public view returns (bytes32) {
        return keccak256(abi.encode(CARD, block.chainid, address(this), _keyHash(a), _keyHash(b), t.ruleSetId, t.termsHash, t.reviewer, t.answerWindow, t.reviewWindow, t.expiry, t.salt));
    }

    /// @notice Record a card both passkeys signed. The result is an agreement already in force. Anyone may submit it and pays the fee. A signer whose
    ///         account does not exist yet gets one now, under the handle they signed with; if that handle belongs to a different key, this reverts.
    function anchor(Terms calldata t, Signer calldata a, Signer calldata b) external returns (uint256 id) {
        require(block.timestamp <= t.expiry, "the card has expired");
        require(_keyHash(a.key) != _keyHash(b.key), "two different passkeys");
        rules.get(t.ruleSetId); // reverts if the rule set does not exist
        require(t.answerWindow >= MIN_WINDOW && t.answerWindow <= MAX_WINDOW, "answer window 1 hour..90 days");
        require(t.reviewWindow >= MIN_WINDOW && t.reviewWindow <= MAX_WINDOW, "review window 1 hour..90 days");
        bytes32 digest = cardDigest(t, a.key, b.key);
        require(anchoredAs[digest] == 0, "already recorded");
        require(WebAuthnP256.verify(digest, a.assertion, a.key.rpIdHash, a.key.x, a.key.y, true), "first passkey signature is not valid");
        require(WebAuthnP256.verify(digest, b.assertion, b.key.rpIdHash, b.key.x, b.key.y, true), "second passkey signature is not valid");
        id = _store(t, _accountFor(a), _accountFor(b));
        anchoredAs[digest] = id;
        emit CardRecorded(id, digest, list[id - 1].proposer.passkey, list[id - 1].counterparty.passkey, msg.sender);
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
    function _keyHash(PasskeyRegistry.Key calldata k) private pure returns (bytes32) { return keccak256(abi.encode(k.x, k.y, k.rpIdHash)); }

    function _store(Terms calldata t, uint256 pa, uint256 pb) private returns (uint256 id) {
        list.push(Agreement(Party(address(0), pa), Party(address(0), pb), t.ruleSetId, t.termsHash, t.reviewer, t.answerWindow, t.reviewWindow, uint64(block.timestamp), uint64(block.timestamp), false));
        id = list.length;
        emit AgreementProposed(id, address(0), pa, address(0), pb, t.ruleSetId, t.termsHash, t.reviewer, t.answerWindow, t.reviewWindow);
        emit AgreementAccepted(id, msg.sender);
    }

    /// @dev The account for this signer: the one already registered under their handle (it must hold this exact key), or a new one.
    function _accountFor(Signer calldata s) private returns (uint256 acct) {
        acct = passkeys.accountOfHandle(s.handleHash);
        if (acct == 0) return passkeys.create(s.handleHash, s.key);
        uint256 n = passkeys.keyCount(acct);
        for (uint256 i = 0; i < n; i++) {
            PasskeyRegistry.Key memory k = passkeys.keyAt(acct, i);
            if (k.x == s.key.x && k.y == s.key.y && k.rpIdHash == s.key.rpIdHash) return acct;
        }
        revert("that handle belongs to another key");
    }

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
