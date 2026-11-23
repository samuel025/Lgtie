#!/usr/bin/env bash
# Deploys the passkey system on X Layer and points site/config.js at it: PasskeyRegistry, AgreementRegistryV2 and TiebreakCaseV4.
# They reuse the already-deployed RuleSetRegistry and trust only the official TapeOut processor. None of them holds funds. Unaudited.
#   scripts/deploy-v4.sh preflight   -> read-only: balance and gas estimates. Spends nothing.
#   scripts/deploy-v4.sh deploy      -> sends THREE transactions (asks for your keystore password each time). You run this yourself.
set -euo pipefail
cd "$(dirname "$0")/.."
ACCOUNT="${ACCOUNT:-firsttape}"; RPC="${RPC_URL:-https://rpc.xlayer.tech}"; CHAIN_ID=196
DEPLOYER="${DEPLOYER:-0x0aE117C07A277D74D9326eb4e33013439dC68fD5}"
cmd="${1:-preflight}"
REG="$(sed -n 's/.*registry: "\(0x[0-9a-fA-F]*\)".*/\1/p' site/config.js | head -1)"
PROC="$(sed -n 's/.*processor: "\(0x[0-9a-fA-F]*\)".*/\1/p' site/config.js | head -1)"
[ "$(cast chain-id --rpc-url "$RPC")" = "$CHAIN_ID" ] || { echo "RPC is not X Layer (chain $CHAIN_ID). Refusing."; exit 1; }
[ -n "$REG" ] && [ "$REG" != "0x0000000000000000000000000000000000000000" ] || { echo "Registry is not set in site/config.js."; exit 1; }
[ -n "$PROC" ] || { echo "Processor address not found in site/config.js."; exit 1; }
[ -f "$HOME/.foundry/keystores/$ACCOUNT" ] || { echo "No keystore '$ACCOUNT'. Create one: cast wallet import $ACCOUNT --interactive"; exit 1; }
(cd contracts && forge build >/dev/null)
size() { (cd contracts && forge inspect "$1" deployedBytecode | wc -c | awk '{printf "%d", ($1-3)/2}'); }
for c in PasskeyRegistry AgreementRegistryV2 TiebreakCaseV4; do n="$(size "src/$c.sol:$c")"; [ "$n" -le 24576 ] || { echo "$c is $n bytes, over the 24,576-byte limit. Is the optimizer on in contracts/foundry.toml?"; exit 1; }; echo "$c runtime size: $n bytes (limit 24576)"; done
PKCODE="$(cd contracts && forge inspect src/PasskeyRegistry.sol:PasskeyRegistry bytecode)"
GAS1="$(cast estimate --from "$DEPLOYER" --rpc-url "$RPC" --create "${PKCODE}")"
# The next two need the earlier addresses; estimate them with placeholder addresses (the estimate is nearly identical).
PLACE="0x0000000000000000000000000000000000000001"
AGCODE="$(cd contracts && forge inspect src/AgreementRegistryV2.sol:AgreementRegistryV2 bytecode)"
GAS2="$(cast estimate --from "$DEPLOYER" --rpc-url "$RPC" --create "${AGCODE}$(cast abi-encode 'constructor(address,address)' "$REG" "$PLACE" | sed 's/^0x//')" 2>/dev/null || echo 2500000)"
CSCODE="$(cd contracts && forge inspect src/TiebreakCaseV4.sol:TiebreakCaseV4 bytecode)"
GAS3="$(cast estimate --from "$DEPLOYER" --rpc-url "$RPC" --create "${CSCODE}$(cast abi-encode 'constructor(address,address,address,address)' "$REG" "$PLACE" "$PLACE" "$PROC" | sed 's/^0x//')" 2>/dev/null || echo 6000000)"
PRICE="$(cast gas-price --rpc-url "$RPC")"; BAL="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
COST="$(python3 -c "print(int(($GAS1+$GAS2+$GAS3)*int($PRICE)*1.5))")"
echo "RuleSetRegistry (existing): $REG"; echo "TapeOut processor (trusted): $PROC"; echo "Deployer: $DEPLOYER"; echo "Balance:  $(cast from-wei "$BAL") OKB"
echo "Deploy gas: PasskeyRegistry $GAS1 + AgreementRegistryV2 $GAS2 + TiebreakCaseV4 $GAS3 at $(cast to-unit "$PRICE" gwei) gwei"; echo "Estimated total (with margin): $(cast from-wei "$COST") OKB"
if python3 -c "import sys;sys.exit(0 if int($BAL)>=int($COST) else 1)"; then echo "Balance is enough."; else echo "NOT ENOUGH."; [ "$cmd" = "preflight" ] || exit 1; fi
[ "$cmd" = "preflight" ] && exit 0
deploy() { local out; out="$(cd contracts && forge create "$@" --rpc-url "$RPC" --account "$ACCOUNT" --broadcast 2>&1)"; echo "$out" >&2; echo "$out" | sed -n 's/^Deployed to: \(0x[0-9a-fA-F]\{40\}\).*/\1/p'; }
echo; echo "1/3 Deploying PasskeyRegistry (keystore password)…"; PK="$(deploy src/PasskeyRegistry.sol:PasskeyRegistry)"; [ -n "$PK" ] || { echo "Could not read the PasskeyRegistry address."; exit 1; }
echo; echo "2/3 Deploying AgreementRegistryV2…"; AG="$(deploy src/AgreementRegistryV2.sol:AgreementRegistryV2 --constructor-args "$REG" "$PK")"; [ -n "$AG" ] || { echo "Could not read the AgreementRegistryV2 address."; exit 1; }
echo; echo "3/3 Deploying TiebreakCaseV4…"; CS="$(deploy src/TiebreakCaseV4.sol:TiebreakCaseV4 --constructor-args "$REG" "$AG" "$PK" "$PROC")"; [ -n "$CS" ] || { echo "Could not read the TiebreakCaseV4 address."; exit 1; }
node -e 'const fs=require("fs"),p="site/config.js";let s=fs.readFileSync(p,"utf8");const [pk,ag,cs]=process.argv.slice(1);
const line=`v4: {passkeys: "${pk}", agreements: "${ag}", cases: "${cs}"},   // passkey parties: PasskeyRegistry, AgreementRegistryV2, TiebreakCaseV4 (set by scripts/deploy-v4.sh)`;
if(/v4: \{[^}]*\},[^\n]*/.test(s))s=s.replace(/v4: \{[^}]*\},[^\n]*/,line);else s=s.replace(/(\n\s*published:)/,`\n  ${line}$1`);fs.writeFileSync(p,s)' "$PK" "$AG" "$CS"
echo "PasskeyRegistry:     $PK"; echo "AgreementRegistryV2: $AG"; echo "TiebreakCaseV4:      $CS   (all three written to site/config.js)"
