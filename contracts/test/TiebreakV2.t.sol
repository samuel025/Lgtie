// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {RuleSetRegistry} from "../src/RuleSetRegistry.sol";
import {TiebreakCaseV2} from "../src/TiebreakCaseV2.sol";
import {IVerdictSource} from "../src/IVerdictSource.sol";
import {MockProcessor} from "./Mock.sol";

/// @dev Example of another contract reading a verdict. Test-only: it records what it WOULD pay, it moves no funds.
contract ExampleConsumer {
    IVerdictSource public immutable src;
    mapping(uint256 => string) public decision;
    constructor(IVerdictSource s) { src = s; }
    function settle(uint256 caseId) external {
        (bool isFinal, uint8 result,,) = src.verdict(caseId);
        require(isFinal, "no verdict yet");
        decision[caseId] = result == 3 ? "pay filer in full" : result == 2 ? "pay parts only" : result == 1 ? "send to manual review" : "pay nothing";
    }
}

contract TiebreakV2Test is Test {
    RuleSetRegistry reg; TiebreakCaseV2 tc; MockProcessor proc;
    address publisher = makeAddr("publisher"); address filer = makeAddr("filer"); address decider = makeAddr("decider");
    address reviewer = makeAddr("reviewer"); address reviewer2 = makeAddr("reviewer2"); address operator = makeAddr("operator"); address stranger = makeAddr("stranger");
    uint64 constant ALL_YES = 0x7f; uint64 constant Q5 = 1 << 4; uint32 constant DAY = 1 days;

    function setUp() public {
        proc = new MockProcessor(); reg = new RuleSetRegistry(); tc = new TiebreakCaseV2(reg);
        vm.prank(publisher); reg.publish(address(proc), 1, 7, 2, keccak256("defs v1"), 0, "Warranty v1");
    }
    function _open() internal returns (uint256) { vm.prank(operator); return tc.open(1, filer, decider, reviewer, keccak256("evidence"), 7 * DAY, 7 * DAY); }
    function _dispute() internal returns (uint256 id) {
        id = _open();
        vm.prank(filer); tc.submit(id, true, ALL_YES); vm.prank(decider); tc.submit(id, false, ALL_YES & ~Q5);
    }

    // ---- opening ----
    function test_open_sets_deadlines_and_filer_approval() public {
        uint256 id = _open(); TiebreakCaseV2.Case memory c = tc.get(id);
        assertEq(c.answerBy, block.timestamp + 7 days); assertEq(c.reviewWindow, 7 days); assertTrue(c.filerOkReviewer); assertFalse(c.deciderOkReviewer);
        assertEq(uint8(c.status), uint8(TiebreakCaseV2.Status.Open));
    }
    function test_open_validations() public {
        vm.expectRevert("answer window 1 hour..90 days"); tc.open(1, filer, decider, reviewer, 0, 59 minutes, DAY);
        vm.expectRevert("review window 1 hour..90 days"); tc.open(1, filer, decider, reviewer, 0, DAY, 91 days);
        vm.expectRevert("filer and decider must differ"); tc.open(1, filer, filer, reviewer, 0, DAY, DAY);
        vm.expectRevert("reviewer must be neutral"); tc.open(1, filer, decider, filer, 0, DAY, DAY);
        vm.expectRevert("reviewer must be neutral"); tc.open(1, filer, decider, decider, 0, DAY, DAY);
        vm.expectRevert("zero party"); tc.open(1, address(0), decider, reviewer, 0, DAY, DAY);
        vm.expectRevert("unknown rule set"); tc.open(9, filer, decider, reviewer, 0, DAY, DAY);
    }

    // ---- reviewer consent ----
    function test_reviewer_cannot_review_until_the_decider_accepts() public {
        uint256 id = _dispute();
        vm.prank(reviewer); vm.expectRevert("reviewer not accepted by both sides"); tc.review(id, Q5);
        vm.prank(decider); tc.approveReviewer(id, false);
        vm.prank(reviewer); tc.review(id, Q5);
        assertEq(uint8(tc.get(id).status), uint8(TiebreakCaseV2.Status.Final)); assertEq(tc.get(id).result, 3);
    }
    function test_decider_can_propose_another_reviewer_and_the_filer_must_accept() public {
        uint256 id = _dispute();
        vm.prank(decider); tc.proposeReviewer(id, false, reviewer2);
        TiebreakCaseV2.Case memory c = tc.get(id); assertEq(c.reviewer, reviewer2); assertFalse(c.filerOkReviewer); assertTrue(c.deciderOkReviewer);
        vm.prank(reviewer2); vm.expectRevert("reviewer not accepted by both sides"); tc.review(id, 0);
        vm.prank(reviewer); vm.expectRevert("reviewer not accepted by both sides"); tc.review(id, 0); // the old proposal is dead
        vm.prank(filer); tc.approveReviewer(id, true);
        vm.prank(reviewer); vm.expectRevert("not allowed"); tc.review(id, 0);     // even with both approvals, only the current reviewer may act
        vm.prank(reviewer2); tc.review(id, 0); assertEq(tc.get(id).result, 0);
    }
    function test_proposals_must_be_neutral_and_by_a_party() public {
        uint256 id = _open();
        vm.prank(decider); vm.expectRevert("reviewer must be neutral"); tc.proposeReviewer(id, false, filer);
        vm.prank(decider); vm.expectRevert("reviewer must be neutral"); tc.proposeReviewer(id, false, decider);
        vm.prank(decider); vm.expectRevert("reviewer must be neutral"); tc.proposeReviewer(id, false, address(0));
        vm.prank(stranger); vm.expectRevert("not allowed"); tc.proposeReviewer(id, false, reviewer2);
        vm.prank(stranger); vm.expectRevert("not allowed"); tc.approveReviewer(id, false);
        vm.prank(filer); vm.expectRevert("not allowed"); tc.approveReviewer(id, false); // the filer cannot approve for the decider
    }
    function test_operator_cannot_review_unless_both_sides_accepted() public {
        uint256 id = _dispute();
        vm.prank(operator); vm.expectRevert("reviewer not accepted by both sides"); tc.review(id, Q5);
        vm.prank(operator); tc.approveReviewer(id, false); // the operator acts for the decider (staff-assisted mode)
        vm.prank(operator); tc.review(id, Q5); assertEq(tc.get(id).result, 3);
    }

    // ---- answers and results (as in v1) ----
    function test_agreement_finalizes_immediately_without_a_reviewer() public {
        uint256 id = _open();
        vm.prank(filer); tc.submit(id, true, ALL_YES); vm.prank(decider); tc.submit(id, false, ALL_YES);
        assertEq(uint8(tc.get(id).status), uint8(TiebreakCaseV2.Status.Final)); assertEq(tc.get(id).result, 3);
    }
    function test_only_disputed_bits_come_from_the_reviewer() public {
        uint256 id = _dispute(); vm.prank(decider); tc.approveReviewer(id, false);
        vm.prank(reviewer); tc.review(id, Q5);  // junk bits for agreed questions are ignored
        assertEq(tc.get(id).finalAnswers, ALL_YES);
    }
    function test_answer_rules() public {
        uint256 id = _open();
        vm.prank(stranger); vm.expectRevert("not allowed"); tc.submit(id, true, ALL_YES);
        vm.prank(decider); vm.expectRevert("not allowed"); tc.submit(id, true, ALL_YES);
        vm.prank(filer); tc.submit(id, true, ALL_YES);
        vm.prank(filer); vm.expectRevert("already answered"); tc.submit(id, true, 0);
        vm.prank(decider); vm.expectRevert("answer outside the questions"); tc.submit(id, false, 1 << 7);
    }

    // ---- deadlines ----
    function test_answers_after_the_deadline_are_refused_and_the_case_can_expire() public {
        uint256 id = _open();
        vm.prank(filer); tc.submit(id, true, ALL_YES);
        vm.expectRevert("not expired yet"); tc.expire(id);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(decider); vm.expectRevert("answer deadline passed"); tc.submit(id, false, ALL_YES);
        vm.prank(stranger); tc.expire(id);                                  // anyone can close it
        TiebreakCaseV2.Case memory c = tc.get(id);
        assertEq(uint8(c.status), uint8(TiebreakCaseV2.Status.Expired)); assertEq(c.result, 0); assertEq(c.finalAnswers, 0); // nobody wins by default
        vm.expectRevert("not final"); tc.replay(id);
        vm.expectRevert("not expired yet"); tc.expire(id);                  // only once
        vm.prank(decider); vm.expectRevert("not open"); tc.submit(id, false, ALL_YES);
    }
    function test_reviewer_who_never_answers_expires_the_case() public {
        uint256 id = _dispute(); vm.prank(decider); tc.approveReviewer(id, false);
        vm.warp(block.timestamp + 7 days - 1); vm.expectRevert("not expired yet"); tc.expire(id);
        vm.warp(block.timestamp + 2);
        vm.prank(reviewer); vm.expectRevert("review deadline passed"); tc.review(id, Q5);
        tc.expire(id); assertEq(uint8(tc.get(id).status), uint8(TiebreakCaseV2.Status.Expired));
        (bool isFinal,,,) = tc.verdict(id); assertFalse(isFinal);
    }
    function test_review_window_starts_when_the_answers_are_in() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 5 days);
        vm.prank(filer); tc.submit(id, true, ALL_YES); vm.prank(decider); tc.submit(id, false, ALL_YES & ~Q5);
        assertEq(tc.get(id).reviewBy, block.timestamp + 7 days);
        vm.prank(decider); tc.approveReviewer(id, false);
        vm.warp(block.timestamp + 6 days); vm.prank(reviewer); tc.review(id, Q5); // still inside the review window
        assertEq(uint8(tc.get(id).status), uint8(TiebreakCaseV2.Status.Final));
    }
    function test_closed_cases_refuse_reviewer_changes() public {
        uint256 id = _open(); vm.warp(block.timestamp + 8 days); tc.expire(id);
        vm.prank(decider); vm.expectRevert("case is closed"); tc.approveReviewer(id, false);
        vm.prank(decider); vm.expectRevert("case is closed"); tc.proposeReviewer(id, false, reviewer2);
    }

    // ---- verdict reader for other contracts ----
    function test_verdict_is_readable_by_other_contracts() public {
        uint256 id = _dispute();
        ExampleConsumer ec = new ExampleConsumer(IVerdictSource(address(tc)));
        (bool f0,,,) = tc.verdict(id); assertFalse(f0);
        vm.expectRevert("no verdict yet"); ec.settle(id);
        vm.prank(decider); tc.approveReviewer(id, false); vm.prank(reviewer); tc.review(id, 0); // reviewer sides with the decider: Not covered
        (bool f1, uint8 res, uint256 rsId, uint64 fin) = tc.verdict(id);
        assertTrue(f1); assertEq(res, 0); assertEq(rsId, 1); assertEq(fin, ALL_YES & ~Q5);
        ec.settle(id); assertEq(ec.decision(id), "pay nothing");
    }
    function test_replay_matches() public {
        uint256 id = _open();
        vm.startPrank(operator); tc.submit(id, true, ALL_YES); tc.submit(id, false, ALL_YES); vm.stopPrank();
        (uint8 re, uint8 st, bool ok) = tc.replay(id); assertEq(re, 3); assertEq(st, 3); assertTrue(ok);
    }
    function testFuzz_final_answers(uint64 a, uint64 b, uint64 r) public {
        a &= ALL_YES; b &= ALL_YES; r &= ALL_YES;
        uint256 id = _open();
        vm.startPrank(operator); tc.submit(id, true, a); tc.submit(id, false, b); vm.stopPrank();
        TiebreakCaseV2.Case memory c = tc.get(id);
        if (a == b) { assertEq(c.finalAnswers, a); return; }
        uint64 d = a ^ b; assertEq(c.disputed, d);
        vm.prank(decider); tc.approveReviewer(id, false); vm.prank(reviewer); tc.review(id, r);
        c = tc.get(id);
        assertEq(c.finalAnswers & ~d, a & ~d); assertEq(c.finalAnswers & d, r & d);
    }
}

/// Real X Layer processor (needs network): tape out the compiled warranty circuit, then run a whole v2 case against it.
contract TiebreakV2ForkTest is Test {
    address constant PROC = 0x9e2849c04A513FE64db07521cBE52d078d905c0E;
    address constant FAUCET = 0xBC58802002307fD80048e93A6475335eC65a4f39;
    bytes constant NETLIST = hex"00000002000003000000090000090000000a0000050000000b00000b0000000c0000060000000d00000d0000000e0000080000000f00000f000000100000040000000700000700000004000012000000100000130000001400001400000011000011";

    function test_full_v2_case_on_the_real_processor() public {
        vm.createSelectFork("https://rpc.xlayer.tech");
        address u = makeAddr("tester"); vm.deal(u, 1 ether); vm.startPrank(u, u);
        (bool ok,) = FAUCET.call(abi.encodeWithSelector(0x4e71d92d)); require(ok, "faucet");
        (bool ok2,) = PROC.call{value: 0.0013 ether}(abi.encodeWithSelector(0x7bd3ac1d, NETLIST, uint256(7), uint256(2))); require(ok2, "tapeout");
        vm.stopPrank();
        (bool ok3, bytes memory r) = PROC.staticcall(hex"61b8ce8c"); require(ok3, "nextId"); uint256 circuit = abi.decode(r, (uint256));
        RuleSetRegistry reg = new RuleSetRegistry(); TiebreakCaseV2 tc = new TiebreakCaseV2(reg);
        uint256 rs = reg.publish(PROC, circuit, 7, 2, keccak256("warranty definitions v1"), 0, "Warranty v1");
        address filer = makeAddr("filer"); address decider = makeAddr("decider"); address reviewer = makeAddr("reviewer");
        uint256 id = tc.open(rs, filer, decider, reviewer, keccak256("evidence"), 7 days, 7 days);
        vm.prank(filer); tc.submit(id, true, 0x7f);
        vm.prank(decider); tc.submit(id, false, 0x7f & ~uint64(1 << 4));
        vm.prank(decider); tc.approveReviewer(id, false);
        vm.prank(reviewer); tc.review(id, 0);
        (bool isFinal, uint8 result,,) = tc.verdict(id);
        assertTrue(isFinal); assertEq(result, 0);
        (uint8 re, uint8 st, bool same) = tc.replay(id); assertTrue(same); assertEq(re, st);
        uint256 id2 = tc.open(rs, filer, decider, reviewer, bytes32(0), 1 days, 1 days);
        vm.warp(block.timestamp + 2 days); tc.expire(id2);
        (bool f2,,,) = tc.verdict(id2); assertFalse(f2);
    }
}
