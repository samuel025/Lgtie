// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Stand-in dollar token for tests (6 decimals). `returnsNothing` makes it behave like the older tokens that return no value.
contract MockUSD {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public returnsNothing;
    uint8 public constant decimals = 6;
    string public symbol = "mUSD";
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address sp, uint256 a) external returns (bool) { allowance[msg.sender][sp] = a; return true; }
    function setReturnsNothing(bool v) external { returnsNothing = v; }
    function transferFrom(address from, address to, uint256 a) external returns (bool) {
        require(balanceOf[from] >= a, "balance"); require(allowance[from][msg.sender] >= a, "allowance");
        allowance[from][msg.sender] -= a; balanceOf[from] -= a; balanceOf[to] += a;
        if (returnsNothing) assembly { return(0, 0) }
        return true;
    }
}
