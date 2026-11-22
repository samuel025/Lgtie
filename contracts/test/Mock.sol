// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Stand-in processor for unit tests: circuit 1 is the warranty rule set (7 inputs, 2 outputs), same logic as the compiled circuit.
contract MockProcessor {
    function circuitInfo(uint256 id) external pure returns (uint256, uint256) {
        require(id == 1, "no circuit");
        return (7, 2);
    }
    function eval(uint256 id, bytes calldata input) external pure returns (bytes memory) {
        require(id == 1, "no circuit");
        uint8 b = uint8(input[0]);
        bool q1 = b & 1 != 0; bool q2 = b & 2 != 0; bool q3 = b & 4 != 0; bool q4 = b & 8 != 0; bool q5 = b & 16 != 0; bool q6 = b & 32 != 0; bool q7 = b & 64 != 0;
        uint8 r = 0;
        if (q1 && q2 && q4 && q5 && q7) r = !q3 ? 1 : (!q6 ? 2 : 3);
        return abi.encodePacked(r);
    }
}
