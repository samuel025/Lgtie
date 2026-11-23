// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title WebAuthnP256
/// @notice Verifies a WebAuthn (passkey) assertion on-chain. A passkey signs with the P-256 curve; X Layer has the RIP-7212 precompile at
///         address 0x100 (checked on mainnet), so verification costs a few thousand gas. If the precompile is absent or rejects, the
///         widely deployed Daimo P256 verifier contract is tried as a fallback; a signature counts only if one of them accepts it.
/// @dev What this proves: the holder of the private key for (x, y) approved `challenge` on a site whose relying-party id hashes to
///      `rpIdHash`, and (if `requireUV`) the authenticator verified the user (biometric or PIN). It does NOT make a signature unique:
///      (r, s) and (r, N - s) both verify, so callers must get replay protection from the challenge (nonce, deadline), never from the signature.
///      Unaudited. Written for the LGtie prototype.
library WebAuthnP256 {
    struct Assertion {
        bytes authenticatorData;   // from navigator.credentials.get(): rpIdHash (32) | flags (1) | signCount (4) | ...
        string clientDataJSON;     // exact JSON the browser produced; its hash is part of what was signed
        uint256 typeIndex;         // offset of `"type":"webauthn.get"` inside clientDataJSON
        uint256 challengeIndex;    // offset of `"challenge":"..."` inside clientDataJSON
        uint256 r;
        uint256 s;
    }

    address internal constant PRECOMPILE = address(0x100);
    address internal constant FALLBACK_VERIFIER = 0xc2b78104907F722DABAc4C69f826a522B2754De4; // Daimo P256Verifier (same input and output format)
    uint256 internal constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint8 internal constant FLAG_UP = 0x01;   // user present
    uint8 internal constant FLAG_UV = 0x04;   // user verified

    function verify(bytes32 challenge, Assertion memory a, bytes32 rpIdHash, uint256 x, uint256 y, bool requireUV) internal view returns (bool) {
        if (!checkAuthData(a.authenticatorData, rpIdHash, requireUV)) return false;
        if (!checkClientData(a.clientDataJSON, challenge, a.typeIndex, a.challengeIndex)) return false;
        bytes32 digest = sha256(abi.encodePacked(a.authenticatorData, sha256(bytes(a.clientDataJSON))));
        return verifyP256(digest, a.r, a.s, x, y);
    }

    /// @dev The assertion must come from our site (rpIdHash), the user must be present, and verified when `requireUV`.
    function checkAuthData(bytes memory authData, bytes32 rpIdHash, bool requireUV) internal pure returns (bool) {
        if (authData.length < 37) return false;
        bytes32 rp; assembly { rp := mload(add(authData, 32)) }
        if (rp != rpIdHash) return false;
        uint8 flags = uint8(authData[32]);
        if (flags & FLAG_UP == 0) return false;
        if (requireUV && flags & FLAG_UV == 0) return false;
        return true;
    }

    /// @dev The signed client data must be a `webauthn.get` and carry exactly our challenge (base64url, no padding).
    function checkClientData(string memory json, bytes32 challenge, uint256 typeIndex, uint256 challengeIndex) internal pure returns (bool) {
        bytes memory cd = bytes(json);
        if (!_matchesAt(cd, typeIndex, bytes('"type":"webauthn.get"'))) return false;
        return _matchesAt(cd, challengeIndex, abi.encodePacked('"challenge":"', base64url(challenge), '"'));
    }

    function verifyP256(bytes32 digest, uint256 r, uint256 s, uint256 x, uint256 y) internal view returns (bool) {
        if (r == 0 || r >= N || s == 0 || s >= N) return false;
        if (s > N / 2) s = N - s;                       // normalise: the verifiers accept low-s
        bytes memory input = abi.encode(digest, r, s, x, y);
        (bool ok, bytes memory out) = PRECOMPILE.staticcall(input);
        if (ok && out.length == 32 && abi.decode(out, (uint256)) == 1) return true;
        (ok, out) = FALLBACK_VERIFIER.staticcall(input);
        return ok && out.length == 32 && abi.decode(out, (uint256)) == 1;
    }

    /// @dev base64url of 32 bytes, 43 characters, no padding (as browsers write the challenge).
    function base64url(bytes32 h) internal pure returns (bytes memory out) {
        bytes memory T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        bytes memory b = abi.encodePacked(h);
        out = new bytes(43); uint256 o;
        for (uint256 i = 0; i < 30; i += 3) {
            uint256 n = (uint256(uint8(b[i])) << 16) | (uint256(uint8(b[i + 1])) << 8) | uint256(uint8(b[i + 2]));
            out[o++] = T[n >> 18]; out[o++] = T[(n >> 12) & 63]; out[o++] = T[(n >> 6) & 63]; out[o++] = T[n & 63];
        }
        uint256 m = (uint256(uint8(b[30])) << 8) | uint256(uint8(b[31]));
        out[o++] = T[m >> 10]; out[o++] = T[(m >> 4) & 63]; out[o] = T[(m & 15) << 2];
    }

    function _matchesAt(bytes memory hay, uint256 idx, bytes memory needle) private pure returns (bool) {
        if (idx > hay.length || needle.length > hay.length - idx) return false;
        for (uint256 i = 0; i < needle.length; i++) if (hay[idx + i] != needle[i]) return false;
        return true;
    }
}
