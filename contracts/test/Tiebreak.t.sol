// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {RuleSetRegistry} from "../src/RuleSetRegistry.sol";
import {TiebreakCase} from "../src/TiebreakCase.sol";
import {MockProcessor} from "./Mock.sol";

contract TiebreakTest is Test {
    RuleSetRegistry reg; TiebreakCase tc; MockProcessor proc;
    address publisher = makeAddr("publisher"); address filer = makeAddr("filer"); address decider = makeAddr("decider");
    address reviewer = makeAddr("reviewer"); address operator = makeAddr("operator"); address stranger = makeAddr("stranger");
    uint64 constant ALL_YES = 0x7f;   // Q1..Q7 all yes
    uint64 constant Q5 = 1 << 4;

    function setUp() public {
        proc = new MockProcessor(); reg = new RuleSetRegistry(); tc = new TiebreakCase(reg);
        vm.prank(publisher); reg.publish(address(proc), 1, 7, 2, keccak256("defs v1"), 0, "Warranty v1");
    }

    function _open() internal returns (uint256) { vm.prank(operator); return tc.open(1, filer, decider, reviewer, keccak256("evidence")); }

    // ---- registry ----
    function test_publish_records_entry() public view {
        RuleSetRegistry.RuleSet memory r = reg.get(1);
        assertEq(r.publisher, publisher); assertEq(r.circuitId, 1); assertEq(r.nQuestions, 7); assertEq(r.nResultBits, 2); assertEq(r.definitionsHash, keccak256("defs v1"));
        assertEq(reg.count(), 1);
    }
    function test_publish_rejects_wrong_shape() public {
        vm.expectRevert("circuit shape"); reg.publish(address(proc), 1, 8, 2, bytes32(0), 0, "x");
        vm.expectRevert("circuit shape"); reg.publish(address(proc), 1, 7, 3, bytes32(0), 0, "x");
    }
    function test_publish_rejects_unknown_circuit() public { vm.expectRevert(); reg.publish(address(proc), 2, 7, 2, bytes32(0), 0, "x"); }
    function test_new_version_only_by_same_publisher() public {
        vm.prank(stranger); vm.expectRevert("not the previous publisher"); reg.publish(address(proc), 1, 7, 2, bytes32(0), 1, "v2");
        vm.prank(publisher); uint256 id = reg.publish(address(proc), 1, 7, 2, keccak256("defs v2"), 1, "Warranty v2");
        assertEq(id, 2); assertEq(reg.get(2).previousId, 1); assertEq(reg.get(1).definitionsHash, keccak256("defs v1")); // old entry untouched
    }
    function test_registry_input_limits() public {
        vm.expectRevert("name 1..80 bytes"); reg.publish(address(proc), 1, 7, 2, bytes32(0), 0, "");
        vm.expectRevert("unknown previous"); reg.publish(address(proc), 1, 7, 2, bytes32(0), 9, "x");
        vm.expectRevert("unknown rule set"); reg.get(5);
    }

    // ---- cases ----
    function test_agreement_finalizes_immediately() public {
        uint256 id = _open();
        vm.prank(filer); tc.submit(id, true, ALL_YES);
        vm.prank(decider); tc.submit(id, false, ALL_YES);
        TiebreakCase.Case memory c = tc.get(id);
        assertEq(uint8(c.status), uint8(TiebreakCase.Status.Final)); assertEq(c.result, 3); assertEq(c.disputed, 0);
    }
    function test_dispute_goes_to_reviewer_only_for_disputed_questions() public {
        uint256 id = _open();
        vm.prank(filer); tc.submit(id, true, ALL_YES);
        vm.prank(decider); tc.submit(id, false, ALL_YES & ~Q5);
        TiebreakCase.Case memory c = tc.get(id);
        assertEq(uint8(c.status), uint8(TiebreakCase.Status.AwaitingReview)); assertEq(c.disputed, Q5);
        // the reviewer sends junk for the questions that were agreed; only the disputed bit counts
        vm.prank(reviewer); tc.review(id, Q5); // says Q5 yes, all other bits 0 (ignored)
        c = tc.get(id);
        assertEq(uint8(c.status), uint8(TiebreakCase.Status.Final)); assertEq(c.finalAnswers, ALL_YES); assertEq(c.result, 3);
    }
    function test_reviewer_can_side_with_decider() public {
        uint256 id = _open();
        vm.prank(filer); tc.submit(id, true, ALL_YES); vm.prank(decider); tc.submit(id, false, ALL_YES & ~Q5);
        vm.prank(reviewer); tc.review(id, 0); // Q5 = no
        assertEq(tc.get(id).result, 0); assertEq(tc.get(id).finalAnswers, ALL_YES & ~Q5);
    }
    function test_partly_and_review_outcomes() public {
        uint256 id = _open(); // Q6 no -> partly covered (2)
        vm.prank(filer); tc.submit(id, true, ALL_YES & ~uint64(1 << 5)); vm.prank(decider); tc.submit(id, false, ALL_YES & ~uint64(1 << 5));
        assertEq(tc.get(id).result, 2);
        uint256 id2 = _open(); // Q3 no -> needs review (1)
        vm.prank(filer); tc.submit(id2, true, ALL_YES & ~uint64(1 << 2)); vm.prank(decider); tc.submit(id2, false, ALL_YES & ~uint64(1 << 2));
        assertEq(tc.get(id2).result, 1);
    }
    function test_operator_can_submit_for_people_without_wallets() public {
        uint256 id = _open();
        vm.startPrank(operator); tc.submit(id, true, ALL_YES); tc.submit(id, false, ALL_YES); vm.stopPrank();
        assertEq(tc.get(id).result, 3);
    }
    function test_only_parties_or_operator_may_act() public {
        uint256 id = _open();
        vm.prank(stranger); vm.expectRevert("not allowed"); tc.submit(id, true, ALL_YES);
        vm.prank(decider); vm.expectRevert("not allowed"); tc.submit(id, true, ALL_YES); // decider cannot answer as filer
        vm.prank(filer); tc.submit(id, true, ALL_YES); vm.prank(decider); tc.submit(id, false, ALL_YES & ~Q5);
        vm.prank(filer); vm.expectRevert("not allowed"); tc.review(id, Q5);
        vm.prank(stranger); vm.expectRevert("not allowed"); tc.review(id, Q5);
    }
    function test_cannot_answer_twice_or_after_final_or_out_of_range() public {
        uint256 id = _open();
        vm.prank(filer); tc.submit(id, true, ALL_YES);
        vm.prank(filer); vm.expectRevert("already answered"); tc.submit(id, true, 0);
        vm.prank(decider); vm.expectRevert("answer outside the questions"); tc.submit(id, false, 1 << 7);
        vm.prank(decider); tc.submit(id, false, ALL_YES);
        vm.prank(decider); vm.expectRevert("not open"); tc.submit(id, false, ALL_YES);
        vm.prank(reviewer); vm.expectRevert("not awaiting review"); tc.review(id, 0);
    }
    function test_open_validations() public {
        vm.expectRevert("reviewer must be neutral"); tc.open(1, filer, decider, filer, bytes32(0));
        vm.expectRevert("reviewer must be neutral"); tc.open(1, filer, decider, decider, bytes32(0));
        vm.expectRevert("zero party"); tc.open(1, address(0), decider, reviewer, bytes32(0));
        vm.expectRevert("unknown rule set"); tc.open(9, filer, decider, reviewer, bytes32(0));
        vm.expectRevert("unknown case"); tc.get(1);
    }
    function test_replay_matches_and_is_final_only() public {
        uint256 id = _open();
        vm.expectRevert("not final"); tc.replay(id);
        vm.startPrank(operator); tc.submit(id, true, ALL_YES); tc.submit(id, false, ALL_YES); vm.stopPrank();
        (uint8 re, uint8 st, bool ok) = tc.replay(id);
        assertEq(re, 3); assertEq(st, 3); assertTrue(ok);
    }
    function testFuzz_final_answers_keep_agreed_bits_and_take_reviewer_on_disputed(uint64 a, uint64 b, uint64 r) public {
        a &= ALL_YES; b &= ALL_YES; r &= ALL_YES;
        uint256 id = _open();
        vm.startPrank(operator); tc.submit(id, true, a); tc.submit(id, false, b); vm.stopPrank();
        TiebreakCase.Case memory c = tc.get(id);
        if (a == b) { assertEq(c.finalAnswers, a); return; }
        assertEq(c.disputed, a ^ b);
        vm.prank(reviewer); tc.review(id, r);
        c = tc.get(id);
        uint64 d = a ^ b;
        assertEq(c.finalAnswers, (a & ~d) | (r & d));
        assertEq(c.finalAnswers & ~d, a & ~d);       // agreed bits survive
        assertEq(c.finalAnswers & d, r & d);         // disputed bits are the reviewer's
    }
}

/// Real X Layer processor (needs network): tape out the compiled warranty circuit, then run a whole case against it.
contract TiebreakForkTest is Test {
    address constant PROC = 0x9e2849c04A513FE64db07521cBE52d078d905c0E;
    address constant FAUCET = 0xBC58802002307fD80048e93A6475335eC65a4f39;
    bytes constant NETLIST = hex"00000002000003000000090000090000000a0000050000000b00000b0000000c0000060000000d00000d0000000e0000080000000f00000f000000100000040000000700000700000004000012000000100000130000001400001400000011000011";

    function test_full_case_on_the_real_processor() public {
        vm.createSelectFork("https://rpc.xlayer.tech");
        address u = makeAddr("tester"); vm.deal(u, 1 ether);
        vm.startPrank(u, u);
        (bool ok,) = FAUCET.call(abi.encodeWithSelector(0x4e71d92d)); require(ok, "faucet");
        (bool ok2,) = PROC.call{value: 0.0013 ether}(abi.encodeWithSelector(0x7bd3ac1d, NETLIST, uint256(7), uint256(2))); require(ok2, "tapeout");
        vm.stopPrank();
        (bool ok3, bytes memory r) = PROC.staticcall(hex"61b8ce8c"); require(ok3, "nextId");
        uint256 circuit = abi.decode(r, (uint256));

        RuleSetRegistry reg = new RuleSetRegistry(); TiebreakCase tc = new TiebreakCase(reg);
        uint256 rs = reg.publish(PROC, circuit, 7, 2, keccak256("warranty definitions v1"), 0, "Warranty v1");
        address filer = makeAddr("filer"); address decider = makeAddr("decider"); address reviewer = makeAddr("reviewer");
        uint256 id = tc.open(rs, filer, decider, reviewer, keccak256("evidence"));
        vm.prank(filer); tc.submit(id, true, 0x7f);          // customer: everything is fine
        vm.prank(decider); tc.submit(id, false, 0x7f & ~uint64(1 << 4)); // repair centre: excluded cause (Q5) present
        assertEq(tc.get(id).disputed, 1 << 4);
        vm.prank(reviewer); tc.review(id, 0);                  // reviewer sides with the repair centre
        assertEq(tc.get(id).result, 0);                        // not covered
        (uint8 re, uint8 st, bool match_) = tc.replay(id);
        assertTrue(match_); assertEq(re, st);
        // all seven yes, on the real processor, gives Covered
        uint256 id2 = tc.open(rs, filer, decider, reviewer, bytes32(0));
        vm.prank(filer); tc.submit(id2, true, 0x7f); vm.prank(decider); tc.submit(id2, false, 0x7f);
        assertEq(tc.get(id2).result, 3);
    }
}
