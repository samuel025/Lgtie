// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "forge-std/Test.sol";
interface IProc { function eval(uint256 id, bytes calldata input) external view returns (bytes memory); function circuitInfo(uint256 id) external view returns (uint256 nIn, uint256 nOut); function ownerOf(uint256 id) external view returns (address); }
contract Caller { function ev(address p, uint256 id, bytes calldata i) external view returns (bytes memory) { return IProc(p).eval(id, i); } }
contract Spike is Test {
  address constant P = 0x9e2849c04A513FE64db07521cBE52d078d905c0E;
  function test_spike() public {
    vm.createSelectFork("https://rpc.xlayer.tech");
    Caller c = new Caller();
    uint256 maxIn; uint256 maxOut; uint256 maxId;
    for (uint256 id = 1; id <= 16; id++) {
      try IProc(P).circuitInfo(id) returns (uint256 a, uint256 b) { if (a > maxIn) maxIn = a; if (b > maxOut) maxOut = b; maxId = id; console.log("circuit", id, "nIn", a); console.log("  nOut", b); } catch {}
    }
    console.log("scanned up to", maxId); console.log("max nIn", maxIn); console.log("max nOut", maxOut);
    uint256 g0 = gasleft();
    bytes memory o = c.ev(P, 8, hex"00");
    uint256 used = g0 - gasleft();
    console.log("eval(#8, 0x00) via contract -> ", o.length); console.log("gas used", used);
    bytes memory o2 = c.ev(P, 8, hex"01"); console.log("eval(#8, 0x01) out byte", uint8(o2[0]));
    console.log("eval(#8, 0x00) out byte", uint8(o[0]));
  }
}
