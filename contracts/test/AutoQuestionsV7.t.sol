// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {RuleSetRegistry} from "../src/RuleSetRegistry.sol";
import {PasskeyRegistry} from "../src/PasskeyRegistry.sol";
import {AgreementRegistryV2} from "../src/AgreementRegistryV2.sol";
import {TiebreakCaseV7} from "../src/TiebreakCaseV7.sol";
import {FactSpecRegistry} from "../src/FactSpecRegistry.sol";
import {LGtieBilling, IERC20Min} from "../src/LGtieBilling.sol";
import {Party} from "../src/Party.sol";
import {MockProcessor} from "./Mock.sol";
import {MockUSD} from "./MockUSD.sol";

contract SourceV7 {
    uint256 public value;
    function set(uint256 v) external { value = v; }
    function balanceOf(address) external view returns (uint256) { return value; }
}
contract RevertingSourceV7 { function value() external pure returns (uint256) { revert("no"); } }
contract ShortSourceV7 { fallback() external { assembly { mstore(0, 1) return(0, 8) } } }
contract GasHogV7 { fallback() external { while (true) {} } }
contract ReturnBombV7 { fallback() external { assembly { return(0, 3000000) } } }

/// Automatic questions in TiebreakCaseV7 and FactSpecRegistry (docs/AUTO-QUESTIONS.md). The same cases as tests/autoq.test.mjs. Needs no network.
contract AutoQuestionsV7Test is Test {
    RuleSetRegistry reg; PasskeyRegistry pk; AgreementRegistryV2 ag; TiebreakCaseV7 tc; MockProcessor proc; FactSpecRegistry facts; LGtieBilling bill;
    address business = makeAddr("business"); address customer = makeAddr("customer"); address reviewer = makeAddr("reviewer"); address stranger = makeAddr("stranger");
    uint256 rs = 1; uint256 aid;
    uint64 constant Q1 = 1; uint64 constant Q2 = 2; uint64 constant Q3 = 4; uint64 constant Q4 = 8; uint64 constant Q5 = 16; uint64 constant Q6 = 32; uint64 constant Q7 = 64;
    uint64 constant ALL = 0x7f; uint32 constant DAY = 1 days;

    function setUp() public {
        vm.warp(1_800_000_000);
        proc = new MockProcessor(); reg = new RuleSetRegistry(); pk = new PasskeyRegistry(); ag = new AgreementRegistryV2(reg, pk); facts = new FactSpecRegistry(reg);
        bill = new LGtieBilling(IERC20Min(address(new MockUSD())), makeAddr("treasury"), 0, LGtieBilling.Plan(0, 0, 0), LGtieBilling.Plan(0, 0, 0));
        tc = new TiebreakCaseV7(reg, ag, pk, address(proc), bill, facts); bill.setCases(address(tc));
        vm.prank(business); reg.publish(address(proc), 1, 7, 2, keccak256("defs"), 0, "Warranty");
    }

    // ----- helpers -----
    function _evidence(uint8 q, uint32 within, uint8 role, uint8 question) internal pure returns (FactSpecRegistry.Spec memory s) { s.kind = 1; s.q = q; s.role = role; s.question = question; s.withinSeconds = within; }
    function _opened(uint8 q, uint64 deadline) internal pure returns (FactSpecRegistry.Spec memory s) { s.kind = 2; s.q = q; s.deadline = deadline; }
    function _read(uint8 q, address target, bytes memory data, uint8 cmp, uint256 thr) internal pure returns (FactSpecRegistry.Spec memory s) { s.kind = 3; s.q = q; s.target = target; s.data = data; s.cmp = cmp; s.threshold = thr; }
    function _set(FactSpecRegistry.Spec memory a) internal { FactSpecRegistry.Spec[] memory l = new FactSpecRegistry.Spec[](1); l[0] = a; vm.prank(business); facts.set(rs, l); }
    function _agree() internal { vm.prank(business); aid = ag.propose(Party(customer, 0), rs, keccak256("terms"), reviewer, 3 days, 2 days); vm.prank(customer); ag.accept(aid); }
    function _open() internal returns (uint256) { vm.prank(business); return tc.openFromAgreement(aid, bytes32(0)); }
    function _answer(uint256 id, uint64 filer, uint64 decider) internal { vm.prank(business); tc.submit(id, true, filer); vm.prank(customer); tc.submit(id, false, decider); }
    function _status(uint256 id) internal view returns (uint8) { return uint8(tc.get(id).status); }
    function _final(uint256 id) internal view returns (uint64) { return tc.get(id).finalAnswers; }

    // ----- no spec: exactly the old behaviour -----
    function test_without_a_spec_a_disagreement_goes_to_the_reviewer_and_agreement_finalizes() public {
        _agree(); uint256 id = _open(); _answer(id, ALL, ALL & ~Q3);
        assertEq(_status(id), 1); assertEq(tc.get(id).disputed, Q3); assertEq(tc.get(id).autoMask, 0);
        uint256 id2 = _open(); _answer(id2, ALL, ALL);
        assertEq(_status(id2), 2); assertEq(_final(id2), ALL);
    }

    // ----- kind 2: opened before a date -----
    function test_opened_before_the_deadline_is_yes_and_cannot_be_disputed() public {
        _set(_opened(2, uint64(block.timestamp + DAY))); _agree(); uint256 id = _open();
        _answer(id, ALL & ~Q3, ALL);   // they differ only on Q3, which the chain answers (yes)
        assertEq(_status(id), 2); assertEq(_final(id), ALL & ~Q3 | Q3);
    }
    function test_opened_exactly_on_the_deadline_counts_and_one_second_later_does_not() public {
        _set(_opened(2, uint64(block.timestamp + 2 days))); _agree();   // the spec is written before the agreement
        vm.warp(block.timestamp + 2 days); uint256 a = _open(); assertEq(tc.get(a).autoBits & Q3, Q3);
        vm.warp(block.timestamp + 1); uint256 b = _open(); assertEq(tc.get(b).autoBits & Q3, 0); assertEq(tc.get(b).autoMask & Q3, Q3);
    }
    function test_the_chain_answer_replaces_what_both_sides_claimed() public {
        _set(_opened(2, uint64(block.timestamp - 1))); _agree(); uint256 id = _open();   // already past: the chain says no on Q3
        _answer(id, ALL, ALL);
        assertEq(_status(id), 2); assertEq(_final(id), ALL & ~Q3);
    }
    function test_other_disagreements_still_go_to_the_reviewer_and_only_those() public {
        _set(_opened(2, uint64(block.timestamp - 1))); _agree(); uint256 id = _open();
        _answer(id, ALL, ALL & ~Q3 & ~Q1);   // differ on Q1 and Q3
        assertEq(_status(id), 1); assertEq(tc.get(id).disputed, Q1);
    }
    function test_a_reviewer_cannot_change_an_automatic_question() public {
        _set(_opened(2, uint64(block.timestamp - 1))); _agree(); uint256 id = _open();   // Q3 automatically no
        _answer(id, ALL, ALL & ~Q1);
        vm.prank(reviewer); tc.acknowledgeReviewer(id);
        vm.prank(reviewer); tc.review(id, ALL);   // the reviewer says yes to everything
        assertEq(_final(id), ALL & ~Q3);          // Q1 became yes; Q3 stayed no
    }

    // ----- kind 1: evidence in time -----
    function test_evidence_attached_in_time_is_yes_and_late_or_missing_is_no() public {
        _set(_evidence(2, uint32(3 days), 0, 0)); _agree();
        uint256 a = _open(); vm.warp(block.timestamp + 1 days); vm.prank(business); tc.attachEvidence(a, 0, keccak256("e"), "x"); _answer(a, ALL, ALL);
        assertEq(_final(a) & Q3, Q3);
        uint256 b = _open(); _answer(b, ALL, ALL); assertEq(_final(b) & Q3, 0);   // never attached
    }
    function test_evidence_exactly_on_the_limit_counts_one_second_after_does_not() public {
        _set(_evidence(2, uint32(2 hours), 0, 0)); _agree();
        uint256 a = _open(); uint256 t0 = block.timestamp; vm.warp(t0 + 2 hours); vm.prank(business); tc.attachEvidence(a, 0, keccak256("e"), "x"); _answer(a, ALL, ALL);
        assertEq(_final(a) & Q3, Q3);
        vm.warp(t0); uint256 b = _open(); vm.warp(t0 + 2 hours + 1); vm.prank(business); tc.attachEvidence(b, 0, keccak256("e"), "x"); _answer(b, ALL, ALL);
        assertEq(_final(b) & Q3, 0);
    }
    function test_evidence_by_the_other_side_or_for_another_question_does_not_count() public {
        _set(_evidence(2, uint32(3 days), 0, 0)); _agree();
        uint256 a = _open(); vm.prank(customer); tc.attachEvidence(a, 0, keccak256("e"), "x"); _answer(a, ALL, ALL); assertEq(_final(a) & Q3, 0);
        uint256 b = _open(); vm.prank(business); tc.attachEvidence(b, 1, keccak256("e"), "x"); _answer(b, ALL, ALL); assertEq(_final(b) & Q3, 0);
    }
    function test_evidence_by_a_helper_who_was_later_replaced_still_counts_as_the_side() public {
        _set(_evidence(2, uint32(3 days), 0, 0)); _agree(); uint256 id = _open();
        address h1 = makeAddr("h1"); vm.prank(business); tc.setOperator(id, true, h1);
        vm.prank(h1); tc.attachEvidence(id, 0, keccak256("e"), "x");
        vm.prank(business); tc.setOperator(id, true, address(0));
        _answer(id, ALL, ALL); assertEq(_final(id) & Q3, Q3);
    }
    function test_evidence_attached_after_both_sides_answered_does_not_change_the_fixed_answer() public {
        _set(_evidence(2, uint32(3 days), 0, 0)); _agree(); uint256 id = _open();
        _answer(id, ALL, ALL & ~Q1);   // Q3 fixed as "no": nothing attached, Q1 disputed
        vm.prank(business); tc.attachEvidence(id, 0, keccak256("late"), "x");
        vm.prank(reviewer); tc.acknowledgeReviewer(id); vm.prank(reviewer); tc.review(id, ALL);
        assertEq(_final(id) & Q3, 0);
    }
    function test_the_whole_case_evidence_slot_can_be_used() public {
        _set(_evidence(2, uint32(3 days), 1, 255)); _agree(); uint256 id = _open();
        vm.prank(customer); tc.attachEvidence(id, 255, keccak256("e"), "x"); _answer(id, ALL, ALL);
        assertEq(_final(id) & Q3, Q3);
    }

    // ----- kind 3: on-chain reads -----
    function test_a_read_at_least_and_equal() public {
        SourceV7 src = new SourceV7(); src.set(1000);
        _set(_read(2, address(src), abi.encodeWithSelector(bytes4(keccak256("value()"))), 1, 1000)); _agree();
        uint256 a = _open(); assertEq(tc.get(a).autoBits & Q3, Q3);
        src.set(999); uint256 b = _open(); assertEq(tc.get(b).autoMask & Q3, Q3); assertEq(tc.get(b).autoBits & Q3, 0);
    }
    function test_a_read_with_arguments_and_equal_comparison() public {
        SourceV7 src = new SourceV7(); src.set(7);
        _set(_read(2, address(src), abi.encodeWithSelector(SourceV7.balanceOf.selector, business), 2, 7)); _agree();
        uint256 a = _open(); assertEq(tc.get(a).autoBits & Q3, Q3);
        src.set(8); uint256 b = _open(); assertEq(tc.get(b).autoBits & Q3, 0);
    }
    function test_a_failing_source_leaves_the_question_to_the_parties() public {
        address[4] memory bad = [address(new RevertingSourceV7()), address(new ShortSourceV7()), address(new GasHogV7()), makeAddr("not a contract")];
        for (uint256 i = 0; i < bad.length; i++) {
            RuleSetRegistry r2 = new RuleSetRegistry(); FactSpecRegistry f2 = new FactSpecRegistry(r2);
            LGtieBilling b2 = new LGtieBilling(IERC20Min(address(new MockUSD())), makeAddr("treasury"), 0, LGtieBilling.Plan(0, 0, 0), LGtieBilling.Plan(0, 0, 0));
            TiebreakCaseV7 c2 = new TiebreakCaseV7(r2, ag, pk, address(proc), b2, f2); b2.setCases(address(c2));
            vm.prank(business); r2.publish(address(proc), 1, 7, 2, keccak256("d"), 0, "w");
            FactSpecRegistry.Spec[] memory l = new FactSpecRegistry.Spec[](1); l[0] = _read(2, bad[i], abi.encodeWithSelector(bytes4(keccak256("value()"))), 1, 1);
            vm.prank(business); f2.set(1, l);
            vm.prank(business); uint256 pid = ag.propose(Party(customer, 0), 1, keccak256("t"), reviewer, 3 days, 2 days); vm.prank(customer); ag.accept(pid);
            vm.prank(business); uint256 id = c2.openFromAgreement(pid, bytes32(0));
            assertEq(c2.get(id).autoMask, 0, "stays a human question");
        }
    }
    function test_a_hostile_source_cannot_make_opening_expensive() public {
        _set(_read(2, address(new GasHogV7()), abi.encodeWithSelector(bytes4(keccak256("value()"))), 1, 1)); _agree();
        uint256 g = gasleft(); _open(); assertLt(g - gasleft(), 400_000);
        FactSpecRegistry.Spec[] memory l = new FactSpecRegistry.Spec[](1); l[0] = _read(3, address(new ReturnBombV7()), abi.encodeWithSelector(bytes4(keccak256("value()"))), 1, 1);
        vm.prank(business); reg.publish(address(proc), 1, 7, 2, keccak256("d2"), 0, "w2"); vm.prank(business); facts.set(2, l);
        vm.prank(business); uint256 a2 = ag.propose(Party(customer, 0), 2, keccak256("t"), reviewer, 3 days, 2 days); vm.prank(customer); ag.accept(a2);
        g = gasleft(); vm.prank(business); tc.openFromAgreement(a2, bytes32(0)); assertLt(g - gasleft(), 400_000);
    }

    // ----- the fairness rule -----
    function test_a_spec_written_after_the_agreement_was_accepted_does_not_apply() public {
        _agree(); vm.warp(block.timestamp + 1); _set(_opened(2, uint64(block.timestamp - 100)));
        uint256 id = _open(); assertEq(tc.get(id).autoMask, 0);
        _answer(id, ALL, ALL); assertEq(_final(id), ALL);
    }
    function test_a_spec_written_in_the_same_second_as_acceptance_applies() public {
        _set(_opened(2, uint64(block.timestamp - 100))); _agree();   // same block timestamp
        assertEq(tc.get(_open()).autoMask, Q3);
    }
    function test_a_case_without_an_agreement_uses_the_spec_written_before_it_opened() public {
        _set(_opened(2, uint64(block.timestamp + DAY)));
        vm.prank(business); uint256 id = tc.open(rs, customer, reviewer, bytes32(0), 3 days, 2 days);
        assertEq(tc.get(id).autoMask, Q3); assertEq(tc.get(id).autoBits, Q3);
    }

    // ----- the registry -----
    function test_only_the_publisher_can_set_the_spec_and_only_once() public {
        FactSpecRegistry.Spec[] memory l = new FactSpecRegistry.Spec[](1); l[0] = _opened(2, 5);
        vm.prank(stranger); vm.expectRevert("only the publisher"); facts.set(rs, l);
        vm.prank(business); facts.set(rs, l);
        vm.prank(business); vm.expectRevert("already set"); facts.set(rs, l);
        (FactSpecRegistry.Spec[] memory got, uint64 at) = facts.get(rs); assertEq(got.length, 1); assertEq(at, block.timestamp);
    }
    function test_the_registry_rejects_bad_specs() public {
        FactSpecRegistry.Spec[] memory l = new FactSpecRegistry.Spec[](1);
        l[0] = _opened(7, 5); vm.prank(business); vm.expectRevert("no such question"); facts.set(rs, l);
        l[0] = _opened(2, 0); vm.prank(business); vm.expectRevert("no deadline"); facts.set(rs, l);
        l[0] = _evidence(2, 60, 0, 0); vm.prank(business); vm.expectRevert("time limit 1 hour to 90 days"); facts.set(rs, l);
        l[0] = _evidence(2, uint32(91 days), 0, 0); vm.prank(business); vm.expectRevert("time limit 1 hour to 90 days"); facts.set(rs, l);
        l[0] = _evidence(2, uint32(DAY), 2, 0); vm.prank(business); vm.expectRevert("role must be 0 or 1"); facts.set(rs, l);
        l[0] = _evidence(2, uint32(DAY), 0, 9); vm.prank(business); vm.expectRevert("evidence for a real question"); facts.set(rs, l);
        l[0] = _read(2, address(0), hex"12345678", 1, 1); vm.prank(business); vm.expectRevert("no source"); facts.set(rs, l);
        l[0] = _read(2, address(1), hex"123456", 1, 1); vm.prank(business); vm.expectRevert("call data 4 to 100 bytes"); facts.set(rs, l);
        l[0] = _read(2, address(1), new bytes(101), 1, 1); vm.prank(business); vm.expectRevert("call data 4 to 100 bytes"); facts.set(rs, l);
        l[0] = _read(2, address(1), hex"12345678", 3, 1); vm.prank(business); vm.expectRevert("comparison 1 or 2"); facts.set(rs, l);
        l[0].kind = 9; vm.prank(business); vm.expectRevert("unknown kind"); facts.set(rs, l);
        FactSpecRegistry.Spec[] memory two = new FactSpecRegistry.Spec[](2); two[0] = _opened(2, 5); two[1] = _opened(2, 6);
        vm.prank(business); vm.expectRevert("question already automatic"); facts.set(rs, two);
        FactSpecRegistry.Spec[] memory none = new FactSpecRegistry.Spec[](0);
        vm.prank(business); vm.expectRevert("1 to 8 automatic questions"); facts.set(rs, none);
        FactSpecRegistry.Spec[] memory nine = new FactSpecRegistry.Spec[](9);
        for (uint8 i = 0; i < 9; i++) nine[i] = _opened(i % 7, 5);
        vm.prank(business); vm.expectRevert("1 to 8 automatic questions"); facts.set(rs, nine);
    }
    function test_seven_automatic_questions_of_all_kinds_work_together_and_stay_in_the_gas_cap() public {
        SourceV7 src = new SourceV7(); src.set(50);
        FactSpecRegistry.Spec[] memory l = new FactSpecRegistry.Spec[](7);
        l[0] = _opened(0, uint64(block.timestamp + DAY)); l[1] = _opened(1, uint64(block.timestamp - 1)); l[2] = _read(2, address(src), abi.encodeWithSelector(bytes4(keccak256("value()"))), 1, 50);
        l[3] = _read(3, address(src), abi.encodeWithSelector(bytes4(keccak256("value()"))), 2, 51); l[4] = _evidence(4, uint32(DAY), 0, 4); l[5] = _evidence(5, uint32(DAY), 1, 255); l[6] = _evidence(6, uint32(DAY), 0, 6);
        vm.prank(business); facts.set(rs, l); _agree(); uint256 id = _open();
        for (uint256 i = 0; i < 14; i++) { vm.prank(business); tc.attachEvidence(id, 3, keccak256(abi.encode(i)), "x"); }
        vm.prank(business); tc.attachEvidence(id, 4, keccak256("e4"), "x"); vm.prank(customer); tc.attachEvidence(id, 255, keccak256("w"), "x");
        vm.prank(business); tc.submit(id, true, 0); uint256 g = gasleft(); vm.prank(customer); tc.submit(id, false, 0x7f);
        assertLt(g - gasleft(), 700_000);
        // Q1 yes (opened in time), Q2 no (past), Q3 yes (50>=50), Q4 no (50!=51), Q5 yes, Q6 yes (decider whole case), Q7 no (none)
        assertEq(tc.get(id).autoMask, ALL); assertEq(tc.get(id).autoBits, Q1 | Q3 | Q5 | Q6); assertEq(_status(id), 2); assertEq(_final(id), Q1 | Q3 | Q5 | Q6);
    }

    // ----- the verdict stays reproducible -----
    function test_replay_still_matches_for_a_case_with_automatic_questions() public {
        _set(_opened(2, uint64(block.timestamp - 1))); _agree(); uint256 id = _open(); _answer(id, ALL, ALL);
        (uint8 recomputed, uint8 stored, bool matches) = tc.replay(id); assertTrue(matches); assertEq(recomputed, stored);
    }
    function test_the_evidence_role_is_recorded() public {
        _agree(); uint256 id = _open(); vm.prank(business); tc.attachEvidence(id, 0, keccak256("e"), "x"); vm.prank(customer); tc.attachEvidence(id, 0, keccak256("f"), "y");
        assertEq(tc.evidenceAt(id, 0).role, 0); assertEq(tc.evidenceAt(id, 1).role, 1);
    }
}
