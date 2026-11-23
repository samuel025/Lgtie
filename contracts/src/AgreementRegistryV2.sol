// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RuleSetRegistry} from "./RuleSetRegistry.sol";
import {PasskeyRegistry} from "./PasskeyRegistry.sol";
import {Party} from "./Party.sol";

/// @title AgreementRegistryV2
/// @notice Like AgreementRegistry, but the counterparty may be a passkey account instead of a wallet. A passkey counterparty accepts with
///         a signature over the exact terms; anyone may submit it. The proposer is a wallet. Once accepted, nothing can change. Holds no funds.
///         Unaudited.
contract AgreementRegistryV2 {
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

    event AgreementProposed(uint256 indexed id, address indexed proposer, address counterpartyWallet, uint256 counterpartyPasskey, uint256 ruleSetId, bytes32 termsHash, address reviewer, uint32 answerWindow, uint32 reviewWindow);
    event AgreementAccepted(uint256 indexed id, address submittedBy);
    event AgreementCancelled(uint256 indexed id);

    constructor(RuleSetRegistry r, PasskeyRegistry p) { rules = r; passkeys = p; }

    function propose(Party calldata counterparty, uint256 ruleSetId, bytes32 termsHash, address reviewer, uint32 answerWindow, uint32 reviewWindow) external returns (uint256 id) {
        rules.get(ruleSetId); // reverts if the rule set does not exist
        require((counterparty.wallet != address(0)) != (counterparty.passkey != 0), "counterparty is a wallet or a passkey account");
        if (counterparty.passkey != 0) require(passkeys.exists(counterparty.passkey), "unknown passkey account");
        require(counterparty.wallet != msg.sender, "bad counterparty");
        require(reviewer != address(0) && reviewer != msg.sender && reviewer != counterparty.wallet, "reviewer must be neutral");
        require(answerWindow >= MIN_WINDOW && answerWindow <= MAX_WINDOW, "answer window 1 hour..90 days");
        require(reviewWindow >= MIN_WINDOW && reviewWindow <= MAX_WINDOW, "review window 1 hour..90 days");
        list.push(Agreement(Party(msg.sender, 0), counterparty, ruleSetId, termsHash, reviewer, answerWindow, reviewWindow, uint64(block.timestamp), 0, false));
        id = list.length;
        emit AgreementProposed(id, msg.sender, counterparty.wallet, counterparty.passkey, ruleSetId, termsHash, reviewer, answerWindow, reviewWindow);
    }

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

    /// @notice The proposer can withdraw a proposal that has not been accepted.
    function cancel(uint256 id) external {
        Agreement storage a = _get(id);
        require(msg.sender == a.proposer.wallet, "only the proposer");
        require(a.acceptedAt == 0 && !a.cancelled, "not open for cancellation");
        a.cancelled = true;
        emit AgreementCancelled(id);
    }

    /// @notice A hash of every term, which a passkey owner signs when accepting.
    function termsDigest(Agreement storage a) private view returns (bytes32) {
        return keccak256(abi.encode(a.proposer, a.counterparty, a.ruleSetId, a.termsHash, a.reviewer, a.answerWindow, a.reviewWindow));
    }
    function termsDigestOf(uint256 id) external view returns (bytes32) { return termsDigest(_get(id)); }

    function get(uint256 id) external view returns (Agreement memory) { return _get(id); }
    function count() external view returns (uint256) { return list.length; }
    function inForce(uint256 id) external view returns (bool) { Agreement storage a = _get(id); return a.acceptedAt != 0 && !a.cancelled; }

    function _accept(uint256 id, Agreement storage a) private {
        require(a.acceptedAt == 0 && !a.cancelled, "not open for acceptance");
        a.acceptedAt = uint64(block.timestamp);
        emit AgreementAccepted(id, msg.sender);
    }
    function _get(uint256 id) private view returns (Agreement storage) {
        require(id >= 1 && id <= list.length, "unknown agreement");
        return list[id - 1];
    }
}
