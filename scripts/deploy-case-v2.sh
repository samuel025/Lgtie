#!/usr/bin/env bash
# Deploys TiebreakCaseV2 (reviewer must be accepted by both sides, deadlines, verdict reader) against the already-deployed registry,
# and points site/config.js `caseContract` at it. The old v1 case contract stays on-chain and is kept in config as caseContractV1.
#   scripts/deploy-case-v2.sh preflight   -> read-only: balance and gas estimate. Spends nothing.
#   scripts/deploy-case-v2.sh deploy      -> sends ONE transaction (asks for your keystore password). You run this yourself.
set -euo pipefail
cd "$(dirname "$0")/.."
ACCOUNT="${ACCOUNT:-firsttape}"; RPC="${RPC_URL:-https://rpc.xlayer.tech}"; CHAIN_ID=196
DEPLOYER="${DEPLOYER:-0x0aE117C07A277D74D9326eb4e33013439dC68fD5}"
cmd="${1:-preflight}"
REG="$(sed -n 's/.*registry: "\(0x[0-9a-fA-F]*\)".*/\1/p' site/config.js)"
[ "$(cast chain-id --rpc-url "$RPC")" = "$CHAIN_ID" ] || { echo "RPC is not X Layer (chain $CHAIN_ID). Refusing."; exit 1; }
[ "$REG" != "0x0000000000000000000000000000000000000000" ] || { echo "Registry is not deployed. Run scripts/deploy.sh first."; exit 1; }
[ -f "$HOME/.foundry/keystores/$ACCOUNT" ] || { echo "No keystore '$ACCOUNT'. Create one: cast wallet import $ACCOUNT --interactive"; exit 1; }
(cd contracts && forge build >/dev/null)
CODE="$(cd contracts && forge inspect src/TiebreakCaseV2.sol:TiebreakCaseV2 bytecode)"
ARGS="$(cast abi-encode "constructor(address)" "$REG")"
GAS="$(cast estimate --from "$DEPLOYER" --rpc-url "$RPC" --create "${CODE}${ARGS#0x}")"
PRICE="$(cast gas-price --rpc-url "$RPC")"; BAL="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
COST="$(python3 -c "print(int($GAS*int($PRICE)*1.5))")"
echo "Registry (existing): $REG"; echo "Deployer:  $DEPLOYER"; echo "Balance:   $(cast from-wei "$BAL") OKB"
echo "Deploy gas: $GAS at $(cast to-unit "$PRICE" gwei) gwei"; echo "Estimated cost (with margin): $(cast from-wei "$COST") OKB"
if python3 -c "import sys;sys.exit(0 if int($BAL)>=int($COST) else 1)"; then echo "Balance is enough."; else echo "NOT ENOUGH."; [ "$cmd" = "preflight" ] || exit 1; fi
[ "$cmd" = "preflight" ] && exit 0
echo; echo "Deploying TiebreakCaseV2 (you will be asked for the keystore password)…"
OUT="$(cd contracts && forge create src/TiebreakCaseV2.sol:TiebreakCaseV2 --rpc-url "$RPC" --account "$ACCOUNT" --broadcast --constructor-args "$REG")"; echo "$OUT"
NEW="$(echo "$OUT" | sed -n 's/^Deployed to: \(0x[0-9a-fA-F]\{40\}\).*/\1/p')"; [ -n "$NEW" ] || { echo "Could not read the deployed address."; exit 1; }
OLD="$(sed -n 's/.*caseContract: "\(0x[0-9a-fA-F]*\)".*/\1/p' site/config.js)"
node -e 'const fs=require("fs"),p="site/config.js";let s=fs.readFileSync(p,"utf8");const [o,n]=process.argv.slice(1);if(!/caseContractV1/.test(s))s=s.replace(/(\n\s*caseContract: ")0x[0-9a-fA-F]*(",)/,`$1${n}$2\n  caseContractV1: "${o}",                                         // the first, simpler case contract (no deadlines); still on-chain`);else s=s.replace(/caseContract: "0x[0-9a-fA-F]*"/,`caseContract: "${n}"`);fs.writeFileSync(p,s)' "$OLD" "$NEW"
echo "TiebreakCaseV2: $NEW  (written to site/config.js; the previous contract $OLD is kept as caseContractV1)"
