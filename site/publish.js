// One-click publish with the visitor's own wallet: claim or mint NAND if short, tape the circuit out, register it. Static; no server.
(function () {
  "use strict";
  const CFG = window.TB_CONFIG, W = () => window.TB_WALLET;
  const w = n => BigInt(n).toString(16).padStart(64, "0"), addrW = a => a.toLowerCase().replace("0x", "").padStart(64, "0");
  const SEL = {claim: "0x4e71d92d", claimed: "0xc884ef83", balanceOf: "0x00fdd58e", protocolFee: "0xb0e21e8a", mint: "0x1b2ef1ca", tapeout: "0x7bd3ac1d", publish: "0xa2f94292"};
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", PUBLISHED = null;
  const call = (to, data) => W().rpc("eth_call", [{to, data}, "latest"]);
  const okb = wei => (Number(wei) / 1e18).toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0");

  // Everything the wallet will be asked, computed before anything is sent.
  async function plan(C, account) {
    const have = BigInt(await call(CFG.transistors, SEL.balanceOf + addrW(account) + w(0))), need = BigInt(C.gates.length);
    const claimed = BigInt(await call(CFG.faucet, SEL.claimed + addrW(account))) !== 0n;
    const canClaim = !claimed && have < need; // the faucet gives 40 once per wallet
    const afterClaim = have + (canClaim ? 40n : 0n), mintNeeded = afterClaim < need ? need - afterClaim : 0n;
    const mintFee = mintNeeded > 0n ? BigInt(await call(CFG.transistors, SEL.protocolFee)) : 0n;
    const bal = BigInt(await W().rpc("eth_getBalance", [account, "latest"])), fees = BigInt(CFG.tapeoutFeeWei) + mintFee;
    return {have, need, canClaim, mintNeeded, mintFee, fees, bal, enough: bal >= fees};
  }

  // say(text) reports progress. Returns {circuitId, ruleSetId, txs}.
  async function run({policy, canon, hash, C, previousId, say}) {
    const nameBytes = new TextEncoder().encode(policy.name); if (nameBytes.length > 80 || !nameBytes.length) throw new Error("The checker name must be 1 to 80 characters.");
    const account = await W().connect(), p = await plan(C, account), txs = {};
    if (!p.enough) throw new Error(`Your wallet has ${okb(p.bal)} OKB but about ${okb(p.fees)} OKB is needed for the fees (plus a little gas).`);
    if (p.canClaim) { say("Step 1: claiming your free NAND tokens. Confirm in your wallet…"); txs.claim = (await W().send(CFG.faucet, SEL.claim)).transactionHash; }
    const have2 = BigInt(await call(CFG.transistors, SEL.balanceOf + addrW(account) + w(0))), short = BigInt(C.gates.length) > have2 ? BigInt(C.gates.length) - have2 : 0n;
    if (short > 0n) { const fee = BigInt(await call(CFG.transistors, SEL.protocolFee)); say(`Step 2: buying ${short} more NAND for ${okb(fee)} OKB. Confirm in your wallet…`); txs.mint = (await W().send(CFG.transistors, SEL.mint + w(0) + w(short), fee)).transactionHash; }
    say(`Step 3: recording your circuit permanently (fee ${okb(CFG.tapeoutFeeWei)} OKB). Confirm in your wallet…`);
    const data = C.hex.replace("0x", ""), len = data.length / 2;
    const rc = await W().send(CFG.processor, SEL.tapeout + w(96) + w(C.nIn) + w(C.nOut) + w(len) + data.padEnd(Math.ceil(len / 32) * 64, "0"), CFG.tapeoutFeeWei); txs.tapeout = rc.transactionHash;
    const lg = rc.logs.find(l => l.address.toLowerCase() === CFG.processor.toLowerCase() && l.topics[0] === TRANSFER && l.topics.length === 4);
    if (!lg) throw new Error("Your circuit was recorded, but its number could not be read. Find it in this transaction on the explorer: " + CFG.explorer + "/tx/" + txs.tapeout);
    const circuitId = Number(BigInt(lg.topics[3]));
    say(`Step 4: registering the rules as a public rule set (circuit #${circuitId}). Confirm in your wallet…`);
    const nb = Array.from(nameBytes, b => b.toString(16).padStart(2, "0")).join("");
    const rr = await W().send(CFG.registry, SEL.publish + addrW(CFG.processor) + w(circuitId) + w(C.nIn) + w(C.nOut) + hash.slice(2) + w(previousId || 0) + w(224) + w(nameBytes.length) + nb.padEnd(Math.ceil(nameBytes.length / 32) * 64, "0")); txs.register = rr.transactionHash;
    const rl = rr.logs.find(l => l.address.toLowerCase() === CFG.registry.toLowerCase() && l.topics.length >= 2);
    const ruleSetId = rl ? Number(BigInt(rl.topics[1])) : null;
    return {circuitId, ruleSetId, txs};
  }
  window.TB_PUBLISH = {plan, run, okb};
})();
