// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {RuleSetRegistry} from "../src/RuleSetRegistry.sol";
import {AgreementRegistry} from "../src/AgreementRegistry.sol";
import {TiebreakCaseV2} from "../src/TiebreakCaseV2.sol";
import {TiebreakCaseV3} from "../src/TiebreakCaseV3.sol";
import {IVerdictSource} from "../src/IVerdictSource.sol";
import {MockProcessor} from "./Mock.sol";

contract V3Base is Test {
    RuleSetRegistry reg; AgreementRegistry ag; TiebreakCaseV3 tc; MockProcessor proc;
    address publisher = makeAddr("publisher"); address filer = makeAddr("filer"); address decider = makeAddr("decider");
    address reviewer = makeAddr("reviewer"); address reviewer2 = makeAddr("reviewer2"); address helperF = makeAddr("filerHelper"); address helperD = makeAddr("deciderHelper"); address stranger = makeAddr("stranger");
    uint64 constant ALL_YES = 0x7f; uint64 constant Q5 = 1 << 4; uint32 constant DAY = 1 days;

    function setUp() public virtual {
        proc = new MockProcessor(); reg = new RuleSetRegistry(); ag = new AgreementRegistry(reg); tc = new TiebreakCaseV3(reg, ag);
        vm.prank(publisher); reg.publish(address(proc), 1, 7, 2, keccak256("defs v1"), 0, "Warranty v1");
    }
    function _open() internal returns (uint256) { vm.prank(filer); return tc.open(1, decider, reviewer, keccak256("evidence"), 7 * DAY, 7 * DAY); }
    function _agreement() internal returns (uint256 aid) {
        vm.prank(decider); aid = ag.propose(filer, 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY);
        vm.prank(filer); ag.accept(aid);
    }
    function _dispute(uint256 id) internal { vm.prank(filer); tc.submit(id, true, ALL_YES); vm.prank(decider); tc.submit(id, false, ALL_YES & ~Q5); }
}

/// Documents the flaw that existed in TiebreakCaseV2 (deployed): the opener became "operator" and could answer for BOTH sides.
contract V2FlawDemo is Test {
    function test_v2_opener_could_answer_for_the_other_side() public {
        MockProcessor proc = new MockProcessor(); RuleSetRegistry reg = new RuleSetRegistry(); TiebreakCaseV2 v2 = new TiebreakCaseV2(reg);
        reg.publish(address(proc), 1, 7, 2, bytes32(0), 0, "Warranty");
        address filer = makeAddr("filer"); address decider = makeAddr("decider"); address reviewer = makeAddr("reviewer");
        vm.startPrank(filer);
        uint256 id = v2.open(1, filer, decider, reviewer, bytes32(0), 1 days, 1 days);
        v2.submit(id, true, 0x7f);
        v2.submit(id, false, 0x7f);                 // the filer answers FOR the decider
        vm.stopPrank();
        assertEq(uint8(v2.get(id).status), uint8(TiebreakCaseV2.Status.Final));   // decided without the decider ever acting
        vm.prank(decider); vm.expectRevert("not open"); v2.submit(id, false, 0);  // and the decider is locked out
    }
}

contract AgreementTest is V3Base {
    function test_propose_accept_flow() public {
        vm.prank(decider); uint256 id = ag.propose(filer, 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY);
        AgreementRegistry.Agreement memory a = ag.get(id);
        assertEq(a.proposer, decider); assertEq(a.counterparty, filer); assertEq(a.ruleSetId, 1); assertEq(a.reviewer, reviewer); assertEq(a.answerWindow, 3 days); assertEq(a.acceptedAt, 0);
        assertFalse(ag.inForce(id));
        vm.prank(filer); ag.accept(id);
        assertTrue(ag.inForce(id)); assertEq(ag.get(id).acceptedAt, block.timestamp);
    }
    function test_only_the_counterparty_can_accept_once() public {
        vm.prank(decider); uint256 id = ag.propose(filer, 1, bytes32(0), reviewer, DAY, DAY);
        vm.prank(stranger); vm.expectRevert("only the counterparty"); ag.accept(id);
        vm.prank(decider); vm.expectRevert("only the counterparty"); ag.accept(id);
        vm.prank(filer); ag.accept(id);
        vm.prank(filer); vm.expectRevert("not open for acceptance"); ag.accept(id);
    }
    function test_cancel_only_before_acceptance_and_only_by_the_proposer() public {
        vm.prank(decider); uint256 id = ag.propose(filer, 1, bytes32(0), reviewer, DAY, DAY);
        vm.prank(filer); vm.expectRevert("only the proposer"); ag.cancel(id);
        vm.prank(decider); ag.cancel(id);
        vm.prank(filer); vm.expectRevert("not open for acceptance"); ag.accept(id);
        vm.prank(decider); vm.expectRevert("not open for cancellation"); ag.cancel(id);
        uint256 id2 = _agreement();
        vm.prank(decider); vm.expectRevert("not open for cancellation"); ag.cancel(id2);  // an accepted agreement is permanent
        assertTrue(ag.inForce(id2));
    }
    function test_proposal_validations() public {
        vm.startPrank(decider);
        vm.expectRevert("unknown rule set"); ag.propose(filer, 9, bytes32(0), reviewer, DAY, DAY);
        vm.expectRevert("bad counterparty"); ag.propose(decider, 1, bytes32(0), reviewer, DAY, DAY);
        vm.expectRevert("bad counterparty"); ag.propose(address(0), 1, bytes32(0), reviewer, DAY, DAY);
        vm.expectRevert("reviewer must be neutral"); ag.propose(filer, 1, bytes32(0), filer, DAY, DAY);
        vm.expectRevert("reviewer must be neutral"); ag.propose(filer, 1, bytes32(0), decider, DAY, DAY);
        vm.expectRevert("answer window 1 hour..90 days"); ag.propose(filer, 1, bytes32(0), reviewer, 59 minutes, DAY);
        vm.expectRevert("review window 1 hour..90 days"); ag.propose(filer, 1, bytes32(0), reviewer, DAY, 91 days);
        vm.stopPrank();
        vm.expectRevert("unknown agreement"); ag.get(1);
    }
}

contract TiebreakV3Test is V3Base {
    // ---- opening ----
    function test_open_makes_the_caller_the_filer_with_deadlines() public {
        uint256 id = _open(); TiebreakCaseV3.Case memory c = tc.get(id);
        assertEq(c.filer, filer); assertEq(c.decider, decider); assertEq(c.reviewer, reviewer); assertEq(c.agreementId, 0);
        assertEq(c.filerOperator, address(0)); assertEq(c.deciderOperator, address(0));
        assertTrue(c.filerOkReviewer); assertFalse(c.deciderOkReviewer); assertEq(c.answerBy, block.timestamp + 7 days);
    }
    function test_open_validations() public {
        vm.startPrank(filer);
        vm.expectRevert("answer window 1 hour..90 days"); tc.open(1, decider, reviewer, 0, 59 minutes, DAY);
        vm.expectRevert("review window 1 hour..90 days"); tc.open(1, decider, reviewer, 0, DAY, 91 days);
        vm.expectRevert("filer and decider must differ"); tc.open(1, filer, reviewer, 0, DAY, DAY);
        vm.expectRevert("reviewer must be neutral"); tc.open(1, decider, filer, 0, DAY, DAY);
        vm.expectRevert("reviewer must be neutral"); tc.open(1, decider, decider, 0, DAY, DAY);
        vm.expectRevert("zero party"); tc.open(1, address(0), reviewer, 0, DAY, DAY);
        vm.expectRevert("unknown rule set"); tc.open(9, decider, reviewer, 0, DAY, DAY);
        vm.stopPrank();
    }

    // ---- agreements ----
    function test_a_case_under_an_agreement_uses_what_was_agreed() public {
        uint256 aid = _agreement();
        vm.prank(filer); uint256 id = tc.openFromAgreement(aid, keccak256("e"));
        TiebreakCaseV3.Case memory c = tc.get(id);
        assertEq(c.agreementId, aid); assertEq(c.filer, filer); assertEq(c.decider, decider); assertEq(c.reviewer, reviewer); assertEq(c.ruleSetId, 1);
        assertEq(c.answerBy, block.timestamp + 3 days); assertEq(c.reviewWindow, 2 days);
        assertTrue(c.filerOkReviewer); assertTrue(c.deciderOkReviewer);     // the reviewer was agreed in advance
    }
    function test_either_party_can_be_the_filer_under_an_agreement() public {
        uint256 aid = _agreement();
        vm.prank(decider); uint256 id = tc.openFromAgreement(aid, 0);       // the proposer opens this time
        assertEq(tc.get(id).filer, decider); assertEq(tc.get(id).decider, filer);
    }
    function test_agreement_cases_need_an_accepted_agreement_and_a_party() public {
        vm.prank(decider); uint256 pending = ag.propose(filer, 1, 0, reviewer, DAY, DAY);
        vm.prank(filer); vm.expectRevert("agreement not in force"); tc.openFromAgreement(pending, 0);
        vm.prank(decider); ag.cancel(pending);
        vm.prank(filer); vm.expectRevert("agreement not in force"); tc.openFromAgreement(pending, 0);
        uint256 aid = _agreement();
        vm.prank(stranger); vm.expectRevert("not a party to the agreement"); tc.openFromAgreement(aid, 0);
        vm.prank(reviewer); vm.expectRevert("not a party to the agreement"); tc.openFromAgreement(aid, 0);
    }
    function test_under_an_agreement_the_reviewer_can_decide_without_another_approval_step() public {
        uint256 aid = _agreement(); vm.prank(filer); uint256 id = tc.openFromAgreement(aid, 0);
        _dispute(id);
        vm.prank(reviewer); tc.review(id, Q5);
        assertEq(uint8(tc.get(id).status), uint8(TiebreakCaseV3.Status.Final)); assertEq(tc.get(id).result, 3);
    }

    // ---- security: nobody can act for the other side ----
    function test_the_opener_cannot_answer_for_the_other_side() public {
        uint256 id = _open();
        vm.startPrank(filer);
        tc.submit(id, true, ALL_YES);
        vm.expectRevert("not allowed"); tc.submit(id, false, ALL_YES);        // the exact V2 attack
        vm.expectRevert("not allowed"); tc.approveReviewer(id, false);
        vm.expectRevert("not allowed"); tc.proposeReviewer(id, false, reviewer2);
        vm.stopPrank();
        vm.prank(decider); tc.submit(id, false, ALL_YES & ~Q5);               // the decider is not locked out
        assertEq(uint8(tc.get(id).status), uint8(TiebreakCaseV3.Status.AwaitingReview));
    }
    function test_a_helper_acts_only_for_the_side_that_named_it() public {
        uint256 id = _open();
        vm.prank(filer); tc.setOperator(id, true, helperF);
        vm.prank(decider); tc.setOperator(id, false, helperD);
        vm.startPrank(helperF);
        vm.expectRevert("not allowed"); tc.submit(id, false, ALL_YES);       // the filer's helper cannot answer for the decider
        vm.expectRevert("not allowed"); tc.approveReviewer(id, false);
        tc.submit(id, true, ALL_YES);                                        // but can answer for the filer
        vm.stopPrank();
        vm.startPrank(helperD);
        vm.expectRevert("not allowed"); tc.submit(id, true, 0);
        tc.approveReviewer(id, false); tc.submit(id, false, ALL_YES);
        vm.stopPrank();
        assertEq(uint8(tc.get(id).status), uint8(TiebreakCaseV3.Status.Final));
    }
    function test_only_a_side_itself_can_name_its_helper() public {
        uint256 id = _open();
        vm.prank(filer); vm.expectRevert("only the side itself"); tc.setOperator(id, false, helperF);   // not for the other side
        vm.prank(stranger); vm.expectRevert("only the side itself"); tc.setOperator(id, true, helperF);
        vm.prank(filer); tc.setOperator(id, true, helperF);
        vm.prank(helperF); vm.expectRevert("only the side itself"); tc.setOperator(id, true, stranger);  // a helper cannot appoint others
        vm.prank(filer); vm.expectRevert("the reviewer cannot be a helper"); tc.setOperator(id, true, reviewer);
    }
    function test_a_removed_helper_loses_access() public {
        uint256 id = _open();
        vm.prank(filer); tc.setOperator(id, true, helperF);
        vm.prank(filer); tc.setOperator(id, true, address(0));
        vm.prank(helperF); vm.expectRevert("not allowed"); tc.submit(id, true, ALL_YES);
    }
    function test_the_reviewer_cannot_be_swapped_for_one_of_the_helpers() public {
        uint256 id = _open();
        vm.prank(filer); tc.setOperator(id, true, helperF);
        vm.prank(decider); vm.expectRevert("the reviewer cannot be a helper"); tc.proposeReviewer(id, false, helperF);
    }

    // ---- reviewer consent (cases without an agreement) ----
    function test_reviewer_needs_the_decider_to_accept() public {
        uint256 id = _open(); _dispute(id);
        vm.prank(reviewer); vm.expectRevert("reviewer not accepted by both sides"); tc.review(id, Q5);
        vm.prank(decider); tc.approveReviewer(id, false);
        vm.prank(reviewer); tc.review(id, Q5); assertEq(tc.get(id).result, 3);
    }
    function test_counter_proposal_resets_acceptance_and_only_the_current_reviewer_acts() public {
        uint256 id = _open(); _dispute(id);
        vm.prank(decider); tc.proposeReviewer(id, false, reviewer2);
        vm.prank(filer); tc.approveReviewer(id, true);
        vm.prank(reviewer); vm.expectRevert("not allowed"); tc.review(id, 0);
        vm.prank(reviewer2); tc.review(id, 0); assertEq(tc.get(id).result, 0);
    }
    function test_neither_side_nor_an_operator_can_review() public {
        uint256 id = _open(); _dispute(id);
        vm.prank(filer); tc.setOperator(id, true, helperF); vm.prank(decider); tc.approveReviewer(id, false);
        vm.prank(helperF); vm.expectRevert("not allowed"); tc.review(id, Q5);
        vm.prank(filer); vm.expectRevert("not allowed"); tc.review(id, Q5);
        vm.prank(decider); vm.expectRevert("not allowed"); tc.review(id, Q5);
    }

    // ---- results and deadlines ----
    function test_agreement_on_every_answer_finishes_at_once() public {
        uint256 id = _open();
        vm.prank(filer); tc.submit(id, true, ALL_YES); vm.prank(decider); tc.submit(id, false, ALL_YES);
        assertEq(uint8(tc.get(id).status), uint8(TiebreakCaseV3.Status.Final)); assertEq(tc.get(id).result, 3);
    }
    function test_only_disputed_bits_come_from_the_reviewer() public {
        uint256 id = _open(); _dispute(id); vm.prank(decider); tc.approveReviewer(id, false);
        vm.prank(reviewer); tc.review(id, Q5); assertEq(tc.get(id).finalAnswers, ALL_YES);
    }
    function test_deadlines_and_expiry() public {
        uint256 id = _open(); vm.prank(filer); tc.submit(id, true, ALL_YES);
        vm.expectRevert("not expired yet"); tc.expire(id);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(decider); vm.expectRevert("answer deadline passed"); tc.submit(id, false, ALL_YES);
        vm.prank(stranger); tc.expire(id);
        TiebreakCaseV3.Case memory c = tc.get(id);
        assertEq(uint8(c.status), uint8(TiebreakCaseV3.Status.Expired)); assertEq(c.result, 0); assertEq(c.finalAnswers, 0);
        (bool f,,,) = tc.verdict(id); assertFalse(f);
        vm.expectRevert("not expired yet"); tc.expire(id);
    }
    function test_a_reviewer_who_never_answers_expires_the_case() public {
        uint256 id = _open(); _dispute(id); vm.prank(decider); tc.approveReviewer(id, false);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(reviewer); vm.expectRevert("review deadline passed"); tc.review(id, Q5);
        tc.expire(id); assertEq(uint8(tc.get(id).status), uint8(TiebreakCaseV3.Status.Expired));
    }
    function test_closed_cases_refuse_changes() public {
        uint256 id = _open(); vm.warp(block.timestamp + 8 days); tc.expire(id);
        vm.prank(decider); vm.expectRevert("case is closed"); tc.approveReviewer(id, false);
        vm.prank(filer); vm.expectRevert("case is closed"); tc.setOperator(id, true, helperF);
        vm.prank(filer); vm.expectRevert("case is closed"); tc.attachEvidence(id, 0, keccak256("x"), "");
    }

    // ---- evidence ----
    function test_evidence_can_be_attached_to_a_question_or_the_whole_case() public {
        uint256 id = _open(); uint8 whole = tc.WHOLE_CASE();
        vm.prank(filer); tc.attachEvidence(id, 4, keccak256("photo"), "front.jpg");
        vm.prank(decider); tc.attachEvidence(id, whole, keccak256("report"), "inspection-4471.pdf");
        assertEq(tc.evidenceCount(id), 2);
        TiebreakCaseV3.Evidence memory e = tc.evidenceAt(id, 0);
        assertEq(e.by, filer); assertEq(e.question, 4); assertEq(e.hash, keccak256("photo")); assertEq(e.note, "front.jpg"); assertEq(e.at, block.timestamp);
        assertEq(tc.evidenceAt(id, 1).question, 255);
    }
    function test_evidence_permissions() public {
        uint256 id = _open(); vm.prank(filer); tc.setOperator(id, true, helperF);
        vm.prank(helperF); tc.attachEvidence(id, 0, keccak256("a"), "");                       // a side's helper
        vm.prank(reviewer); tc.attachEvidence(id, 0, keccak256("b"), "reviewer asked for this"); // the reviewer
        vm.prank(stranger); vm.expectRevert("not allowed"); tc.attachEvidence(id, 0, keccak256("c"), "");
        vm.prank(reviewer2); vm.expectRevert("not allowed"); tc.attachEvidence(id, 0, keccak256("c"), "");
    }
    function test_evidence_limits() public {
        uint256 id = _open(); vm.startPrank(filer);
        vm.expectRevert("empty hash"); tc.attachEvidence(id, 0, bytes32(0), "");
        vm.expectRevert("no such question"); tc.attachEvidence(id, 7, keccak256("x"), "");
        vm.expectRevert("note too long"); tc.attachEvidence(id, 0, keccak256("x"), "this note is deliberately longer than the sixty byte limit allows here");
        for (uint256 i = 0; i < 40; i++) tc.attachEvidence(id, 0, keccak256(abi.encode(i)), "");
        vm.expectRevert("too much evidence"); tc.attachEvidence(id, 0, keccak256("one more"), "");
        vm.stopPrank();
        vm.expectRevert(); tc.evidenceAt(id, 40);
    }
    function test_evidence_stops_at_the_current_deadline() public {
        uint256 id = _open(); vm.warp(block.timestamp + 7 days + 1);
        vm.prank(filer); vm.expectRevert("deadline passed"); tc.attachEvidence(id, 0, keccak256("late"), "");
    }
    function test_the_reviewer_can_attach_evidence_during_review() public {
        uint256 id = _open(); _dispute(id);
        vm.prank(reviewer); tc.attachEvidence(id, 4, keccak256("my findings"), "findings.pdf");
        assertEq(tc.evidenceCount(id), 1);
    }

    // ---- verdict reader and replay ----
    function test_verdict_is_readable_by_other_contracts() public {
        uint256 id = _open(); _dispute(id);
        (bool f0,,,) = IVerdictSource(address(tc)).verdict(id); assertFalse(f0);
        vm.prank(decider); tc.approveReviewer(id, false); vm.prank(reviewer); tc.review(id, 0);
        (bool f1, uint8 res, uint256 rs, uint64 fin) = IVerdictSource(address(tc)).verdict(id);
        assertTrue(f1); assertEq(res, 0); assertEq(rs, 1); assertEq(fin, ALL_YES & ~Q5);
        (uint8 re, uint8 st, bool ok) = tc.replay(id); assertEq(re, st); assertTrue(ok);
    }
    function testFuzz_final_answers(uint64 a, uint64 b, uint64 r) public {
        a &= ALL_YES; b &= ALL_YES; r &= ALL_YES;
        uint256 aid = _agreement(); vm.prank(filer); uint256 id = tc.openFromAgreement(aid, 0);
        vm.prank(filer); tc.submit(id, true, a); vm.prank(decider); tc.submit(id, false, b);
        TiebreakCaseV3.Case memory c = tc.get(id);
        if (a == b) { assertEq(c.finalAnswers, a); return; }
        uint64 d = a ^ b; assertEq(c.disputed, d);
        vm.prank(reviewer); tc.review(id, r); c = tc.get(id);
        assertEq(c.finalAnswers & ~d, a & ~d); assertEq(c.finalAnswers & d, r & d);
    }
}

/// Real X Layer processor (needs network): tape out the compiled warranty circuit, then run an agreement, a dispute and a verdict against it.
contract TiebreakV3ForkTest is Test {
    address constant PROC = 0x9e2849c04A513FE64db07521cBE52d078d905c0E;
    address constant FAUCET = 0xBC58802002307fD80048e93A6475335eC65a4f39;
    bytes constant NETLIST = hex"00000002000003000000090000090000000a0000050000000b00000b0000000c0000060000000d00000d0000000e0000080000000f00000f000000100000040000000700000700000004000012000000100000130000001400001400000011000011";

    function test_agreement_dispute_and_verdict_on_the_real_processor() public {
        vm.createSelectFork("https://rpc.xlayer.tech");
        address u = makeAddr("tester"); vm.deal(u, 1 ether); vm.startPrank(u, u);
        (bool ok,) = FAUCET.call(abi.encodeWithSelector(0x4e71d92d)); require(ok, "faucet");
        (bool ok2,) = PROC.call{value: 0.0013 ether}(abi.encodeWithSelector(0x7bd3ac1d, NETLIST, uint256(7), uint256(2))); require(ok2, "tapeout");
        vm.stopPrank();
        (bool ok3, bytes memory r) = PROC.staticcall(hex"61b8ce8c"); require(ok3, "nextId"); uint256 circuit = abi.decode(r, (uint256));
        RuleSetRegistry reg = new RuleSetRegistry(); AgreementRegistry ag = new AgreementRegistry(reg); TiebreakCaseV3 tc = new TiebreakCaseV3(reg, ag);
        uint256 rs = reg.publish(PROC, circuit, 7, 2, keccak256("warranty definitions v1"), 0, "Warranty v1");
        address buyer = makeAddr("buyer"); address shop = makeAddr("shop"); address rev = makeAddr("reviewer");
        vm.prank(shop); uint256 aid = ag.propose(buyer, rs, keccak256("sales terms"), rev, 7 days, 7 days);
        vm.prank(buyer); ag.accept(aid);
        vm.prank(buyer); uint256 id = tc.openFromAgreement(aid, keccak256("evidence bundle"));
        vm.prank(buyer); tc.attachEvidence(id, 4, keccak256("photo of the unit"), "unit.jpg");
        vm.prank(buyer); tc.submit(id, true, 0x7f);
        vm.prank(shop); tc.submit(id, false, 0x7f & ~uint64(1 << 4));
        vm.prank(rev); tc.review(id, 0);
        (bool isFinal, uint8 result,,) = tc.verdict(id);
        assertTrue(isFinal); assertEq(result, 0);
        (uint8 re, uint8 st, bool same) = tc.replay(id); assertTrue(same); assertEq(re, st);
    }
}
