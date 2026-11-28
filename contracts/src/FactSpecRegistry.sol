// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RuleSetRegistry} from "./RuleSetRegistry.sol";

/// @title FactSpecRegistry
/// @notice For a published rule set, says which questions are answered by the chain instead of by the parties, and how (docs/AUTO-QUESTIONS.md).
///         The rule set's publisher can write the list once. The case contract applies it to a case only if it was written before the agreement
///         was accepted (or before the case was opened, with no agreement), so published rules cannot change under a signed agreement.
///         Holds no funds. Unaudited.
/// @dev Kinds: 1 EVIDENCE_BY (the role attached evidence for `question` within `withinSeconds` of the case opening), 2 OPENED_BEFORE (the case was
///      opened at or before `deadline`), 3 READ_AT_LEAST (one static call to `target` with `data`; its first word is compared to `threshold`).
///      Every limit is in the code: at most MAX_SPECS entries, one per question, time limits 1 hour to 90 days, call data at most 100 bytes.
contract FactSpecRegistry {
    struct Spec {
        uint8 kind;
        uint8 q;               // the question this answers
        uint8 role;            // kind 1: 0 filer, 1 decider
        uint8 question;        // kind 1: the question the evidence is attached to (255 = the whole case)
        uint32 withinSeconds;  // kind 1
        uint64 deadline;       // kind 2
        address target;        // kind 3
        uint8 cmp;             // kind 3: 1 at least, 2 equal
        uint256 threshold;     // kind 3
        bytes data;            // kind 3: the call, a 4-byte selector then arguments
    }

    uint8 public constant EVIDENCE_BY = 1;
    uint8 public constant OPENED_BEFORE = 2;
    uint8 public constant READ_AT_LEAST = 3;
    uint8 public constant MAX_SPECS = 8;
    uint8 public constant WHOLE_CASE = 255;
    uint32 public constant MIN_SECONDS = 1 hours;
    uint32 public constant MAX_SECONDS = 90 days;
    uint256 public constant MAX_DATA = 100;

    RuleSetRegistry public immutable rules;
    mapping(uint256 => Spec[]) private specs;
    mapping(uint256 => uint64) public setAt;   // 0 = no spec

    event SpecSet(uint256 indexed ruleSetId, address indexed by, uint256 count);

    constructor(RuleSetRegistry r) { rules = r; }

    function set(uint256 ruleSetId, Spec[] calldata list) external {
        RuleSetRegistry.RuleSet memory rs = rules.get(ruleSetId);
        require(msg.sender == rs.publisher, "only the publisher");
        require(setAt[ruleSetId] == 0, "already set");
        require(list.length >= 1 && list.length <= MAX_SPECS, "1 to 8 automatic questions");
        uint256 seen;
        for (uint256 i = 0; i < list.length; i++) {
            Spec calldata s = list[i];
            require(s.q < rs.nQuestions, "no such question");
            require(seen & (1 << s.q) == 0, "question already automatic");
            seen |= 1 << s.q;
            if (s.kind == EVIDENCE_BY) {
                require(s.role <= 1, "role must be 0 or 1");
                require(s.question < rs.nQuestions || s.question == WHOLE_CASE, "evidence for a real question");
                require(s.withinSeconds >= MIN_SECONDS && s.withinSeconds <= MAX_SECONDS, "time limit 1 hour to 90 days");
            } else if (s.kind == OPENED_BEFORE) {
                require(s.deadline != 0, "no deadline");
            } else if (s.kind == READ_AT_LEAST) {
                require(s.target != address(0), "no source");
                require(s.data.length >= 4 && s.data.length <= MAX_DATA, "call data 4 to 100 bytes");
                require(s.cmp == 1 || s.cmp == 2, "comparison 1 or 2");
            } else revert("unknown kind");
            specs[ruleSetId].push(s);
        }
        setAt[ruleSetId] = uint64(block.timestamp);
        emit SpecSet(ruleSetId, msg.sender, list.length);
    }

    function get(uint256 ruleSetId) external view returns (Spec[] memory list, uint64 writtenAt) {
        return (specs[ruleSetId], setAt[ruleSetId]);
    }
}
