// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The part of a TapeOut processor Tiebreak uses: read-only eval and circuit shape.
interface IProcessor {
    function eval(uint256 id, bytes calldata input) external view returns (bytes memory);
    function circuitInfo(uint256 id) external view returns (uint256 nIn, uint256 nOut);
}

/// @title RuleSetRegistry
/// @notice Public list of published rule sets. A rule set is a decision table taped out as a TapeOut circuit plus the hash of
///         the document that defines what each yes/no question means. Entries never change; a new version is a new entry that
///         points at the previous one. Holds no funds. Unaudited.
contract RuleSetRegistry {
    struct RuleSet {
        address publisher;       // who registered it (not proof of who the business is; the business's own page should link the id)
        address processor;       // TapeOut processor holding the circuit
        uint256 circuitId;
        uint8 nQuestions;        // circuit inputs: one yes/no answer each, input k = bit k of the answers
        uint8 nResultBits;       // circuit outputs: the result code
        bytes32 definitionsHash; // hash of the definitions document (question wording, evidence rules, result meanings)
        uint256 previousId;      // 0, or the rule set this one replaces
        uint64 publishedAt;
        string name;
    }

    RuleSet[] private sets; // id = index + 1

    event RuleSetPublished(uint256 indexed id, address indexed publisher, address processor, uint256 circuitId, bytes32 definitionsHash, uint256 previousId, string name);

    function publish(address processor, uint256 circuitId, uint8 nQuestions, uint8 nResultBits, bytes32 definitionsHash, uint256 previousId, string calldata name)
        external returns (uint256 id)
    {
        require(nQuestions > 0 && nQuestions <= 64, "questions 1..64");
        require(nResultBits > 0 && nResultBits <= 8, "result bits 1..8");
        require(bytes(name).length > 0 && bytes(name).length <= 80, "name 1..80 bytes");
        (uint256 nIn, uint256 nOut) = IProcessor(processor).circuitInfo(circuitId); // reverts if the circuit does not exist
        require(nIn == nQuestions && nOut == nResultBits, "circuit shape");
        if (previousId != 0) {
            require(previousId <= sets.length, "unknown previous");
            require(sets[previousId - 1].publisher == msg.sender, "not the previous publisher");
        }
        sets.push(RuleSet(msg.sender, processor, circuitId, nQuestions, nResultBits, definitionsHash, previousId, uint64(block.timestamp), name));
        id = sets.length;
        emit RuleSetPublished(id, msg.sender, processor, circuitId, definitionsHash, previousId, name);
    }

    function get(uint256 id) external view returns (RuleSet memory) {
        require(id >= 1 && id <= sets.length, "unknown rule set");
        return sets[id - 1];
    }

    function count() external view returns (uint256) { return sets.length; }
}
