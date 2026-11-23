// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {RuleSetRegistry} from "../src/RuleSetRegistry.sol";
import {PasskeyRegistry} from "../src/PasskeyRegistry.sol";
import {AgreementRegistryV2} from "../src/AgreementRegistryV2.sol";
import {TiebreakCaseV4} from "../src/TiebreakCaseV4.sol";
import {WebAuthnP256} from "../src/WebAuthnP256.sol";
import {Party} from "../src/Party.sol";
import {MockProcessor} from "./Mock.sol";

/// Shared setup. Runs on a fork of X Layer so signatures go through a real P-256 verifier. Test passkeys are made with vm.signP256 and
/// wrapped as WebAuthn assertions exactly as a browser would build them (authenticator data, client data JSON, signature over their hash).
contract V4Base is Test {
    RuleSetRegistry reg; PasskeyRegistry pk; AgreementRegistryV2 ag; TiebreakCaseV4 tc; MockProcessor proc;
    address business = makeAddr("business"); address reviewer = makeAddr("reviewer"); address stranger = makeAddr("stranger"); address relayer = makeAddr("relayer");
    uint256 constant MAYA1 = 0xA11CE0A11CE0A11CE0A11CE0A11CE0A11CE0A11CE0A11CE0A11CE0A11CE; uint256 constant MAYA2 = 0xB0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B;
    uint256 constant EVE = 0xE5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5;
    bytes32 constant RP = 0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763;   // sha256("localhost"); a literal so using it makes no precompile call that could swallow vm.expectRevert
    bytes32 constant RP2 = 0x8d371f9c19c6468198e84f8e08f65d844782746710d55ec42be74419dd06ea49;  // sha256("lgtie.example")
    uint64 constant ALL_YES = 0x7f; uint64 constant Q5 = 1 << 4; uint32 constant DAY = 1 days;

    function setUp() public virtual {
        vm.createSelectFork("https://rpc.xlayer.tech");
        proc = new MockProcessor(); reg = new RuleSetRegistry(); pk = new PasskeyRegistry(); ag = new AgreementRegistryV2(reg, pk);
        tc = new TiebreakCaseV4(reg, ag, pk, address(proc));
        vm.prank(business); reg.publish(address(proc), 1, 7, 2, keccak256("defs v1"), 0, "Warranty v1");
    }

    // ----- passkey helpers -----
    function _key(uint256 priv, bytes32 rp) internal view returns (PasskeyRegistry.Key memory k) { (uint256 x, uint256 y) = vm.publicKeyP256(priv); k = PasskeyRegistry.Key(x, y, rp); }
    function _assertion(uint256 priv, bytes32 rp, bytes32 challenge) internal pure returns (WebAuthnP256.Assertion memory a) {
        bytes memory ad = abi.encodePacked(rp, bytes1(0x05), bytes4(uint32(1)));
        string memory cdj = string.concat('{"type":"webauthn.get","challenge":"', string(WebAuthnP256.base64url(challenge)), '","origin":"http://localhost","crossOrigin":false}');
        (bytes32 r, bytes32 s) = vm.signP256(priv, sha256(abi.encodePacked(ad, sha256(bytes(cdj)))));
        a = WebAuthnP256.Assertion(ad, cdj, 1, 23, uint256(r), uint256(s));
    }
    /// A signed action for `account`, meant to be spent by `consumer`, using the account's current nonce.
    function _sig(uint256 priv, bytes32 rp, uint8 keyIndex, uint256 account, address consumer, bytes32 payload) internal view returns (PasskeyRegistry.SigAuth memory s) {
        s.nonce = pk.nonceOf(account); s.deadline = block.timestamp + 1 hours; s.keyIndex = keyIndex;
        s.assertion = _assertion(priv, rp, pk.challengeFor(account, consumer, payload, s.nonce, s.deadline));
    }
    function _account(uint256 priv, string memory handle) internal returns (uint256 id) { vm.prank(relayer); id = pk.create(keccak256(bytes(handle)), _key(priv, RP)); }

    // ----- payload helpers (must match the contracts) -----
    function _submitPayload(uint256 id, bool asFiler, uint64 answers) internal pure returns (bytes32) { return keccak256(abi.encode("SUBMIT", id, asFiler, answers)); }
    function _acceptPayload(uint256 aid) internal view returns (bytes32) { return keccak256(abi.encode("ACCEPT_AGREEMENT", aid, ag.termsDigestOf(aid))); }

    // ----- scenario helpers -----
    function _agreementWithPasskey(uint256 account) internal returns (uint256 aid) {
        vm.prank(business); aid = ag.propose(Party(address(0), account), 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, account, address(ag), _acceptPayload(aid));
        vm.prank(relayer); ag.acceptSigned(aid, s);
    }
    /// Business (wallet) files; Maya (passkey) is the decider.
    function _caseWithMaya(uint256 account) internal returns (uint256 id, uint256 aid) {
        aid = _agreementWithPasskey(account);
        vm.prank(business); id = tc.openFromAgreement(aid, bytes32(0));
    }
    function _mayaSubmits(uint256 id, uint256 account, uint64 answers) internal {
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, account, address(tc), _submitPayload(id, false, answers));
        vm.prank(relayer); tc.submitSigned(id, false, answers, s);
    }
}

contract PasskeyRegistryTest is V4Base {
    function test_create_stores_the_key_and_finds_the_account_by_handle() public {
        uint256 id = _account(MAYA1, "maya-handle");
        assertEq(id, 1); assertEq(pk.count(), 1); assertEq(pk.keyCount(id), 1); assertEq(pk.accountOfHandle(keccak256("maya-handle")), id); assertTrue(pk.exists(id));
        PasskeyRegistry.Key memory k = pk.keyAt(id, 0); (uint256 x, uint256 y) = vm.publicKeyP256(MAYA1);
        assertEq(k.x, x); assertEq(k.y, y); assertEq(k.rpIdHash, RP);
    }

    function test_a_handle_cannot_be_registered_twice_and_bad_keys_are_refused() public {
        _account(MAYA1, "h"); PasskeyRegistry.Key memory other = _key(MAYA2, RP);
        vm.expectRevert("handle unavailable"); pk.create(keccak256("h"), other);
        vm.expectRevert("handle unavailable"); pk.create(bytes32(0), other);
        vm.expectRevert("bad key"); pk.create(keccak256("other"), PasskeyRegistry.Key(0, 1, RP));
        vm.expectRevert("bad key"); pk.create(keccak256("other"), PasskeyRegistry.Key(1, 1, bytes32(0)));
    }

    function test_a_valid_signed_action_is_consumed_once() public {
        uint256 id = _account(MAYA1, "h"); bytes32 payload = keccak256("anything");
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, id, address(this), payload);
        uint256 g = gasleft(); pk.verifyAndBump(id, payload, s); emit log_named_uint("gas for one signed action (fork, fallback verifier)", g - gasleft());
        assertEq(pk.nonceOf(id), 1);
        vm.expectRevert("bad nonce"); pk.verifyAndBump(id, payload, s);                      // replay of the same signed action
    }

    function test_nonces_must_be_used_in_order_and_signatures_expire() public {
        uint256 id = _account(MAYA1, "h"); bytes32 payload = keccak256("x");
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, id, address(this), payload); s.nonce = 5;
        s.assertion = _assertion(MAYA1, RP, pk.challengeFor(id, address(this), payload, 5, s.deadline));
        vm.expectRevert("bad nonce"); pk.verifyAndBump(id, payload, s);
        s = _sig(MAYA1, RP, 0, id, address(this), payload);
        vm.warp(s.deadline + 1); vm.expectRevert("signature expired"); pk.verifyAndBump(id, payload, s);
    }

    function test_a_signature_cannot_be_spent_by_a_different_contract_or_for_a_different_action() public {
        uint256 id = _account(MAYA1, "h"); bytes32 payload = keccak256("x");
        PasskeyRegistry.SigAuth memory forOther = _sig(MAYA1, RP, 0, id, address(0xdead), payload);   // meant for another consumer
        vm.expectRevert("bad passkey signature"); pk.verifyAndBump(id, payload, forOther);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, id, address(this), payload);
        vm.expectRevert("bad passkey signature"); pk.verifyAndBump(id, keccak256("a different action"), s);
        assertEq(pk.nonceOf(id), 0);                                                                // nothing was burned by the failed attempts
    }

    function test_someone_elses_passkey_cannot_act_for_the_account() public {
        uint256 id = _account(MAYA1, "h"); bytes32 payload = keccak256("x");
        PasskeyRegistry.SigAuth memory s = _sig(EVE, RP, 0, id, address(this), payload);
        vm.expectRevert("bad passkey signature"); pk.verifyAndBump(id, payload, s);
        s = _sig(MAYA1, RP, 0, id, address(this), payload); s.keyIndex = 3;
        vm.expectRevert("no such key"); pk.verifyAndBump(id, payload, s);
        vm.expectRevert("unknown account"); pk.verifyAndBump(99, payload, s);
    }

    function test_a_second_passkey_can_be_added_by_the_first_and_then_acts() public {
        uint256 id = _account(MAYA1, "h"); PasskeyRegistry.Key memory second = _key(MAYA2, RP2);                // same person, another device and site address
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, id, address(pk), keccak256(abi.encode("ADD_KEY", second.x, second.y, second.rpIdHash)));
        vm.prank(relayer); pk.addKey(id, second, s);
        assertEq(pk.keyCount(id), 2);
        bytes32 payload = keccak256("x");
        PasskeyRegistry.SigAuth memory s2 = _sig(MAYA2, RP2, 1, id, address(this), payload);
        pk.verifyAndBump(id, payload, s2);                                                                    // the new passkey works
        assertEq(pk.nonceOf(id), 2);
    }

    function test_a_stranger_cannot_add_their_own_passkey() public {
        uint256 id = _account(MAYA1, "h"); PasskeyRegistry.Key memory eve = _key(EVE, RP);
        PasskeyRegistry.SigAuth memory s = _sig(EVE, RP, 0, id, address(pk), keccak256(abi.encode("ADD_KEY", eve.x, eve.y, eve.rpIdHash)));
        vm.expectRevert("bad passkey signature"); pk.addKey(id, eve, s);
        assertEq(pk.keyCount(id), 1);
    }

    function test_a_lost_device_can_be_removed_but_never_the_last_key() public {
        uint256 id = _account(MAYA1, "h"); PasskeyRegistry.Key memory second = _key(MAYA2, RP);
        pk.addKey(id, second, _sig(MAYA1, RP, 0, id, address(pk), keccak256(abi.encode("ADD_KEY", second.x, second.y, second.rpIdHash))));
        pk.removeKey(id, 0, _sig(MAYA2, RP, 1, id, address(pk), keccak256(abi.encode("REMOVE_KEY", uint8(0)))));  // the second key removes the lost first one
        assertEq(pk.keyCount(id), 1);
        PasskeyRegistry.Key memory left = pk.keyAt(id, 0); assertEq(left.x, second.x);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA2, RP, 0, id, address(pk), keccak256(abi.encode("REMOVE_KEY", uint8(0))));
        vm.expectRevert("cannot remove the last key"); pk.removeKey(id, 0, s);
    }

    function test_an_account_holds_at_most_five_keys() public {
        uint256 id = _account(MAYA1, "h");
        for (uint256 i = 1; i < 5; i++) {
            PasskeyRegistry.Key memory k = _key(MAYA2 + i, RP);
            pk.addKey(id, k, _sig(MAYA1, RP, 0, id, address(pk), keccak256(abi.encode("ADD_KEY", k.x, k.y, k.rpIdHash))));
        }
        PasskeyRegistry.Key memory extra = _key(EVE + 1, RP);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, id, address(pk), keccak256(abi.encode("ADD_KEY", extra.x, extra.y, extra.rpIdHash)));
        vm.expectRevert("too many keys"); pk.addKey(id, extra, s);
    }
}

contract AgreementV2Test is V4Base {
    function test_a_wallet_counterparty_accepts_as_before() public {
        vm.prank(business); uint256 aid = ag.propose(Party(stranger, 0), 1, bytes32(0), reviewer, DAY, DAY);
        vm.prank(business); vm.expectRevert("only the counterparty"); ag.accept(aid);
        vm.prank(stranger); ag.accept(aid);
        assertTrue(ag.inForce(aid));
    }

    function test_a_passkey_counterparty_accepts_by_signature_submitted_by_someone_else() public {
        uint256 maya = _account(MAYA1, "maya");
        vm.prank(business); uint256 aid = ag.propose(Party(address(0), maya), 1, keccak256("terms"), reviewer, 3 * DAY, 2 * DAY);
        assertFalse(ag.inForce(aid));
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, maya, address(ag), _acceptPayload(aid));
        uint256 g = gasleft(); vm.prank(business); ag.acceptSigned(aid, s); emit log_named_uint("gas to accept an agreement by passkey", g - gasleft());
        assertTrue(ag.inForce(aid)); assertEq(ag.get(aid).acceptedAt, block.timestamp); assertEq(pk.nonceOf(maya), 1);
    }

    function test_a_passkey_acceptance_cannot_be_replayed_or_reused_for_other_terms() public {
        uint256 maya = _account(MAYA1, "maya");
        vm.prank(business); uint256 a1 = ag.propose(Party(address(0), maya), 1, keccak256("terms A"), reviewer, DAY, DAY);
        vm.prank(business); uint256 a2 = ag.propose(Party(address(0), maya), 1, keccak256("terms B"), reviewer, DAY, DAY);
        PasskeyRegistry.SigAuth memory s1 = _sig(MAYA1, RP, 0, maya, address(ag), _acceptPayload(a1));
        vm.expectRevert("bad passkey signature"); ag.acceptSigned(a2, s1);                  // approval of terms A is no approval of terms B
        ag.acceptSigned(a1, s1);
        vm.expectRevert("not open for acceptance"); ag.acceptSigned(a1, s1);                // and it cannot be used twice
    }

    function test_proposal_validations_for_passkey_counterparties() public {
        uint256 maya = _account(MAYA1, "maya");
        vm.startPrank(business);
        vm.expectRevert("counterparty is a wallet or a passkey account"); ag.propose(Party(stranger, maya), 1, bytes32(0), reviewer, DAY, DAY);
        vm.expectRevert("counterparty is a wallet or a passkey account"); ag.propose(Party(address(0), 0), 1, bytes32(0), reviewer, DAY, DAY);
        vm.expectRevert("unknown passkey account"); ag.propose(Party(address(0), 77), 1, bytes32(0), reviewer, DAY, DAY);
        vm.expectRevert("reviewer must be neutral"); ag.propose(Party(address(0), maya), 1, bytes32(0), business, DAY, DAY);
        vm.expectRevert("reviewer must be neutral"); ag.propose(Party(stranger, 0), 1, bytes32(0), stranger, DAY, DAY);
        vm.expectRevert("answer window 1 hour..90 days"); ag.propose(Party(address(0), maya), 1, bytes32(0), reviewer, 10, DAY);
        vm.stopPrank();
    }

    function test_the_wrong_kind_of_acceptance_is_refused() public {
        uint256 maya = _account(MAYA1, "maya");
        vm.prank(business); uint256 viaWallet = ag.propose(Party(stranger, 0), 1, bytes32(0), reviewer, DAY, DAY);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, maya, address(ag), bytes32(0));
        vm.expectRevert("the counterparty is a wallet"); ag.acceptSigned(viaWallet, s);
        vm.prank(business); uint256 viaPasskey = ag.propose(Party(address(0), maya), 1, bytes32(0), reviewer, DAY, DAY);
        vm.prank(stranger); vm.expectRevert("only the counterparty"); ag.accept(viaPasskey);
    }

    function test_only_the_proposer_can_cancel_and_not_after_acceptance() public {
        uint256 maya = _account(MAYA1, "maya");
        vm.prank(business); uint256 aid = ag.propose(Party(address(0), maya), 1, bytes32(0), reviewer, DAY, DAY);
        vm.prank(stranger); vm.expectRevert("only the proposer"); ag.cancel(aid);
        vm.prank(business); ag.cancel(aid);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, maya, address(ag), _acceptPayload(aid));
        vm.expectRevert("not open for acceptance"); ag.acceptSigned(aid, s);                // a withdrawn proposal cannot be accepted
    }
}

contract CaseV4Test is V4Base {
    function test_a_passkey_customer_settles_a_dispute_without_a_wallet() public {
        uint256 maya = _account(MAYA1, "maya"); (uint256 id,) = _caseWithMaya(maya);
        vm.prank(business); tc.submit(id, true, ALL_YES);                                    // the business answers: every condition holds
        uint256 g = gasleft(); _mayaSubmits(id, maya, ALL_YES & ~Q5); emit log_named_uint("gas for one signed answer (fork)", g - gasleft());   // Maya disagrees on Q5, signed by her, sent by a relayer
        TiebreakCaseV4.Case memory c = tc.get(id);
        assertEq(uint8(c.status), uint8(TiebreakCaseV4.Status.AwaitingReview)); assertEq(c.disputed, Q5);
        vm.prank(reviewer); tc.review(id, Q5);                                               // the reviewer agreed in advance decides only Q5
        c = tc.get(id); assertEq(uint8(c.status), uint8(TiebreakCaseV4.Status.Final)); assertEq(c.result, 3); assertTrue(c.reviewerAcked);
        (uint8 re, uint8 st, bool ok) = tc.replay(id); assertTrue(ok); assertEq(re, st);
        (bool fin, uint8 res,,) = tc.verdict(id); assertTrue(fin); assertEq(res, 3);
    }

    function test_matching_answers_finish_the_case_at_once() public {
        uint256 maya = _account(MAYA1, "maya"); (uint256 id,) = _caseWithMaya(maya);
        vm.prank(business); tc.submit(id, true, ALL_YES);
        _mayaSubmits(id, maya, ALL_YES);
        assertEq(uint8(tc.get(id).status), uint8(TiebreakCaseV4.Status.Final)); assertEq(tc.get(id).result, 3);
    }

    function test_a_passkey_customer_can_open_the_case_herself() public {
        uint256 maya = _account(MAYA1, "maya"); uint256 aid = _agreementWithPasskey(maya);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, maya, address(tc), keccak256(abi.encode("OPEN_CASE", aid, bytes32(uint256(7)), false)));
        vm.prank(relayer); uint256 id = tc.openFromAgreementSigned(aid, bytes32(uint256(7)), false, s);
        TiebreakCaseV4.Case memory c = tc.get(id);
        assertEq(c.filer.passkey, maya); assertEq(c.decider.wallet, business); assertEq(c.evidenceHash, bytes32(uint256(7)));
        vm.prank(business); vm.expectRevert("this side acts by passkey"); tc.submit(id, true, ALL_YES);   // the business cannot answer for Maya
    }

    function test_nobody_can_answer_for_the_passkey_side_without_her_signature() public {
        uint256 maya = _account(MAYA1, "maya"); (uint256 id,) = _caseWithMaya(maya);
        vm.prank(business); vm.expectRevert("this side acts by passkey"); tc.submit(id, false, ALL_YES);
        PasskeyRegistry.SigAuth memory forWallet = _sig(MAYA1, RP, 0, maya, address(tc), bytes32(0));
        vm.prank(business); vm.expectRevert("this side is a wallet"); tc.submitSigned(id, true, ALL_YES, forWallet);
        PasskeyRegistry.SigAuth memory eve = _sig(EVE, RP, 0, maya, address(tc), _submitPayload(id, false, ALL_YES));
        vm.prank(business); vm.expectRevert("bad passkey signature"); tc.submitSigned(id, false, ALL_YES, eve);
        assertFalse(tc.get(id).deciderIn);
    }

    function test_a_signed_answer_cannot_be_changed_replayed_or_moved_to_another_case() public {
        uint256 maya = _account(MAYA1, "maya"); (uint256 id1, uint256 aid) = _caseWithMaya(maya);
        vm.prank(business); uint256 id2 = tc.openFromAgreement(aid, bytes32(0));
        uint256 before = pk.nonceOf(maya);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, maya, address(tc), _submitPayload(id1, false, ALL_YES & ~Q5));
        vm.expectRevert("bad passkey signature"); tc.submitSigned(id1, false, ALL_YES, s);   // the relayer cannot alter the answers
        vm.expectRevert("bad passkey signature"); tc.submitSigned(id2, false, ALL_YES & ~Q5, s);   // nor use them on another case
        tc.submitSigned(id1, false, ALL_YES & ~Q5, s);
        vm.expectRevert("bad nonce"); tc.submitSigned(id1, false, ALL_YES & ~Q5, s);        // nor replay them
        assertEq(pk.nonceOf(maya), before + 1);
    }

    function test_a_late_signed_answer_fails_and_burns_nothing() public {
        uint256 maya = _account(MAYA1, "maya"); (uint256 id,) = _caseWithMaya(maya); uint256 before = pk.nonceOf(maya);
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, maya, address(tc), _submitPayload(id, false, ALL_YES));
        s.deadline = block.timestamp + 30 days; s.assertion = _assertion(MAYA1, RP, pk.challengeFor(maya, address(tc), _submitPayload(id, false, ALL_YES), s.nonce, s.deadline));
        vm.warp(block.timestamp + 4 days);
        vm.expectRevert("answer deadline passed"); tc.submitSigned(id, false, ALL_YES, s);
        assertEq(pk.nonceOf(maya), before);                                                  // the whole call reverted, so her nonce is untouched
        tc.expire(id); assertEq(uint8(tc.get(id).status), uint8(TiebreakCaseV4.Status.Expired));
    }

    function test_the_second_passkey_can_answer_after_the_first_is_lost() public {
        uint256 maya = _account(MAYA1, "maya"); (uint256 id,) = _caseWithMaya(maya);
        PasskeyRegistry.Key memory second = _key(MAYA2, RP2);
        pk.addKey(maya, second, _sig(MAYA1, RP, 0, maya, address(pk), keccak256(abi.encode("ADD_KEY", second.x, second.y, second.rpIdHash))));
        PasskeyRegistry.SigAuth memory s = _sig(MAYA2, RP2, 1, maya, address(tc), _submitPayload(id, false, ALL_YES));
        vm.prank(relayer); tc.submitSigned(id, false, ALL_YES, s);
        assertTrue(tc.get(id).deciderIn);
    }

    // ----- fixes for the limitations found in the V3 review -----
    function test_F1_the_reviewer_named_in_an_agreement_cannot_be_replaced() public {
        uint256 maya = _account(MAYA1, "maya"); (uint256 id,) = _caseWithMaya(maya);
        vm.prank(business); vm.expectRevert("the agreement fixed the reviewer"); tc.proposeReviewer(id, true, makeAddr("friendly reviewer"));
        // and a wallet-only case without an agreement can still counter-propose, as before
        vm.prank(business); uint256 free = tc.open(1, stranger, reviewer, bytes32(0), DAY, DAY);
        address other = makeAddr("other reviewer"); vm.prank(stranger); tc.proposeReviewer(free, false, other);
        assertEq(tc.get(free).reviewer, other); assertFalse(tc.get(free).filerOkReviewer);
    }

    function test_F2_the_case_records_whether_the_reviewer_ever_took_part() public {
        uint256 maya = _account(MAYA1, "maya"); (uint256 id,) = _caseWithMaya(maya);
        assertFalse(tc.get(id).reviewerAcked);
        vm.prank(stranger); vm.expectRevert("not allowed"); tc.acknowledgeReviewer(id);
        vm.prank(reviewer); tc.acknowledgeReviewer(id); assertTrue(tc.get(id).reviewerAcked);
        // a reviewer who never acts leaves the flag false when the case expires
        vm.prank(business); uint256 id2 = tc.openFromAgreement(1, bytes32(0));
        vm.prank(business); tc.submit(id2, true, ALL_YES); _mayaSubmits(id2, maya, ALL_YES & ~Q5);
        vm.warp(block.timestamp + 3 days); tc.expire(id2);
        assertEq(uint8(tc.get(id2).status), uint8(TiebreakCaseV4.Status.Expired)); assertFalse(tc.get(id2).reviewerAcked);
    }

    function test_F3_one_side_cannot_use_up_the_other_sides_evidence_slots() public {
        uint256 maya = _account(MAYA1, "maya"); (uint256 id,) = _caseWithMaya(maya);
        vm.startPrank(business);
        for (uint256 i = 0; i < 15; i++) tc.attachEvidence(id, 255, bytes32(i + 1), "x");
        vm.expectRevert("too much evidence from this role"); tc.attachEvidence(id, 255, bytes32(uint256(99)), "x");
        vm.stopPrank();
        bytes32 h = keccak256("her photo"); PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, maya, address(tc), keccak256(abi.encode("EVIDENCE", id, false, uint8(4), h, keccak256(bytes("photo")))));
        vm.prank(relayer); tc.attachEvidenceSigned(id, false, 4, h, "photo", s);              // still possible for her
        TiebreakCaseV4.Evidence memory e = tc.evidenceAt(id, 15); assertEq(e.passkey, maya); assertEq(e.by, address(0)); assertEq(e.question, 4); assertEq(e.hash, h);
        vm.startPrank(reviewer); for (uint256 i = 0; i < 6; i++) tc.attachEvidence(id, 255, bytes32(i + 50), "r");
        vm.expectRevert("too much evidence from this role"); tc.attachEvidence(id, 255, bytes32(uint256(70)), "r"); vm.stopPrank();
    }

    function test_signed_evidence_is_bound_to_the_exact_note_and_hash() public {
        uint256 maya = _account(MAYA1, "maya"); (uint256 id,) = _caseWithMaya(maya);
        bytes32 h = keccak256("her photo");
        PasskeyRegistry.SigAuth memory s = _sig(MAYA1, RP, 0, maya, address(tc), keccak256(abi.encode("EVIDENCE", id, false, uint8(4), h, keccak256(bytes("photo")))));
        vm.expectRevert("bad passkey signature"); tc.attachEvidenceSigned(id, false, 4, h, "different note", s);
        vm.expectRevert("bad passkey signature"); tc.attachEvidenceSigned(id, false, 4, keccak256("another file"), "photo", s);
        vm.prank(stranger); vm.expectRevert("not allowed"); tc.attachEvidence(id, 4, h, "photo");
    }

    function test_F4_a_rule_set_on_another_processor_is_refused() public {
        MockProcessor fake = new MockProcessor();
        vm.prank(business); uint256 rs = reg.publish(address(fake), 1, 7, 2, bytes32(0), 0, "Looks like warranty");
        vm.prank(business); vm.expectRevert("untrusted processor"); tc.open(rs, stranger, reviewer, bytes32(0), DAY, DAY);
        vm.prank(business); uint256 aid = ag.propose(Party(stranger, 0), rs, bytes32(0), reviewer, DAY, DAY);
        vm.prank(stranger); ag.accept(aid);
        vm.prank(business); vm.expectRevert("untrusted processor"); tc.openFromAgreement(aid, bytes32(0));
    }

    function test_wallet_cases_still_work_end_to_end_like_v3() public {
        vm.prank(business); uint256 id = tc.open(1, stranger, reviewer, bytes32(0), DAY, DAY);
        vm.prank(stranger); tc.approveReviewer(id, false);
        vm.prank(business); tc.submit(id, true, ALL_YES); vm.prank(stranger); tc.submit(id, false, ALL_YES & ~Q5);
        vm.prank(reviewer); tc.review(id, Q5);
        assertEq(uint8(tc.get(id).status), uint8(TiebreakCaseV4.Status.Final)); assertEq(tc.get(id).result, 3);
    }

    function test_helpers_still_act_only_for_the_side_that_named_them() public {
        vm.prank(business); uint256 id = tc.open(1, stranger, reviewer, bytes32(0), DAY, DAY);
        address hB = makeAddr("helper of business");
        vm.prank(business); tc.setOperator(id, true, hB);
        vm.prank(hB); tc.submit(id, true, ALL_YES);
        vm.prank(hB); vm.expectRevert("not allowed"); tc.submit(id, false, ALL_YES);          // cannot answer for the other side
        vm.prank(stranger); vm.expectRevert("only the side itself"); tc.setOperator(id, true, stranger);
    }
}

/// The same story against the REAL TapeOut processor and the published warranty circuit (#13) on a fork of X Layer mainnet.
contract V4RealProcessorTest is V4Base {
    address constant PROC = 0x9e2849c04A513FE64db07521cBE52d078d905c0E;

    function setUp() public override {
        vm.createSelectFork("https://rpc.xlayer.tech");
        reg = new RuleSetRegistry(); pk = new PasskeyRegistry(); ag = new AgreementRegistryV2(reg, pk); tc = new TiebreakCaseV4(reg, ag, pk, PROC);
        vm.prank(business); reg.publish(PROC, 13, 7, 2, keccak256("warranty definitions v1"), 0, "Warranty (circuit 13)");
    }

    function test_a_passkey_customer_dispute_is_decided_by_the_real_circuit() public {
        uint256 maya = _account(MAYA1, "maya"); (uint256 id,) = _caseWithMaya(maya);
        vm.prank(business); tc.attachEvidence(id, 4, keccak256("repair centre report"), "report.pdf");
        vm.prank(business); tc.submit(id, true, ALL_YES);
        _mayaSubmits(id, maya, ALL_YES & ~Q5);                                                // Maya says the excluded-cause question is a "no"
        vm.prank(reviewer); tc.review(id, 0);                                                  // the reviewer agrees with Maya on that one question
        (bool fin, uint8 result,,) = tc.verdict(id); assertTrue(fin); assertEq(result, 0);     // the real circuit: an excluded cause, so not covered
        (uint8 re, uint8 st, bool same) = tc.replay(id); assertTrue(same); assertEq(re, st);
    }

    function test_the_real_circuit_covers_a_claim_when_everything_agrees() public {
        uint256 maya = _account(MAYA1, "maya"); (uint256 id,) = _caseWithMaya(maya);
        vm.prank(business); tc.submit(id, true, ALL_YES);
        _mayaSubmits(id, maya, ALL_YES);
        (bool fin, uint8 result,,) = tc.verdict(id); assertTrue(fin); assertEq(result, 3);
    }
}
