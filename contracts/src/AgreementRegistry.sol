// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RuleSetRegistry} from "./RuleSetRegistry.sol";

/// @title AgreementRegistry
/// @notice Two parties agree, BEFORE any dispute, on one published rule set, a hash of their written terms, a neutral reviewer and the
///         time limits. Once accepted an agreement can never be changed or cancelled: a change means a new agreement. A later case can
///         be opened under it (TiebreakCaseV3.openFromAgreement), so neither side can swap the rules or the reviewer halfway through.
///         Holds no funds. Unaudited.
contract AgreementRegistry {
    struct Agreement {
        address proposer;
        address counterparty;
        uint256 ruleSetId;
        bytes32 termsHash;      // hash of the written terms kept off-chain by the parties
        address reviewer;       // agreed neutral reviewer for any dispute under this agreement
        uint32 answerWindow;    // seconds each side has to answer once a case is opened
        uint32 reviewWindow;    // seconds the reviewer has once answers are in
        uint64 proposedAt;
        uint64 acceptedAt;      // 0 until the counterparty accepts
        bool cancelled;         // only possible before acceptance
    }

    uint32 public constant MIN_WINDOW = 1 hours;
    uint32 public constant MAX_WINDOW = 90 days;

    RuleSetRegistry public immutable rules;
    Agreement[] private list; // id = index + 1

    event AgreementProposed(uint256 indexed id, address indexed proposer, address indexed counterparty, uint256 ruleSetId, bytes32 termsHash, address reviewer, uint32 answerWindow, uint32 reviewWindow);
    event AgreementAccepted(uint256 indexed id, address by);
    event AgreementCancelled(uint256 indexed id);

    constructor(RuleSetRegistry r) { rules = r; }

    function propose(address counterparty, uint256 ruleSetId, bytes32 termsHash, address reviewer, uint32 answerWindow, uint32 reviewWindow) external returns (uint256 id) {
        rules.get(ruleSetId); // reverts if the rule set does not exist
        require(counterparty != address(0) && counterparty != msg.sender, "bad counterparty");
        require(reviewer != address(0) && reviewer != msg.sender && reviewer != counterparty, "reviewer must be neutral");
        require(answerWindow >= MIN_WINDOW && answerWindow <= MAX_WINDOW, "answer window 1 hour..90 days");
        require(reviewWindow >= MIN_WINDOW && reviewWindow <= MAX_WINDOW, "review window 1 hour..90 days");
        list.push(Agreement(msg.sender, counterparty, ruleSetId, termsHash, reviewer, answerWindow, reviewWindow, uint64(block.timestamp), 0, false));
        id = list.length;
        emit AgreementProposed(id, msg.sender, counterparty, ruleSetId, termsHash, reviewer, answerWindow, reviewWindow);
    }

    /// @notice The counterparty accepts everything as proposed. From now on nothing in the agreement can change.
    function accept(uint256 id) external {
        Agreement storage a = _get(id);
        require(msg.sender == a.counterparty, "only the counterparty");
        require(a.acceptedAt == 0 && !a.cancelled, "not open for acceptance");
        a.acceptedAt = uint64(block.timestamp);
        emit AgreementAccepted(id, msg.sender);
    }

    /// @notice The proposer can withdraw a proposal that has not been accepted.
    function cancel(uint256 id) external {
        Agreement storage a = _get(id);
        require(msg.sender == a.proposer, "only the proposer");
        require(a.acceptedAt == 0 && !a.cancelled, "not open for cancellation");
        a.cancelled = true;
        emit AgreementCancelled(id);
    }

    function get(uint256 id) external view returns (Agreement memory) { return _get(id); }
    function count() external view returns (uint256) { return list.length; }
    function inForce(uint256 id) external view returns (bool) { Agreement storage a = _get(id); return a.acceptedAt != 0 && !a.cancelled; }

    function _get(uint256 id) private view returns (Agreement storage) {
        require(id >= 1 && id <= list.length, "unknown agreement");
        return list[id - 1];
    }
}
