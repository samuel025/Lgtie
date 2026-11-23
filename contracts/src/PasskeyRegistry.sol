// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {WebAuthnP256} from "./WebAuthnP256.sol";

/// @title PasskeyRegistry
/// @notice Accounts whose owners are passkeys (Face ID, fingerprint, security key) instead of wallets. An account holds up to MAX_KEYS
///         passkeys. Another contract (an agreement or case contract) can ask this registry to check that the account's owner approved
///         one exact action; the approval is a WebAuthn signature over a challenge that binds chain, registry, calling contract, account,
///         a per-account nonce, a deadline and the action's own hash. Anyone may submit a signed action (so a business can pay the fee).
///         Holds no funds. Unaudited.
/// @dev Replay protection is the per-account nonce, which is consumed on success. The signature itself is not unique (see WebAuthnP256).
///      Because the calling contract's address is inside the signed challenge, a signature meant for one contract cannot be spent through
///      another, and a stranger cannot burn a nonce by calling this registry directly.
contract PasskeyRegistry {
    struct Key { uint256 x; uint256 y; bytes32 rpIdHash; }
    struct SigAuth { uint256 nonce; uint256 deadline; uint8 keyIndex; WebAuthnP256.Assertion assertion; }

    uint256 public constant MAX_KEYS = 5;
    bytes32 private constant DOMAIN = keccak256("LGtie.PasskeyRegistry.v1");

    mapping(uint256 => Key[]) private _keys;
    mapping(uint256 => uint256) public nonceOf;
    mapping(bytes32 => uint256) public accountOfHandle;   // keccak256(WebAuthn userHandle) -> account id; lets a device find its account
    uint256 public count;

    event AccountCreated(uint256 indexed id, bytes32 indexed handleHash, uint256 x, uint256 y, bytes32 rpIdHash);
    event KeyAdded(uint256 indexed id, uint256 x, uint256 y, bytes32 rpIdHash);
    event KeyRemoved(uint256 indexed id, uint256 x, uint256 y);
    event ActionConsumed(uint256 indexed id, uint256 nonce, address indexed consumer);

    /// @notice Anyone may create an account (a business pays for its customer). Creating one proves nothing about who owns the key.
    function create(bytes32 handleHash, Key calldata k) external returns (uint256 id) {
        require(handleHash != bytes32(0) && accountOfHandle[handleHash] == 0, "handle unavailable");
        _checkKey(k);
        id = ++count; accountOfHandle[handleHash] = id; _keys[id].push(k);
        emit AccountCreated(id, handleHash, k.x, k.y, k.rpIdHash);
    }

    /// @notice Add another passkey (a second device, a security key, or the same person on a new site address). Signed by an existing key.
    function addKey(uint256 id, Key calldata k, SigAuth calldata a) external {
        _checkKey(k);
        require(_keys[id].length < MAX_KEYS, "too many keys");
        _consume(id, address(this), keccak256(abi.encode("ADD_KEY", k.x, k.y, k.rpIdHash)), a);
        _keys[id].push(k);
        emit KeyAdded(id, k.x, k.y, k.rpIdHash);
    }

    /// @notice Remove a passkey (a lost device), signed by any key of the account. The last key cannot be removed.
    function removeKey(uint256 id, uint8 index, SigAuth calldata a) external {
        require(_keys[id].length > 1, "cannot remove the last key");
        require(index < _keys[id].length, "no such key");
        _consume(id, address(this), keccak256(abi.encode("REMOVE_KEY", index)), a);
        Key memory gone = _keys[id][index];
        _keys[id][index] = _keys[id][_keys[id].length - 1]; _keys[id].pop();
        emit KeyRemoved(id, gone.x, gone.y);
    }

    /// @notice Called by an agreement or case contract: checks and consumes one signed action for `id`. The challenge includes msg.sender.
    function verifyAndBump(uint256 id, bytes32 payloadHash, SigAuth calldata a) external {
        _consume(id, msg.sender, payloadHash, a);
    }

    /// @notice What a passkey must sign, so a page can compute it before asking the user to confirm.
    function challengeFor(uint256 id, address consumer, bytes32 payloadHash, uint256 nonce, uint256 deadline) external view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN, block.chainid, address(this), consumer, id, nonce, deadline, payloadHash));
    }

    /// @notice Read-only. Does any passkey of this account validate `a` as a signature over `challenge`? Lets a device confirm that an account it
    ///         found by handle is really controlled by the passkey in its hand (a business could register an account with someone's
    ///         handle but its own key). Consumes nothing; `challenge` is whatever the page asked the authenticator to sign.
    function isControlledBy(uint256 id, bytes32 challenge, WebAuthnP256.Assertion calldata a) external view returns (bool ok, uint8 keyIndex) {
        if (id < 1 || id > count) return (false, 0);
        Key[] storage ks = _keys[id];
        for (uint8 i = 0; i < ks.length; i++) {
            Key memory k = ks[i];
            if (WebAuthnP256.verify(challenge, a, k.rpIdHash, k.x, k.y, true)) return (true, i);
        }
        return (false, 0);
    }

    function exists(uint256 id) external view returns (bool) { return id >= 1 && id <= count; }
    function keyCount(uint256 id) external view returns (uint256) { return _keys[id].length; }
    function keyAt(uint256 id, uint256 i) external view returns (Key memory) { return _keys[id][i]; }

    function _checkKey(Key calldata k) private pure {
        require(k.x != 0 && k.y != 0 && k.rpIdHash != bytes32(0), "bad key");
    }

    function _consume(uint256 id, address consumer, bytes32 payloadHash, SigAuth calldata a) private {
        require(id >= 1 && id <= count, "unknown account");
        require(a.deadline >= block.timestamp, "signature expired");
        require(a.nonce == nonceOf[id], "bad nonce");
        require(a.keyIndex < _keys[id].length, "no such key");
        Key memory k = _keys[id][a.keyIndex];
        bytes32 challenge = keccak256(abi.encode(DOMAIN, block.chainid, address(this), consumer, id, a.nonce, a.deadline, payloadHash));
        require(WebAuthnP256.verify(challenge, a.assertion, k.rpIdHash, k.x, k.y, true), "bad passkey signature");
        nonceOf[id] = a.nonce + 1;
        emit ActionConsumed(id, a.nonce, consumer);
    }
}
