// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {V9Base} from "./PasskeyV9.t.sol";
import {AgreementRegistryV4} from "../src/AgreementRegistryV4.sol";
import {TiebreakCaseV7} from "../src/TiebreakCaseV7.sol";
import {PasskeyRegistry} from "../src/PasskeyRegistry.sol";

/// TiebreakCaseV7: an agreement card may leave the reviewer to be agreed after a dispute starts. Runs on a fork of X Layer for the real P-256 check.
contract ReviewerLaterTest is V9Base {
    bytes32 constant HA = keccak256("ada-handle"); bytes32 constant HB = keccak256("bola-handle");
    address rev2 = makeAddr("second reviewer");
    uint256 aid; uint256 acctA; uint256 acctB; uint256 caseId;

    function _card(address named) internal returns (uint256 id) {
        PasskeyRegistry.Key memory ka = _key(MAYA1, RP); PasskeyRegistry.Key memory kb = _key(MAYA2, RP);
        AgreementRegistryV4.Terms memory t = AgreementRegistryV4.Terms({ruleSetId: 1, termsHash: keccak256("deal"), reviewer: named, answerWindow: 3 * DAY, reviewWindow: 2 * DAY, expiry: uint64(block.timestamp + 30 days), salt: keccak256(abi.encode(named, block.timestamp))});
        bytes32 d = ag.cardDigest(t, ka, kb);
        AgreementRegistryV4.Signer memory a = AgreementRegistryV4.Signer(ka, HA, _assertion(MAYA1, RP, d)); AgreementRegistryV4.Signer memory b = AgreementRegistryV4.Signer(kb, HB, _assertion(MAYA2, RP, d));
        id = ag.anchor(t, a, b); acctA = ag.get(id).proposer.passkey; acctB = ag.get(id).counterparty.passkey;
    }
    function _open(uint256 agreement) internal returns (uint256 id) {
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, acctA, address(tc), keccak256(abi.encode("OPEN_CASE", agreement, bytes32(0), true)));
        vm.prank(relayer); id = tc.openFromAgreementSigned(agreement, bytes32(0), true, s);
    }
    function _answer(uint256 id, bool asFiler, uint64 ans) internal {
        uint256 acct = asFiler ? acctA : acctB; uint256 priv = asFiler ? MAYA1 : MAYA2;
        PasskeyRegistry.SigAuth memory s = _sig(priv, RP, 0, acct, address(tc), _submitPayload(id, asFiler, ans)); vm.prank(relayer); tc.submitSigned(id, asFiler, ans, s);
    }
    function _propose(uint256 id, bool asFiler, address r) internal {
        uint256 acct = asFiler ? acctA : acctB; uint256 priv = asFiler ? MAYA1 : MAYA2;
        PasskeyRegistry.SigAuth memory s = _sig(priv, RP, 0, acct, address(tc), keccak256(abi.encode("PROPOSE_REVIEWER", id, asFiler, r))); vm.prank(relayer); tc.proposeReviewerSigned(id, asFiler, r, s);
    }
    function _approvePayload(uint256 id, bool asFiler, address r) internal pure returns (bytes32) { return keccak256(abi.encode("APPROVE_REVIEWER", id, asFiler, r)); }
    function _approve(uint256 id, bool asFiler, address r) internal {
        uint256 acct = asFiler ? acctA : acctB; uint256 priv = asFiler ? MAYA1 : MAYA2;
        PasskeyRegistry.SigAuth memory s = _sig(priv, RP, 0, acct, address(tc), _approvePayload(id, asFiler, r)); vm.prank(relayer); tc.approveReviewerSigned(id, asFiler, s);
    }
    function _disputed() internal returns (uint256 id) { aid = _card(address(0)); id = _open(aid); _answer(id, true, ALL_YES); _answer(id, false, ALL_YES & ~Q5); }

    // ----- a case with no reviewer yet -----
    function test_a_case_under_a_card_with_no_reviewer_starts_with_none_and_nobody_approved() public {
        aid = _card(address(0)); caseId = _open(aid);
        assertEq(tc.get(caseId).reviewer, address(0)); assertFalse(tc.get(caseId).filerOkReviewer); assertFalse(tc.get(caseId).deciderOkReviewer);
    }
    function test_when_the_sides_agree_no_reviewer_is_ever_needed() public {
        aid = _card(address(0)); caseId = _open(aid); _answer(caseId, true, ALL_YES); _answer(caseId, false, ALL_YES);
        assertEq(uint8(tc.get(caseId).status), 2); assertEq(tc.get(caseId).finalAnswers, ALL_YES); assertEq(tc.get(caseId).reviewer, address(0));
    }
    function test_a_disagreement_waits_and_nobody_can_decide_until_a_reviewer_is_agreed() public {
        caseId = _disputed(); assertEq(uint8(tc.get(caseId).status), 1);
        vm.prank(reviewer); vm.expectRevert(); tc.review(caseId, ALL_YES);
        vm.prank(address(0xdead)); vm.expectRevert(); tc.review(caseId, ALL_YES);
    }
    function test_one_side_proposes_the_other_approves_and_the_reviewer_decides() public {
        caseId = _disputed();
        _propose(caseId, true, reviewer);
        assertEq(tc.get(caseId).reviewer, reviewer); assertTrue(tc.get(caseId).filerOkReviewer); assertFalse(tc.get(caseId).deciderOkReviewer);
        vm.prank(reviewer); vm.expectRevert("reviewer not accepted by both sides"); tc.review(caseId, ALL_YES);   // only one side so far
        _approve(caseId, false, reviewer); assertTrue(tc.get(caseId).deciderOkReviewer);
        vm.prank(reviewer); tc.review(caseId, ALL_YES);
        assertEq(uint8(tc.get(caseId).status), 2); assertEq(tc.get(caseId).finalAnswers, ALL_YES);
    }
    function test_the_other_side_can_propose_instead() public {
        caseId = _disputed(); _propose(caseId, false, reviewer); assertTrue(tc.get(caseId).deciderOkReviewer); assertFalse(tc.get(caseId).filerOkReviewer);
        _approve(caseId, true, reviewer); vm.prank(reviewer); tc.review(caseId, ALL_YES & ~Q5); assertEq(uint8(tc.get(caseId).status), 2);
    }
    function test_proposing_a_different_reviewer_resets_the_approvals() public {
        caseId = _disputed(); _propose(caseId, true, reviewer); _approve(caseId, false, reviewer);
        _propose(caseId, false, rev2);   // the decider now prefers someone else
        assertEq(tc.get(caseId).reviewer, rev2); assertTrue(tc.get(caseId).deciderOkReviewer); assertFalse(tc.get(caseId).filerOkReviewer);
        vm.prank(reviewer); vm.expectRevert(); tc.review(caseId, ALL_YES);
    }
    function test_an_approval_signed_for_one_reviewer_cannot_be_spent_on_another() public {
        caseId = _disputed(); _propose(caseId, true, reviewer);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA2, RP, 0, acctB, address(tc), _approvePayload(caseId, false, reviewer));   // B approves `reviewer`, not yet submitted
        _propose(caseId, true, rev2);   // A replaces the reviewer before it is submitted
        vm.prank(relayer); vm.expectRevert(); tc.approveReviewerSigned(caseId, false, s);
        assertFalse(tc.get(caseId).deciderOkReviewer);
    }

    // ----- limits -----
    function test_bad_proposals_and_approvals_are_refused() public {
        caseId = _disputed();
        PasskeyRegistry.SigAuth memory s0 = _sig(MAYA2, RP, 0, acctB, address(tc), _approvePayload(caseId, false, address(0)));
        vm.prank(relayer); vm.expectRevert("no reviewer has been proposed"); tc.approveReviewerSigned(caseId, false, s0);
        PasskeyRegistry.SigAuth memory s1 = _sig(MAYA1, RP, 0, acctA, address(tc), keccak256(abi.encode("PROPOSE_REVIEWER", caseId, true, address(0))));
        vm.prank(relayer); vm.expectRevert("reviewer must be neutral"); tc.proposeReviewerSigned(caseId, true, address(0), s1);
        PasskeyRegistry.SigAuth memory bad = _sig(MAYA2, RP, 0, acctA, address(tc), keccak256(abi.encode("PROPOSE_REVIEWER", caseId, true, reviewer)));   // B's key on A's account
        vm.prank(relayer); vm.expectRevert(); tc.proposeReviewerSigned(caseId, true, reviewer, bad);
        PasskeyRegistry.SigAuth memory wrongSide = _sig(MAYA1, RP, 0, acctA, address(tc), keccak256(abi.encode("PROPOSE_REVIEWER", caseId, false, reviewer)));
        vm.prank(relayer); vm.expectRevert(); tc.proposeReviewerSigned(caseId, true, reviewer, wrongSide);   // signed for the decider's side, used for the filer's
    }
    function test_a_signed_proposal_cannot_be_replayed() public {
        caseId = _disputed();
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, acctA, address(tc), keccak256(abi.encode("PROPOSE_REVIEWER", caseId, true, reviewer)));
        vm.prank(relayer); tc.proposeReviewerSigned(caseId, true, reviewer, s);
        vm.prank(relayer); vm.expectRevert(); tc.proposeReviewerSigned(caseId, true, reviewer, s);
    }
    function test_a_reviewer_named_in_the_agreement_stays_fixed() public {
        aid = _card(reviewer); caseId = _open(aid); _answer(caseId, true, ALL_YES); _answer(caseId, false, ALL_YES & ~Q5);
        assertTrue(tc.get(caseId).filerOkReviewer); assertTrue(tc.get(caseId).deciderOkReviewer);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, acctA, address(tc), keccak256(abi.encode("PROPOSE_REVIEWER", caseId, true, rev2)));
        vm.prank(relayer); vm.expectRevert("the agreement fixed the reviewer"); tc.proposeReviewerSigned(caseId, true, rev2, s);
        vm.prank(reviewer); tc.review(caseId, ALL_YES); assertEq(uint8(tc.get(caseId).status), 2);   // and it decides as before
    }
    function test_with_no_reviewer_agreed_by_the_deadline_the_case_expires_and_nobody_wins() public {
        caseId = _disputed(); vm.warp(block.timestamp + 2 * DAY + 1);
        vm.prank(vm.addr(1)); tc.expire(caseId); assertEq(uint8(tc.get(caseId).status), 3);
    }
    function test_the_reviewer_cannot_be_proposed_after_the_case_is_decided() public {
        caseId = _disputed(); _propose(caseId, true, reviewer); _approve(caseId, false, reviewer); vm.prank(reviewer); tc.review(caseId, ALL_YES);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, acctA, address(tc), keccak256(abi.encode("PROPOSE_REVIEWER", caseId, true, rev2)));
        vm.prank(relayer); vm.expectRevert("case is closed"); tc.proposeReviewerSigned(caseId, true, rev2, s);
    }
    function test_a_wallet_approval_also_needs_a_reviewer_first() public {
        aid = _card(address(0)); caseId = _open(aid);
        vm.expectRevert(); tc.approveReviewer(caseId, false);   // not a wallet side, and no reviewer
    }
}
