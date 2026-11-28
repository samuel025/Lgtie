// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {V7Base} from "./PasskeyV7.t.sol";
import {AgreementRegistryV3} from "../src/AgreementRegistryV3.sol";
import {PasskeyRegistry} from "../src/PasskeyRegistry.sol";
import {Party} from "../src/Party.sol";

/// What AgreementRegistryV3 adds: a passkey account can PROPOSE, by signature that anyone may submit. Runs on a fork of X Layer for the real P-256 check.
contract AgreementV3Test is V7Base {
    uint256 a1; uint256 a2; // passkey accounts: a1 signs with MAYA1, a2 with MAYA2
    address seller = makeAddr("sellerWallet");

    function setUp() public override { super.setUp(); a1 = _account(MAYA1, "ada"); a2 = _account(MAYA2, "bola"); }

    function _proposalPayload(uint256 who, Party memory cp, uint256 rs, bytes32 terms, address rev, uint32 aw, uint32 rw) internal pure returns (bytes32) {
        return keccak256(abi.encode("PROPOSE_AGREEMENT", who, cp, rs, terms, rev, aw, rw));
    }
    function _propose(uint256 who, uint256 priv, Party memory cp) internal returns (uint256 aid) {
        PasskeyRegistry.SigAuth memory s = _sig(priv, RP, 0, who, address(ag), _proposalPayload(who, cp, 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY));
        vm.prank(relayer); aid = ag.proposeSigned(who, cp, 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY, s);
    }

    // ----- proposing by passkey -----
    function test_a_passkey_account_proposes_and_a_wallet_counterparty_accepts() public {
        uint256 aid = _propose(a1, MAYA1, Party(seller, 0));
        AgreementRegistryV3.Agreement memory a = ag.get(aid);
        assertEq(a.proposer.wallet, address(0)); assertEq(a.proposer.passkey, a1); assertEq(a.counterparty.wallet, seller); assertEq(a.acceptedAt, 0);
        vm.prank(seller); ag.accept(aid); assertTrue(ag.inForce(aid));
    }
    function test_two_passkey_accounts_make_an_agreement_with_nobody_holding_a_wallet_except_the_submitter() public {
        uint256 aid = _propose(a1, MAYA1, Party(address(0), a2));
        PasskeyRegistry.SigAuth memory s = _sig(MAYA2, RP, 0, a2, address(ag), _acceptPayload(aid));
        vm.prank(stranger); ag.acceptSigned(aid, s); assertTrue(ag.inForce(aid));
    }
    function test_the_signature_is_bound_to_every_term() public {
        Party memory cp = Party(seller, 0);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, a1, address(ag), _proposalPayload(a1, cp, 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY));
        vm.prank(relayer); vm.expectRevert(); ag.proposeSigned(a1, cp, 1, keccak256("other terms"), reviewer, 3 * DAY, 2 * DAY, s);
        vm.prank(relayer); vm.expectRevert(); ag.proposeSigned(a1, cp, 1, keccak256("terms"), makeAddr("someone else"), 3 * DAY, 2 * DAY, s);
        vm.prank(relayer); vm.expectRevert(); ag.proposeSigned(a1, Party(makeAddr("not the seller"), 0), 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY, s);
        vm.prank(relayer); vm.expectRevert(); ag.proposeSigned(a1, cp, 1, keccak256("terms"), reviewer, 4 * DAY, 2 * DAY, s);
        vm.prank(relayer); vm.expectRevert(); ag.proposeSigned(a1, cp, 1, keccak256("terms"), reviewer, 3 * DAY, 3 * DAY, s);
        vm.prank(relayer); ag.proposeSigned(a1, cp, 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY, s);   // the exact terms go through
    }
    function test_a_signed_proposal_cannot_be_replayed() public {
        Party memory cp = Party(seller, 0);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, a1, address(ag), _proposalPayload(a1, cp, 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY));
        vm.prank(relayer); ag.proposeSigned(a1, cp, 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY, s);
        vm.prank(relayer); vm.expectRevert(); ag.proposeSigned(a1, cp, 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY, s);
    }
    function test_a_signed_proposal_cannot_be_spent_on_another_registry() public {
        AgreementRegistryV3 other = new AgreementRegistryV3(reg, pk);
        Party memory cp = Party(seller, 0);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, a1, address(ag), _proposalPayload(a1, cp, 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY));
        vm.prank(relayer); vm.expectRevert(); other.proposeSigned(a1, cp, 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY, s);
    }
    function test_someone_elses_key_cannot_propose_for_an_account() public {
        Party memory cp = Party(seller, 0);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA2, RP, 0, a1, address(ag), _proposalPayload(a1, cp, 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY));   // MAYA2's key, account a1
        vm.prank(relayer); vm.expectRevert(); ag.proposeSigned(a1, cp, 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY, s);
    }
    function test_bad_proposals_are_refused() public {
        Party memory cp = Party(seller, 0); PasskeyRegistry.SigAuth memory s;
        vm.prank(relayer); vm.expectRevert("unknown passkey account"); ag.proposeSigned(99, cp, 1, keccak256("t"), reviewer, 3 * DAY, 2 * DAY, s);
        vm.prank(relayer); vm.expectRevert("unknown passkey account"); ag.proposeSigned(0, cp, 1, keccak256("t"), reviewer, 3 * DAY, 2 * DAY, s);
        vm.prank(relayer); vm.expectRevert("bad counterparty"); ag.proposeSigned(a1, Party(address(0), a1), 1, keccak256("t"), reviewer, 3 * DAY, 2 * DAY, s);
        vm.prank(relayer); vm.expectRevert("counterparty is a wallet or a passkey account"); ag.proposeSigned(a1, Party(seller, a2), 1, keccak256("t"), reviewer, 3 * DAY, 2 * DAY, s);
        vm.prank(relayer); vm.expectRevert("reviewer must be neutral"); ag.proposeSigned(a1, cp, 1, keccak256("t"), seller, 3 * DAY, 2 * DAY, s);
        vm.prank(relayer); vm.expectRevert("reviewer must be neutral"); ag.proposeSigned(a1, cp, 1, keccak256("t"), address(0), 3 * DAY, 2 * DAY, s);
        vm.prank(relayer); vm.expectRevert("answer window 1 hour..90 days"); ag.proposeSigned(a1, cp, 1, keccak256("t"), reviewer, 10, 2 * DAY, s);
        vm.prank(relayer); vm.expectRevert(); ag.proposeSigned(a1, cp, 777, keccak256("t"), reviewer, 3 * DAY, 2 * DAY, s);   // no such rule set
    }
    function test_the_wallet_proposal_path_is_unchanged() public {
        vm.prank(business); uint256 aid = ag.propose(Party(seller, 0), 1, keccak256("t"), reviewer, 3 * DAY, 2 * DAY);
        assertEq(ag.get(aid).proposer.wallet, business); assertEq(ag.get(aid).proposer.passkey, 0);
        vm.prank(business); vm.expectRevert("reviewer must be neutral"); ag.propose(Party(seller, 0), 1, keccak256("t"), business, 3 * DAY, 2 * DAY);
    }

    // ----- withdrawing -----
    function test_a_passkey_proposer_withdraws_before_acceptance_and_not_after() public {
        uint256 aid = _propose(a1, MAYA1, Party(seller, 0));
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, a1, address(ag), keccak256(abi.encode("CANCEL_AGREEMENT", aid)));
        vm.prank(stranger); ag.cancelSigned(aid, s); assertTrue(ag.get(aid).cancelled);
        vm.prank(seller); vm.expectRevert("not open for acceptance"); ag.accept(aid);
        uint256 aid2 = _propose(a1, MAYA1, Party(seller, 0)); vm.prank(seller); ag.accept(aid2);
        PasskeyRegistry.SigAuth memory s2 = _sig(MAYA1, RP, 0, a1, address(ag), keccak256(abi.encode("CANCEL_AGREEMENT", aid2)));
        vm.prank(stranger); vm.expectRevert("not open for cancellation"); ag.cancelSigned(aid2, s2);
    }
    function test_only_the_proposing_account_can_withdraw_and_a_wallet_proposal_has_no_signed_cancel() public {
        uint256 aid = _propose(a1, MAYA1, Party(seller, 0));
        PasskeyRegistry.SigAuth memory bad = _sig(MAYA2, RP, 0, a2, address(ag), keccak256(abi.encode("CANCEL_AGREEMENT", aid)));
        vm.prank(stranger); vm.expectRevert(); ag.cancelSigned(aid, bad);
        vm.prank(seller); vm.expectRevert("only the proposer"); ag.cancel(aid);
        vm.prank(business); uint256 w = ag.propose(Party(seller, 0), 1, keccak256("t"), reviewer, 3 * DAY, 2 * DAY);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, a1, address(ag), keccak256(abi.encode("CANCEL_AGREEMENT", w)));
        vm.prank(stranger); vm.expectRevert("the proposer is a wallet"); ag.cancelSigned(w, s);
        vm.prank(business); ag.cancel(w);
    }

    // ----- a whole case under a passkey-proposed agreement, on the existing case contract -----
    function test_a_case_under_a_passkey_proposed_agreement_runs_end_to_end() public {
        uint256 aid = _propose(a1, MAYA1, Party(seller, 0)); vm.prank(seller); ag.accept(aid);
        // the passkey proposer opens the case by signature; someone else submits and pays
        PasskeyRegistry.SigAuth memory so = _sig(MAYA1, RP, 0, a1, address(tc), keccak256(abi.encode("OPEN_CASE", aid, bytes32(0), true)));
        vm.prank(relayer); uint256 id = tc.openFromAgreementSigned(aid, bytes32(0), true, so);
        assertEq(tc.get(id).filer.passkey, a1); assertEq(tc.get(id).decider.wallet, seller);
        PasskeyRegistry.SigAuth memory sa = _sig(MAYA1, RP, 0, a1, address(tc), _submitPayload(id, true, ALL_YES));
        vm.prank(relayer); tc.submitSigned(id, true, ALL_YES, sa);
        vm.prank(seller); tc.submit(id, false, ALL_YES);
        assertEq(uint8(tc.get(id).status), 2); assertEq(tc.get(id).finalAnswers, ALL_YES);
    }
    function test_a_wallet_counterparty_can_open_a_case_under_it_too() public {
        uint256 aid = _propose(a1, MAYA1, Party(seller, 0)); vm.prank(seller); ag.accept(aid);
        vm.prank(seller); uint256 id = tc.openFromAgreement(aid, bytes32(0));
        assertEq(tc.get(id).filer.wallet, seller); assertEq(tc.get(id).decider.passkey, a1);
    }
    function test_a_case_cannot_open_under_an_unaccepted_or_withdrawn_agreement() public {
        uint256 aid = _propose(a1, MAYA1, Party(seller, 0));
        vm.prank(seller); vm.expectRevert("agreement not in force"); tc.openFromAgreement(aid, bytes32(0));
    }
}
