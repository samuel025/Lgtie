// Read-only: checks the published warranty circuit on X Layer against the rule table on every answer combination.
import {createRequire} from "node:module";
const TB = createRequire(import.meta.url)("../site/rules.js"), CFG = {};
const src = (await import("node:fs")).readFileSync(new URL("../site/config.js", import.meta.url), "utf8");
const get = k => new RegExp(k + ':\\s*"(0x[0-9a-fA-F]{40})"').exec(src)[1];
const PROC = get("processor"), REG = get("registry"), CID = Number(/warranty:\s*\{circuitId:\s*(\d+)/.exec(src)[1]), RSID = Number(/ruleSetId:\s*(\d+)/.exec(src)[1]);
const RPC = "https://rpc.xlayer.tech", w = n => BigInt(n).toString(16).padStart(64, "0");
const rpc = async (m, p) => { const r = await (await fetch(RPC, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method: m, params: p})})).json(); if (r.error) throw new Error(JSON.stringify(r.error)); return r.result; };
const call = (to, data) => rpc("eth_call", [{to, data}, "latest"]);
const P = TB.parse(TB.TEMPLATES.warranty).policy, C = TB.compile(P);
const info = (await call(PROC, "0x084d60f1" + w(CID))).replace("0x", ""), nIn = Number(BigInt("0x" + info.slice(0, 64))), nOut = Number(BigInt("0x" + info.slice(64, 128)));
console.log(`circuit #${CID}: ${nIn} inputs, ${nOut} outputs; owner 0x${(await call(PROC, "0x6352211e" + w(CID))).slice(-40)}`);
let bad = 0;
for (let m = 0; m < 128; m++) {
  const out = (await call(PROC, "0x934d06ea" + w(CID) + w(64) + w(1) + m.toString(16).padStart(2, "0").padEnd(64, "0"))).replace("0x", ""), off = Number(BigInt("0x" + out.slice(0, 64))) * 2, len = Number(BigInt("0x" + out.slice(off, off + 64)));
  const got = parseInt(out.slice(off + 64, off + 66) || "0", 16) & 3, want = TB.run(P, TB.decodeAnswers(m, 7)).result;
  if (got !== want) { bad++; if (bad < 4) console.log("MISMATCH", m, want, got); }
}
// Also read the circuit's netlist back from the processor and prove it equal to the rules symbolically (the independent checker in site/verify.js).
const V = createRequire(import.meta.url)("../site/verify.js"), nl = (await call(PROC, "0x3fc4be56" + w(CID))).replace("0x", ""), noff = Number(BigInt("0x" + nl.slice(0, 64))) * 2, nlen = Number(BigInt("0x" + nl.slice(noff, noff + 64)));
const formal = V.check(P, "0x" + nl.slice(noff + 64, noff + 64 + nlen * 2));
console.log(`formal check of the on-chain netlist (${formal.nGates} gates): ${formal.result}`);
if (formal.result !== "equivalent") bad++;
console.log(bad ? `FAIL: ${bad} problem(s) on mainnet` : "OK: circuit #" + CID + " on X Layer matches the warranty rules on all 128 combinations, and its netlist is formally equivalent to the rules");
process.exit(bad ? 1 : 0);
