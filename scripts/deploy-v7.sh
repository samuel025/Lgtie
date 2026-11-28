#!/usr/bin/env bash
# Deploys AgreementRegistryV3 (an agreement can be PROPOSED by a passkey account, not only a wallet) together with what has to follow it:
# a second TiebreakCaseV6 pointed at the new registry (the same code as the live V6; V3 keeps V2's interface) and a NEW LGtieBilling (the live one can be
# linked to a case contract only once). Reuses the PasskeyRegistry, RuleSetRegistry, processor and FactSpecRegistry that are already live.
# No contract here holds funds: each payment goes from the payer straight to the treasury. Unaudited. (docs/AGREEMENTS-V3.md)
#   scripts/deploy-v7.sh preflight   -> read-only: checks, balance and gas estimates. Spends nothing.
#   scripts/deploy-v7.sh deploy      -> sends FOUR transactions (asks for your keystore password each time). You run this yourself.
# Settings (environment variables, defaults in brackets). Amounts are in the token's 6-decimal units, so 3000000 is 3 dollars.
#   TOKEN / TREASURY   [the token and treasury of the live billing contract in site/config.js (v6, else v5)]
#   CASE_FEE [3000000]   BUSINESS [29000000,290000000,50]   PRO [99000000,990000000,300]
# Existing subscribers do NOT carry over: the new billing contract starts empty, so they would subscribe again.
# Resume after a partial run: AG3_EXISTING=0x... BILLING_EXISTING=0x... scripts/deploy-v7.sh deploy   (each is reused after a check)
# Test hooks: SIGNER_ARGS="--unlocked --from 0x..." replaces the keystore signer; CONFIG=path writes the addresses elsewhere.
set -euo pipefail
cd "$(dirname "$0")/.."
ACCOUNT="${ACCOUNT:-firsttape}"; RPC="${RPC_URL:-https://rpc.xlayer.tech}"; CHAIN_ID=196; CONFIG="${CONFIG:-site/config.js}"
read -r -a SIGNER <<< "${SIGNER_ARGS:---account $ACCOUNT}"
DEPLOYER="${DEPLOYER:-0x0aE117C07A277D74D9326eb4e33013439dC68fD5}"
cmd="${1:-preflight}"
get() { sed -n "s/.*$1: \"\(0x[0-9a-fA-F]*\)\".*/\1/p" "$CONFIG" | head -1; }
v6get() { sed -n "s/.*v6: {.*$1: \"\(0x[0-9a-fA-F]*\)\".*/\1/p" "$CONFIG" | head -1; }
v5get() { sed -n "s/.*v5: {.*$1: \"\(0x[0-9a-fA-F]*\)\".*/\1/p" "$CONFIG" | head -1; }
REG="$(get registry)"; PROC="$(get processor)"
PK="$(sed -n 's/.*v4: {passkeys: "\(0x[0-9a-fA-F]*\)".*/\1/p' "$CONFIG" | head -1)"; AG="$(sed -n 's/.*v4: {.*agreements: "\(0x[0-9a-fA-F]*\)".*/\1/p' "$CONFIG" | head -1)"
TOKEN="${TOKEN:-$(v6get token)}"; TOKEN="${TOKEN:-$(v5get token)}"; TREASURY="${TREASURY:-$(v6get treasury)}"; TREASURY="${TREASURY:-$(v5get treasury)}"; FS="$(v6get facts)"
CASE_FEE="${CASE_FEE:-3000000}"; BUSINESS="${BUSINESS:-29000000,290000000,50}"; PRO="${PRO:-99000000,990000000,300}"
got=""; for try in 1 2 3 4 5; do got="$(cast chain-id --rpc-url "$RPC" 2>/dev/null || true)"; [ -n "$got" ] && break; echo "RPC did not answer (try $try of 5), retrying…" >&2; sleep 3; done
[ -n "$got" ] || { echo "Could not reach $RPC. It is a network problem, not a problem with the script. Try again, or set RPC_URL to another X Layer endpoint."; exit 1; }
[ "$got" = "$CHAIN_ID" ] || { echo "RPC is not X Layer (chain $CHAIN_ID, got $got). Refusing."; exit 1; }
for v in REG PROC PK FS TOKEN TREASURY; do [ -n "${!v}" ] || { echo "Could not read $v from $CONFIG (set TOKEN and TREASURY yourself if there is no v5 line)."; exit 1; }; done
[ -n "${SIGNER_ARGS:-}" ] || [ -f "$HOME/.foundry/keystores/$ACCOUNT" ] || { echo "No keystore '$ACCOUNT'. Create one: cast wallet import $ACCOUNT --interactive"; exit 1; }
[ "$(cast call "$TOKEN" 'decimals()(uint8)' --rpc-url "$RPC" 2>/dev/null)" = "6" ] || { echo "$TOKEN is not a 6-decimal token on this chain."; exit 1; }
TSYM="$(cast call "$TOKEN" 'symbol()(string)' --rpc-url "$RPC" 2>/dev/null)"
(cd contracts && forge build >/dev/null)
size() { (cd contracts && forge inspect "$1" deployedBytecode | wc -c | awk '{printf "%d", ($1-3)/2}'); }
for c in AgreementRegistryV3 LGtieBilling TiebreakCaseV6; do n="$(size "src/$c.sol:$c")"; [ "$n" -le 24576 ] || { echo "$c is $n bytes, over the 24,576-byte limit."; exit 1; }; echo "$c runtime size: $n bytes (limit 24576)"; done
PLACE="0x0000000000000000000000000000000000000001"
est() { cast estimate --from "$DEPLOYER" --rpc-url "$RPC" --create "$1" 2>/dev/null || echo "$2"; }
GAS0="$(est "$(cd contracts && forge inspect src/AgreementRegistryV3.sol:AgreementRegistryV3 bytecode)$(cast abi-encode 'constructor(address,address)' "$REG" "$PK" | sed 's/^0x//')" 2500000)"
GAS1="$(est "$(cd contracts && forge inspect src/LGtieBilling.sol:LGtieBilling bytecode)$(cast abi-encode 'constructor(address,address,uint256,(uint128,uint128,uint32),(uint128,uint128,uint32))' "$TOKEN" "$TREASURY" "$CASE_FEE" "($BUSINESS)" "($PRO)" | sed 's/^0x//')" 1500000)"
GAS2="$(est "$(cd contracts && forge inspect src/TiebreakCaseV6.sol:TiebreakCaseV6 bytecode)$(cast abi-encode 'constructor(address,address,address,address,address,address)' "$REG" "$PLACE" "$PK" "$PROC" "$PLACE" "$FS" | sed 's/^0x//')" 7000000)"
PRICE="$(cast gas-price --rpc-url "$RPC")"; BAL="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
COST="$(python3 -c "print(int(($GAS0+$GAS1+$GAS2+80000)*int($PRICE)*1.5))")"
echo; echo "Token:     $TOKEN ($TSYM, 6 decimals)"; echo "Treasury:  $TREASURY"; echo "Per case:  $(python3 -c "print($CASE_FEE/1e6)") dollars"
echo "Business:  $BUSINESS (month, year, cases per month; 6 decimals)"; echo "Pro:       $PRO"
echo "Reusing:   RuleSetRegistry $REG, PasskeyRegistry $PK, processor $PROC, FactSpecRegistry $FS"
echo "Deployer:  $DEPLOYER   balance $(cast from-wei "$BAL") OKB"
echo "Deploy gas: AgreementRegistryV3 $GAS0 + LGtieBilling $GAS1 + TiebreakCaseV6 $GAS2 + link 80000 at $(cast to-unit "$PRICE" gwei) gwei; estimated total (with margin): $(cast from-wei "$COST") OKB"
if python3 -c "import sys;sys.exit(0 if int($BAL)>=int($COST) else 1)"; then echo "Balance is enough."; else echo "NOT ENOUGH."; [ "$cmd" = "preflight" ] || exit 1; fi
[ "$cmd" = "preflight" ] && exit 0
deploy() { local out contract="$1"; shift; local args=("$contract" --rpc-url "$RPC" "${SIGNER[@]}" --broadcast); [ "$#" -eq 0 ] || args+=(--constructor-args "$@")
  out="$(cd contracts && forge create "${args[@]}" 2>&1)" || { echo "$out" >&2; return 1; }; echo "$out" >&2; echo "$out" | sed -n 's/^Deployed to: \(0x[0-9a-fA-F]\{40\}\).*/\1/p'; }
has_code() { [ "$(cast code "$1" --rpc-url "$RPC" | wc -c)" -gt 10 ]; }
if [ -n "${AG3_EXISTING:-}" ]; then
  A3="$AG3_EXISTING"; has_code "$A3" || { echo "No contract at $A3 on this chain."; exit 1; }
  [ "$(cast call "$A3" 'MAX_WINDOW()(uint32)' --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')" = "7776000" ] && [ "$(cast call "$A3" 'passkeys()(address)' --rpc-url "$RPC" | tr 'A-F' 'a-f')" = "$(echo "$PK" | tr 'A-F' 'a-f')" ] || { echo "$A3 does not look like our AgreementRegistryV3 for this passkey registry."; exit 1; }
  echo; echo "1/4 Reusing the AgreementRegistryV3 already deployed at $A3"
else
  echo; echo "1/4 Deploying AgreementRegistryV3 (keystore password)…"; A3="$(deploy src/AgreementRegistryV3.sol:AgreementRegistryV3 "$REG" "$PK")"; [ -n "$A3" ] || { echo "Could not read the AgreementRegistryV3 address."; exit 1; }
fi
if [ -n "${BILLING_EXISTING:-}" ]; then
  BL="$BILLING_EXISTING"; has_code "$BL" || { echo "No contract at $BL on this chain."; exit 1; }
  [ "$(cast call "$BL" 'MAX_CASE_FEE()(uint256)' --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')" = "10000000" ] || { echo "$BL does not look like our LGtieBilling."; exit 1; }
  [ "$(cast call "$BL" 'cases()(address)' --rpc-url "$RPC")" = "0x0000000000000000000000000000000000000000" ] || { echo "$BL is already linked to a case contract; it cannot be linked again."; exit 1; }
  echo; echo "2/4 Reusing the LGtieBilling already deployed at $BL"
else
  echo; echo "2/4 Deploying a new LGtieBilling (keystore password)…"
  BL="$(deploy src/LGtieBilling.sol:LGtieBilling "$TOKEN" "$TREASURY" "$CASE_FEE" "($BUSINESS)" "($PRO)")"; [ -n "$BL" ] || { echo "Could not read the LGtieBilling address (AgreementRegistryV3 is at $A3; resume with AG3_EXISTING=$A3)."; exit 1; }
fi
echo; echo "3/4 Deploying a second TiebreakCaseV6, pointed at AgreementRegistryV3…"; CS="$(deploy src/TiebreakCaseV6.sol:TiebreakCaseV6 "$REG" "$A3" "$PK" "$PROC" "$BL" "$FS")"; [ -n "$CS" ] || { echo "Could not read the TiebreakCaseV6 address (resume with AG3_EXISTING=$A3 BILLING_EXISTING=$BL)."; exit 1; }
echo; echo "4/4 Linking: the billing contract will accept charges only from $CS (can be done once)…"
cast send "$BL" 'setCases(address)' "$CS" --rpc-url "$RPC" "${SIGNER[@]}" >&2
[ "$(cast call "$BL" 'cases()(address)' --rpc-url "$RPC" | tr 'A-F' 'a-f')" = "$(echo "$CS" | tr 'A-F' 'a-f')" ] || { echo "Linking failed: billing.cases() is not $CS."; exit 1; }
node -e 'const fs=require("fs"),p=process.argv[8];let s=fs.readFileSync(p,"utf8");const [bl,cs,a3,fs_,tok,tr,fee]=process.argv.slice(1);
const line=`v7: {agreements: "${a3}", billing: "${bl}", cases: "${cs}", facts: "${fs_}", token: "${tok}", treasury: "${tr}", caseFee: ${fee}},   // AgreementRegistryV3 (a passkey can propose), a second TiebreakCaseV6 and a new LGtieBilling (set by scripts/deploy-v7.sh)`;
if(/v7: \{[^}]*\},[^\n]*/.test(s))s=s.replace(/v7: \{[^}]*\},[^\n]*/,line);else s=s.replace(/(\n\s*published:)/,`\n  ${line}$1`);fs.writeFileSync(p,s)' "$BL" "$CS" "$A3" "$FS" "$TOKEN" "$TREASURY" "$CASE_FEE" "$CONFIG"
echo "AgreementRegistryV3: $A3"; echo "LGtieBilling:        $BL"; echo "TiebreakCaseV6 (2nd): $CS   (all written to $CONFIG)"
