// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {V8Base} from "./PasskeyV8.t.sol";
import {AgreementRegistryV4} from "../src/AgreementRegistryV4.sol";
import {PasskeyRegistry} from "../src/PasskeyRegistry.sol";
import {WebAuthnP256} from "../src/WebAuthnP256.sol";
import {Party} from "../src/Party.sol";

/// Agreement cards: two passkeys sign one deal off-chain, and anyone records it later. Runs on a fork of X Layer for the real P-256 check.
contract AgreementCardsTest is V8Base {
    PasskeyRegistry.Key ka; PasskeyRegistry.Key kb;
    bytes32 constant HA = keccak256("ada-handle"); bytes32 constant HB = keccak256("bola-handle");
    AgreementRegistryV4.Terms t;

    function setUp() public override {
        super.setUp();
        ka = _key(MAYA1, RP); kb = _key(MAYA2, RP);
        t = AgreementRegistryV4.Terms({ruleSetId: 1, termsHash: keccak256("deal: iPhone 12, N250,000"), reviewer: reviewer, answerWindow: 3 * DAY, reviewWindow: 2 * DAY, expiry: uint64(block.timestamp + 30 days), salt: keccak256("salt")});
    }

    function _signer(uint256 priv, PasskeyRegistry.Key memory k, bytes32 handle, bytes32 digest) internal view returns (AgreementRegistryV4.Signer memory s) {
        s.key = k; s.handleHash = handle; s.assertion = _assertion(priv, RP, digest);
    }
    function _digest() internal view returns (bytes32) { return ag.cardDigest(t, ka, kb); }
    function _card() internal view returns (AgreementRegistryV4.Signer memory a, AgreementRegistryV4.Signer memory b) {
        bytes32 d = _digest(); a = _signer(MAYA1, ka, HA, d); b = _signer(MAYA2, kb, HB, d);
    }

    // ----- recording a card -----
    function test_a_card_becomes_an_agreement_in_force_between_two_new_accounts() public {
        (AgreementRegistryV4.Signer memory a, AgreementRegistryV4.Signer memory b) = _card();
        uint256 before_ = pk.count();
        vm.prank(stranger); uint256 id = ag.anchor(t, a, b);
        assertEq(pk.count(), before_ + 2);
        AgreementRegistryV4.Agreement memory g = ag.get(id);
        assertEq(g.proposer.wallet, address(0)); assertEq(g.counterparty.wallet, address(0));
        assertEq(g.proposer.passkey, pk.accountOfHandle(HA)); assertEq(g.counterparty.passkey, pk.accountOfHandle(HB));
        assertEq(g.ruleSetId, 1); assertEq(g.termsHash, t.termsHash); assertEq(g.reviewer, reviewer); assertEq(g.acceptedAt, block.timestamp);
        assertTrue(ag.inForce(id)); assertEq(ag.anchoredAs(_digest()), id);
    }
    function test_existing_accounts_with_the_same_key_are_reused() public {
        uint256 acctA = _account(MAYA1, "ada-handle-x");   // a different handle: not the one the card names
        vm.prank(relayer); uint256 pre = pk.create(HA, ka);   // the card's own handle, registered earlier with the right key
        (AgreementRegistryV4.Signer memory a, AgreementRegistryV4.Signer memory b) = _card();
        uint256 n = pk.count();
        vm.prank(stranger); uint256 id = ag.anchor(t, a, b);
        assertEq(ag.get(id).proposer.passkey, pre); assertEq(pk.count(), n + 1);   // only the second account was created
        assertTrue(acctA != 0);
    }
    function test_a_handle_registered_to_another_key_blocks_that_card() public {
        vm.prank(makeAddr("squatter")); pk.create(HA, _key(EVE, RP));
        (AgreementRegistryV4.Signer memory a, AgreementRegistryV4.Signer memory b) = _card();
        vm.prank(stranger); vm.expectRevert("that handle belongs to another key"); ag.anchor(t, a, b);
    }
    function test_the_same_card_cannot_be_recorded_twice() public {
        (AgreementRegistryV4.Signer memory a, AgreementRegistryV4.Signer memory b) = _card();
        ag.anchor(t, a, b);
        vm.expectRevert("already recorded"); ag.anchor(t, a, b);
    }
    function test_a_card_with_a_different_salt_is_a_different_card() public {
        (AgreementRegistryV4.Signer memory a, AgreementRegistryV4.Signer memory b) = _card();
        uint256 one = ag.anchor(t, a, b);
        t.salt = keccak256("another deal"); (a, b) = _card();
        uint256 two = ag.anchor(t, a, b); assertEq(two, one + 1);
    }

    // ----- what a signature is bound to -----
    function test_changing_any_term_after_signing_invalidates_the_signatures() public {
        (AgreementRegistryV4.Signer memory a, AgreementRegistryV4.Signer memory b) = _card();
        AgreementRegistryV4.Terms memory orig = t;
        t.termsHash = keccak256("other terms"); vm.expectRevert("first passkey signature is not valid"); ag.anchor(t, a, b); t = orig;
        t.reviewer = makeAddr("someone else"); vm.expectRevert("first passkey signature is not valid"); ag.anchor(t, a, b); t = orig;
        t.ruleSetId = 1; t.answerWindow = 4 * DAY; vm.expectRevert("first passkey signature is not valid"); ag.anchor(t, a, b); t = orig;
        t.reviewWindow = 3 * DAY; vm.expectRevert("first passkey signature is not valid"); ag.anchor(t, a, b); t = orig;
        t.expiry = orig.expiry + 1; vm.expectRevert("first passkey signature is not valid"); ag.anchor(t, a, b); t = orig;
        t.salt = bytes32(uint256(1)); vm.expectRevert("first passkey signature is not valid"); ag.anchor(t, a, b); t = orig;
        ag.anchor(t, a, b);   // the exact card goes through
    }
    function test_a_signature_binds_both_keys_so_a_third_passkey_cannot_take_the_other_seat() public {
        bytes32 d = _digest(); AgreementRegistryV4.Signer memory a = _signer(MAYA1, ka, HA, d);
        PasskeyRegistry.Key memory kc = _key(EVE, RP);
        AgreementRegistryV4.Signer memory c = _signer(EVE, kc, keccak256("eve"), ag.cardDigest(t, ka, kc));   // Eve signs a card that names Ada and Eve
        vm.expectRevert(); ag.anchor(t, a, c);   // Ada never signed a card with Eve in it
    }
    function test_a_signature_from_the_wrong_key_is_refused() public {
        bytes32 d = _digest();
        AgreementRegistryV4.Signer memory a = _signer(EVE, ka, HA, d);   // Eve's private key, Ada's public key
        AgreementRegistryV4.Signer memory b = _signer(MAYA2, kb, HB, d);
        vm.expectRevert("first passkey signature is not valid"); ag.anchor(t, a, b);
    }
    function test_the_order_of_the_signers_is_part_of_the_card() public view {
        assertTrue(ag.cardDigest(t, ka, kb) != ag.cardDigest(t, kb, ka));
    }
    function test_a_card_cannot_be_recorded_on_another_registry() public {
        AgreementRegistryV4 other = new AgreementRegistryV4(reg, pk);
        (AgreementRegistryV4.Signer memory a, AgreementRegistryV4.Signer memory b) = _card();
        vm.expectRevert(); other.anchor(t, a, b);
    }

    // ----- limits -----
    function test_an_expired_card_cannot_be_recorded() public {
        (AgreementRegistryV4.Signer memory a, AgreementRegistryV4.Signer memory b) = _card();
        vm.warp(t.expiry + 1); vm.expectRevert("the card has expired"); ag.anchor(t, a, b);
        vm.warp(t.expiry); ag.anchor(t, a, b);   // exactly on the last day still counts
    }
    function test_bad_cards_are_refused() public {
        AgreementRegistryV4.Signer memory a; AgreementRegistryV4.Signer memory b;
        bytes32 d = _digest(); a = _signer(MAYA1, ka, HA, d);
        vm.expectRevert("two different passkeys"); ag.anchor(t, a, a);
        AgreementRegistryV4.Terms memory orig = t;
        t.ruleSetId = 99; (a, b) = _card(); vm.expectRevert(); ag.anchor(t, a, b); t = orig;
        t.answerWindow = 10; (a, b) = _card(); vm.expectRevert("answer window 1 hour..90 days"); ag.anchor(t, a, b); t = orig;
        t.reviewWindow = uint32(91 days); (a, b) = _card(); vm.expectRevert("review window 1 hour..90 days"); ag.anchor(t, a, b); t = orig;
    }
    function test_a_card_may_leave_the_reviewer_to_be_agreed_later() public {
        t.reviewer = address(0); (AgreementRegistryV4.Signer memory a, AgreementRegistryV4.Signer memory b) = _card();
        uint256 id = ag.anchor(t, a, b); assertEq(ag.get(id).reviewer, address(0)); assertTrue(ag.inForce(id));
    }

    // ----- a case under a recorded card, on the existing case contract (reviewer named in the card) -----
    function test_a_case_runs_under_a_recorded_card() public {
        (AgreementRegistryV4.Signer memory a, AgreementRegistryV4.Signer memory b) = _card();
        uint256 aid = ag.anchor(t, a, b); uint256 acctA = ag.get(aid).proposer.passkey;
        PasskeyRegistry.SigAuth memory so = _sig(MAYA1, RP, 0, acctA, address(tc), keccak256(abi.encode("OPEN_CASE", aid, bytes32(0), true)));
        vm.prank(relayer); uint256 id = tc.openFromAgreementSigned(aid, bytes32(0), true, so);
        assertEq(tc.get(id).filer.passkey, acctA);
        PasskeyRegistry.SigAuth memory sa = _sig(MAYA1, RP, 0, acctA, address(tc), _submitPayload(id, true, ALL_YES)); vm.prank(relayer); tc.submitSigned(id, true, ALL_YES, sa);
        uint256 acctB = ag.get(aid).counterparty.passkey;
        PasskeyRegistry.SigAuth memory sb = _sig(MAYA2, RP, 0, acctB, address(tc), _submitPayload(id, false, ALL_YES)); vm.prank(relayer); tc.submitSigned(id, false, ALL_YES, sb);
        assertEq(uint8(tc.get(id).status), 2); assertEq(tc.get(id).finalAnswers, ALL_YES);
    }
}
