// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {WebAuthnP256} from "../src/WebAuthnP256.sol";
import {WebAuthnVector as V} from "./WebAuthnVector.sol";

/// Gate 1 of the passkey work. The vector comes from a REAL Chrome WebAuthn run (see prototypes/passkey/gen-vector.mjs): the browser
/// produced the authenticator data, the client data JSON and the P-256 signature. These tests run on a fork of X Layer so the
/// verifier contracts that exist on mainnet are really called. (The 0x100 precompile itself was probed separately with eth_call.)
contract WebAuthnTest is Test {
    function setUp() public { vm.createSelectFork("https://rpc.xlayer.tech"); }

    function _a() internal pure returns (WebAuthnP256.Assertion memory a) {
        a = WebAuthnP256.Assertion(V.AUTH_DATA, V.CLIENT_DATA_JSON, V.TYPE_INDEX, V.CHALLENGE_INDEX, V.R, V.S);
    }
    function _ok(WebAuthnP256.Assertion memory a, bytes32 ch, bytes32 rp, uint256 x, uint256 y, bool uv) internal view returns (bool) {
        return WebAuthnP256.verify(ch, a, rp, x, y, uv);
    }

    function test_a_real_browser_passkey_assertion_verifies() public {
        uint256 g = gasleft();
        bool ok = _ok(_a(), V.CHALLENGE, V.RP_ID_HASH, V.X, V.Y, true);
        emit log_named_uint("gas to verify one passkey assertion (fallback verifier path)", g - gasleft());
        assertTrue(ok);
    }

    function test_base64url_matches_what_the_browser_wrote() public pure {
        assertEq(string(WebAuthnP256.base64url(V.CHALLENGE)), "KY8tA-iYGpn0Cyy_rl1ZdBh9o06zVmz-dqeT3LyMup8");
    }

    function test_a_different_challenge_is_rejected() public {
        assertFalse(_ok(_a(), bytes32(uint256(V.CHALLENGE) ^ 1), V.RP_ID_HASH, V.X, V.Y, true));
    }

    function test_a_tampered_signature_is_rejected() public {
        WebAuthnP256.Assertion memory a = _a(); a.r = a.r ^ 1;
        assertFalse(_ok(a, V.CHALLENGE, V.RP_ID_HASH, V.X, V.Y, true));
        a = _a(); a.s = a.s ^ 1;
        assertFalse(_ok(a, V.CHALLENGE, V.RP_ID_HASH, V.X, V.Y, true));
    }

    function test_the_wrong_public_key_is_rejected() public {
        assertFalse(_ok(_a(), V.CHALLENGE, V.RP_ID_HASH, V.X, V.Y ^ 1, true));
        assertFalse(_ok(_a(), V.CHALLENGE, V.RP_ID_HASH, V.X ^ 1, V.Y, true));
    }

    function test_a_signature_made_for_another_site_is_rejected() public {
        assertFalse(_ok(_a(), V.CHALLENGE, sha256("evil.example"), V.X, V.Y, true));
    }

    function test_changed_authenticator_data_or_client_data_is_rejected() public {
        WebAuthnP256.Assertion memory a = _a(); bytes memory ad = a.authenticatorData; ad[36] = bytes1(uint8(ad[36]) ^ 1); a.authenticatorData = ad;
        assertFalse(_ok(a, V.CHALLENGE, V.RP_ID_HASH, V.X, V.Y, true));            // signed message no longer matches
        a = _a(); a.clientDataJSON = string.concat(V.CLIENT_DATA_JSON, " ");
        assertFalse(_ok(a, V.CHALLENGE, V.RP_ID_HASH, V.X, V.Y, true));
    }

    function test_pointing_at_the_wrong_part_of_the_client_data_is_rejected() public {
        WebAuthnP256.Assertion memory a = _a(); a.challengeIndex = a.challengeIndex + 1;
        assertFalse(_ok(a, V.CHALLENGE, V.RP_ID_HASH, V.X, V.Y, true));
        a = _a(); a.typeIndex = 0;
        assertFalse(_ok(a, V.CHALLENGE, V.RP_ID_HASH, V.X, V.Y, true));
        a = _a(); a.challengeIndex = 10_000;                                       // out of range must not revert, just fail
        assertFalse(_ok(a, V.CHALLENGE, V.RP_ID_HASH, V.X, V.Y, true));
    }

    function test_flag_checks_user_presence_and_user_verification() public pure {
        bytes memory ad = V.AUTH_DATA;
        assertTrue(WebAuthnP256.checkAuthData(ad, V.RP_ID_HASH, true));            // real run: present and verified (0x05)
        ad[32] = 0x01;                                                              // present only
        assertTrue(WebAuthnP256.checkAuthData(ad, V.RP_ID_HASH, false));
        assertFalse(WebAuthnP256.checkAuthData(ad, V.RP_ID_HASH, true));            // verification required but missing
        ad[32] = 0x04;                                                              // verified but not present
        assertFalse(WebAuthnP256.checkAuthData(ad, V.RP_ID_HASH, false));
        assertFalse(WebAuthnP256.checkAuthData(hex"00", V.RP_ID_HASH, false));      // too short
    }

    /// (r, s) and (r, N - s) are both valid ECDSA. Callers must not use the signature as a unique id: replay protection has to
    /// come from the signed challenge (a nonce or a one-time status change).
    function test_the_high_s_twin_signature_also_verifies() public {
        WebAuthnP256.Assertion memory a = _a(); a.s = WebAuthnP256.N - a.s;
        assertTrue(_ok(a, V.CHALLENGE, V.RP_ID_HASH, V.X, V.Y, true));
    }

    function test_out_of_range_signature_values_are_rejected_without_reverting() public {
        WebAuthnP256.Assertion memory a = _a(); a.r = 0;
        assertFalse(_ok(a, V.CHALLENGE, V.RP_ID_HASH, V.X, V.Y, true));
        a = _a(); a.s = WebAuthnP256.N;
        assertFalse(_ok(a, V.CHALLENGE, V.RP_ID_HASH, V.X, V.Y, true));
    }
}
