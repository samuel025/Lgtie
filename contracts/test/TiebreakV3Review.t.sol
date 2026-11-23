// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {TiebreakCaseV3} from "../src/TiebreakCaseV3.sol";
import {V3Base} from "./TiebreakV3.t.sol";

/// A processor that looks like TapeOut to the registry (right circuit shape) but whose eval always reverts.
contract RevertingProcessor {
    function circuitInfo(uint256) external pure returns (uint256, uint256) { return (7, 2); }
    function eval(uint256, bytes calldata) external pure returns (bytes memory) { revert("nope"); }
}

/// Security review notes for the DEPLOYED TiebreakCaseV3 / AgreementRegistry (see docs/SECURITY.md).
/// Each test pins down CURRENT behaviour that is a known limitation, so the claim in the docs is checked, not assumed.
/// None of these can lose funds (the contracts hold none). Fixing them needs a new contract version.
contract V3KnownLimitations is V3Base {
    /// F1: under an agreement the reviewer is "fixed in advance", but the contract still lets either side propose a new one after the
    /// dispute starts. That resets the other side's approval, so nobody can review until the other side accepts: a stall.
    function test_F1_a_side_can_replace_the_agreed_reviewer_and_stall_the_case() public {
        uint256 aid = _agreement();
        vm.prank(filer); uint256 id = tc.openFromAgreement(aid, bytes32(0));
        assertEq(tc.get(id).reviewer, reviewer);
        _dispute(id);
        // the losing side proposes a different reviewer, even though the agreement named one
        vm.prank(decider); tc.proposeReviewer(id, false, reviewer2);
        assertEq(tc.get(id).reviewer, reviewer2);
        assertFalse(tc.get(id).filerOkReviewer);                       // the other side has not accepted the new reviewer
        vm.prank(reviewer); vm.expectRevert("reviewer not accepted by both sides"); tc.review(id, ALL_YES);   // the agreed reviewer is locked out
        vm.prank(reviewer2); vm.expectRevert("reviewer not accepted by both sides"); tc.review(id, ALL_YES);
        vm.warp(block.timestamp + 3 days);
        tc.expire(id);
        assertEq(uint8(tc.get(id).status), uint8(TiebreakCaseV3.Status.Expired));            // ends as "no decision"
    }

    /// F2: a reviewer named in an agreement never has to agree. If the two parties disagree and nobody reviews, the case expires with
    /// both sides "accepting" the reviewer, so a record built only from chain data shows that reviewer as having missed a deadline.
    function test_F2_a_reviewer_who_never_consented_looks_like_they_missed_the_deadline() public {
        uint256 aid = _agreement();
        vm.prank(filer); uint256 id = tc.openFromAgreement(aid, bytes32(0));
        _dispute(id);
        vm.warp(block.timestamp + 3 days);
        tc.expire(id);                                                                       // the reviewer never made a single transaction
        TiebreakCaseV3.Case memory c = tc.get(id);
        assertTrue(c.filerOkReviewer && c.deciderOkReviewer);                                // "accepted by both sides"
        assertEq(uint8(c.status), uint8(TiebreakCaseV3.Status.Expired));
    }

    /// F3: evidence slots are shared (40 per case). One side can use them all and block the other side's evidence.
    function test_F3_one_side_can_use_every_evidence_slot() public {
        uint256 id = _open();
        vm.startPrank(filer);
        for (uint256 i = 0; i < 40; i++) tc.attachEvidence(id, 255, bytes32(i + 1), "x");
        vm.stopPrank();
        vm.prank(decider); vm.expectRevert("too much evidence"); tc.attachEvidence(id, 255, keccak256("real evidence"), "mine");
    }

    /// F4: the registry accepts any "processor" address with the right circuit shape. A processor whose eval reverts makes it
    /// impossible to finish a case that depends on it (the last answer reverts), so the case ends as "no decision".
    function test_F4_a_non_tapeout_processor_can_block_a_case() public {
        RevertingProcessor bad = new RevertingProcessor();
        vm.prank(publisher); uint256 rs = reg.publish(address(bad), 1, 7, 2, keccak256("defs"), 0, "Looks like warranty");
        vm.prank(filer); uint256 id = tc.open(rs, decider, reviewer, bytes32(0), 7 * DAY, 7 * DAY);
        vm.prank(filer); tc.submit(id, true, ALL_YES);
        vm.prank(decider); vm.expectRevert(bytes("nope")); tc.submit(id, false, ALL_YES);            // agreeing answers cannot finalize
    }

    /// F5: opening a case needs nobody's consent: any address can be named the decider (or proposed as reviewer).
    function test_F5_anyone_can_name_any_address_as_decider() public {
        vm.prank(stranger); uint256 id = tc.open(1, decider, reviewer, bytes32(0), DAY, DAY);
        assertEq(tc.get(id).decider, decider);
    }

    /// F6: a case that is not final reports result 0. Consumers MUST check isFinal first.
    function test_F6_non_final_verdict_reads_as_result_zero() public {
        uint256 id = _open();
        (bool isFinal, uint8 result,,) = tc.verdict(id);
        assertFalse(isFinal); assertEq(result, 0);
    }
}
