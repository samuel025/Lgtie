#!/usr/bin/env bash
# Deploys RuleSetRegistry and TiebreakCase to X Layer and writes their addresses into site/config.js.
#   scripts/deploy.sh preflight   -> read-only: balance and gas estimate. Spends nothing.
#   scripts/deploy.sh deploy      -> sends TWO transactions (asks for your keystore password). You run this yourself.
set -euo pipefail
cd "$(dirname "$0")/.."
ACCOUNT="${ACCOUNT:-firsttape}"; RPC="${RPC_URL:-https://rpc.xlayer.tech}"; CHAIN_ID=196
DEPLOYER="${DEPLOYER:-0x0aE117C07A277D74D9326eb4e33013439dC68fD5}"
cmd="${1:-preflight}"
[ "$(cast chain-id --rpc-url "$RPC")" = "$CHAIN_ID" ] || { echo "RPC is not X Layer (chain $CHAIN_ID). Refusing."; exit 1; }
[ -f "$HOME/.foundry/keystores/$ACCOUNT" ] || { echo "No keystore '$ACCOUNT'. Create one: cast wallet import $ACCOUNT --interactive"; exit 1; }
(cd contracts && forge build >/dev/null)
REGCODE="$(cd contracts && forge inspect src/RuleSetRegistry.sol:RuleSetRegistry bytecode)"
GAS1="$(cast estimate --from "$DEPLOYER" --rpc-url "$RPC" --create "$REGCODE")"
PRICE="$(cast gas-price --rpc-url "$RPC")"; BAL="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
COST="$(python3 -c "print(int(($GAS1*2)*int($PRICE)*1.5))")"   # two deployments of similar size, with margin
echo "Deployer:   $DEPLOYER"; echo "Balance:    $(cast from-wei "$BAL") OKB"; echo "Gas price:  $(cast to-unit "$PRICE" gwei) gwei"
echo "Registry deploy gas: $GAS1 (the case contract is a little larger)"; echo "Estimated total (with margin): $(cast from-wei "$COST") OKB"
if python3 -c "import sys;sys.exit(0 if int($BAL)>=int($COST) else 1)"; then echo "Balance is enough."; else echo "NOT ENOUGH."; [ "$cmd" = "preflight" ] || exit 1; fi
[ "$cmd" = "preflight" ] && exit 0
echo; echo "Deploying RuleSetRegistry (you will be asked for the keystore password)…"
OUT="$(cd contracts && forge create src/RuleSetRegistry.sol:RuleSetRegistry --rpc-url "$RPC" --account "$ACCOUNT" --broadcast)"; echo "$OUT"
REG="$(echo "$OUT" | sed -n 's/^Deployed to: \(0x[0-9a-fA-F]\{40\}\).*/\1/p')"; [ -n "$REG" ] || { echo "Could not read the registry address."; exit 1; }
echo "Deploying TiebreakCase…"
OUT2="$(cd contracts && forge create src/TiebreakCase.sol:TiebreakCase --rpc-url "$RPC" --account "$ACCOUNT" --broadcast --constructor-args "$REG")"; echo "$OUT2"
CASE="$(echo "$OUT2" | sed -n 's/^Deployed to: \(0x[0-9a-fA-F]\{40\}\).*/\1/p')"; [ -n "$CASE" ] || { echo "Could not read the case address."; exit 1; }
sed -i "s|registry: \"0x[0-9a-fA-F]*\"|registry: \"$REG\"|; s|caseContract: \"0x[0-9a-fA-F]*\"|caseContract: \"$CASE\"|" site/config.js
echo "RuleSetRegistry: $REG"; echo "TiebreakCase:    $CASE  (both written to site/config.js)"
