#!/usr/bin/env bash
# Deploys AgreementRegistry and TiebreakCaseV3 against the already-deployed RuleSetRegistry, and points site/config.js at them.
# V3 fixes a flaw in V2 (the person who opened a case could answer for BOTH sides) and adds agreements and evidence hashes.
#   scripts/deploy-v3.sh preflight   -> read-only: balance and gas estimate. Spends nothing.
#   scripts/deploy-v3.sh deploy      -> sends TWO transactions (asks for your keystore password each time). You run this yourself.
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
AGCODE="$(cd contracts && forge inspect src/AgreementRegistry.sol:AgreementRegistry bytecode)"
GAS1="$(cast estimate --from "$DEPLOYER" --rpc-url "$RPC" --create "${AGCODE}$(cast abi-encode 'constructor(address)' "$REG" | sed 's/^0x//')")"
V3CODE="$(cd contracts && forge inspect src/TiebreakCaseV3.sol:TiebreakCaseV3 bytecode)"
GAS2="$(cast estimate --from "$DEPLOYER" --rpc-url "$RPC" --create "${V3CODE}$(cast abi-encode 'constructor(address,address)' "$REG" "$REG" | sed 's/^0x//')" 2>/dev/null || echo 4500000)"
PRICE="$(cast gas-price --rpc-url "$RPC")"; BAL="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
COST="$(python3 -c "print(int(($GAS1+$GAS2)*int($PRICE)*1.5))")"
echo "Registry (existing): $REG"; echo "Deployer:  $DEPLOYER"; echo "Balance:   $(cast from-wei "$BAL") OKB"
echo "Deploy gas: AgreementRegistry $GAS1 + TiebreakCaseV3 about $GAS2 at $(cast to-unit "$PRICE" gwei) gwei"; echo "Estimated total (with margin): $(cast from-wei "$COST") OKB"
if python3 -c "import sys;sys.exit(0 if int($BAL)>=int($COST) else 1)"; then echo "Balance is enough."; else echo "NOT ENOUGH."; [ "$cmd" = "preflight" ] || exit 1; fi
[ "$cmd" = "preflight" ] && exit 0
echo; echo "1/2 Deploying AgreementRegistry (keystore password)…"
OUT="$(cd contracts && forge create src/AgreementRegistry.sol:AgreementRegistry --rpc-url "$RPC" --account "$ACCOUNT" --broadcast --constructor-args "$REG")"; echo "$OUT"
AG="$(echo "$OUT" | sed -n 's/^Deployed to: \(0x[0-9a-fA-F]\{40\}\).*/\1/p')"; [ -n "$AG" ] || { echo "Could not read the AgreementRegistry address."; exit 1; }
echo; echo "2/2 Deploying TiebreakCaseV3…"
OUT2="$(cd contracts && forge create src/TiebreakCaseV3.sol:TiebreakCaseV3 --rpc-url "$RPC" --account "$ACCOUNT" --broadcast --constructor-args "$REG" "$AG")"; echo "$OUT2"
V3="$(echo "$OUT2" | sed -n 's/^Deployed to: \(0x[0-9a-fA-F]\{40\}\).*/\1/p')"; [ -n "$V3" ] || { echo "Could not read the TiebreakCaseV3 address."; exit 1; }
node -e 'const fs=require("fs"),p="site/config.js";let s=fs.readFileSync(p,"utf8");const [ag,v3]=process.argv.slice(1);
const old=(/caseContract: "(0x[0-9a-fA-F]{40})"/.exec(s)||[])[1];
if(old&&!/caseContractV2/.test(s))s=s.replace(/(\n\s*caseContractV1:)/,`\n  caseContractV2: "${old}",                                       // second case contract (deadlines, reviewer consent); has the operator flaw, do not use`+"$1");
s=s.replace(/caseContract: "0x[0-9a-fA-F]{40}"/,`caseContract: "${v3}"`);
if(/agreements:/.test(s))s=s.replace(/agreements: "0x[0-9a-fA-F]{40}"/,`agreements: "${ag}"`);else s=s.replace(/(\n\s*caseContract:)/,`\n  agreements: "${ag}",                                              // AgreementRegistry`+"$1");
s=s.replace(/caseVersion: \d+/,"caseVersion: 3");if(!/caseVersion/.test(s))s=s.replace(/(\n\s*caseContract:)/,"\n  caseVersion: 3,$1");fs.writeFileSync(p,s)' "$AG" "$V3"
echo "AgreementRegistry: $AG"; echo "TiebreakCaseV3:    $V3  (both written to site/config.js; the V2 address is kept as caseContractV2)"
