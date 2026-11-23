// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice One side of an agreement or case. Exactly one field is set: a wallet address, or the id of a passkey account in PasskeyRegistry.
struct Party {
    address wallet;
    uint256 passkey;
}
