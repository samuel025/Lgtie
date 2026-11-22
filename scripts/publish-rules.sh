#!/usr/bin/env bash
# Publishes a rule set on X Layer: mints NAND if short, tapes the circuit out, registers it, and records it in site/config.js.
#   scripts/publish-rules.sh <warranty|bounty|rules.txt> preflight   -> read-only plan and cost. Spends nothing.
#   scripts/publish-rules.sh <warranty|bounty|rules.txt> publish     -> sends up to 3 transactions. You run this yourself.
# Needs the registry deployed first (scripts/deploy.sh). The circuit cannot be changed afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?usage: publish-rules.sh <warranty|bounty|rules.txt> [preflight|publish]}"; cmd="${2:-preflight}"
ACCOUNT="${ACCOUNT:-firsttape}"; RPC="${RPC_URL:-https://rpc.xlayer.tech}"; CHAIN_ID=196
DEPLOYER="${DEPLOYER:-0x0aE117C07A277D74D9326eb4e33013439dC68fD5}"
PROC=0x9e2849c04a513fe64db07521cbe52d078d905c0e; NAND=0xd0faafc5b9149cae7bd9af64070fee33c46ed619; TAPEOUT_FEE=1300000000000000
REG="$(sed -n 's/.*registry: "\(0x[0-9a-fA-F]*\)".*/\1/p' site/config.js)"
[ "$(cast chain-id --rpc-url "$RPC")" = "$CHAIN_ID" ] || { echo "RPC is not X Layer. Refusing."; exit 1; }
[ "$REG" != "0x0000000000000000000000000000000000000000" ] || { echo "Registry is not deployed yet. Run scripts/deploy.sh first."; exit 1; }
J="$(node scripts/compile.mjs "$SRC")"; f() { node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(String(j[process.argv[2]]))' "$J" "$1"; }
NAME="$(f name)"; NQ="$(f nQ)"; NOUT="$(f nOut)"; GATES="$(f gates)"; HEX="$(f hex)"; HASH="$(f definitionsHash)"
HAVE="$(cast call "$NAND" "balanceOf(address,uint256)(uint256)" "$DEPLOYER" 0 --rpc-url "$RPC" | awk '{print $1}')"
NEED=$(( GATES > HAVE ? GATES - HAVE : 0 )); MINTFEE="$(cast call "$NAND" "protocolFee()(uint256)" --rpc-url "$RPC" | awk '{print $1}')"
TOTAL="$(python3 -c "print($TAPEOUT_FEE + ($MINTFEE if $NEED>0 else 0))")"; BAL="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
echo "Rule set:   $NAME  ($NQ questions, $NOUT result bits, $GATES gates)"; echo "Definitions hash: $HASH"
echo "NAND held:  $HAVE   needed: $GATES   to mint: $NEED"
echo "Fees:       tape-out $(cast from-wei $TAPEOUT_FEE) OKB$( [ "$NEED" -gt 0 ] && echo " + mint $(cast from-wei "$MINTFEE") OKB" ) = $(cast from-wei "$TOTAL") OKB plus a little gas"
echo "Balance:    $(cast from-wei "$BAL") OKB"
python3 -c "import sys;sys.exit(0 if int($BAL)>=int($TOTAL)*1.3 else 1)" && echo "Balance is enough." || { echo "NOT ENOUGH for the fees plus gas."; [ "$cmd" = "preflight" ] || exit 1; }
[ "$cmd" = "preflight" ] && exit 0
if [ "$NEED" -gt 0 ]; then echo; echo "1/3 Minting $NEED NAND (keystore password)…"; cast send "$NAND" "mint(uint256,uint256)" 0 "$NEED" --value "$MINTFEE" --rpc-url "$RPC" --account "$ACCOUNT"; fi
echo; echo "2/3 Taping out the circuit…"
TX="$(cast send "$PROC" "tapeout(bytes,uint32,uint32)" "$HEX" "$NQ" "$NOUT" --value "$TAPEOUT_FEE" --rpc-url "$RPC" --account "$ACCOUNT" --json | jq -r .transactionHash)"; echo "tx $TX"
# the new circuit is the ERC-721 Transfer(from 0x0) whose token id is in topic 3
CID="$(cast receipt "$TX" --rpc-url "$RPC" --json | jq -r '[.logs[] | select(.address|ascii_downcase=="'"$PROC"'") | select(.topics[0]=="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") | select(.topics|length==4)][0].topics[3]' | xargs cast to-dec)"
[ -n "$CID" ] || { echo "Could not read the new circuit id from the receipt. Find it on the explorer: https://www.oklink.com/xlayer/tx/$TX"; exit 1; }
echo "Circuit id: $CID"
echo; echo "3/3 Registering the rule set…"
RTX="$(cast send "$REG" "publish(address,uint256,uint8,uint8,bytes32,uint256,string)" "$PROC" "$CID" "$NQ" "$NOUT" "$HASH" 0 "$NAME" --rpc-url "$RPC" --account "$ACCOUNT" --json | jq -r .transactionHash)"; echo "tx $RTX"
RSID="$(cast receipt "$RTX" --rpc-url "$RPC" --json | jq -r '[.logs[] | select(.address|ascii_downcase=="'"$(echo "$REG" | tr A-Z a-z)"'")][0].topics[1]' | xargs cast to-dec)"
KEY="$( [ "$SRC" = warranty ] || [ "$SRC" = bounty ] && echo "$SRC" || echo custom )"
if [ "$KEY" != custom ]; then
  node -e 'const fs=require("fs"),p="site/config.js";let s=fs.readFileSync(p,"utf8");const k=process.argv[1],e=`${k}: {circuitId: ${process.argv[2]}, ruleSetId: ${process.argv[3]}}`;s=/published:\s*\{[^}]*\}/.test(s)?s.replace(/published:\s*\{([^}]*)\}/,(m,body)=>{const items=body.split(/,(?![^{]*\})/).map(x=>x.trim()).filter(x=>x&&!x.startsWith(k+":"));items.push(e);return "published: {"+items.join(", ")+"}"}):s;fs.writeFileSync(p,s)' "$KEY" "$CID" "$RSID"
  echo "Recorded in site/config.js: $KEY -> circuit $CID, rule set $RSID"
fi
echo "Done. Circuit https://www.oklink.com/xlayer/tx/$TX  | rule set registered in tx $RTX"
