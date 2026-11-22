// Tape out the warranty circuit on a local anvil fork of X Layer (no real funds) and compare the processor's eval with the rule table.
import {build, reference} from "../compiler/warranty.mjs";
import {hexOf} from "../compiler/nand.mjs";
const RPC = process.env.RPC || "http://127.0.0.1:8546";
const PROC = "0x9e2849c04a513fe64db07521cbe52d078d905c0e", FAUCET = "0xBC58802002307fD80048e93A6475335eC65a4f39";
const w = n => BigInt(n).toString(16).padStart(64, "0");
const rpc = async (method, params) => { const r = await (await fetch(RPC, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params})})).json(); if (r.error) throw new Error(method + ": " + JSON.stringify(r.error)); return r.result; };
const call = (to, data) => rpc("eth_call", [{to, data}, "latest"]);
// A fresh address (the well-known anvil account may carry code on mainnet, which the faucet rejects).
const acct = "0x7e57000000000000000000000000000000000001";
await rpc("anvil_setBalance", [acct, "0x8ac7230489e80000"]); await rpc("anvil_impersonateAccount", [acct]);
const send = async (to, data, value = 0n) => { const h = await rpc("eth_sendTransaction", [{from: acct, to, data, value: "0x" + value.toString(16), gas: "0x1000000"}]); let rc = null; for (let i = 0; i < 60 && !rc; i++) { rc = await rpc("eth_getTransactionReceipt", [h]); if (!rc) await new Promise(r => setTimeout(r, 500)); } if (!rc) throw new Error("no receipt for " + h); if (rc.status !== "0x1") throw new Error("tx reverted " + h); return rc; };
const net = build(), hex = hexOf(net.gates).slice(2), len = hex.length / 2;
const before = BigInt(await call(PROC, "0x61b8ce8c"));
if (BigInt(await call(FAUCET, "0xc884ef83" + acct.toLowerCase().replace("0x", "").padStart(64, "0"))) === 0n) await send(FAUCET, "0x4e71d92d");
const rc = await send(PROC, "0x7bd3ac1d" + w(96) + w(7) + w(2) + w(len) + hex.padEnd(Math.ceil(len / 32) * 64, "0"), 1300000000000000n);
const id = BigInt(await call(PROC, "0x61b8ce8c"));
console.log("tape-out gas used:", parseInt(rc.gasUsed, 16), "| circuit id:", id.toString(), "(was", before.toString() + ")", "| gates:", net.gates.length);
const dec = h => { const x = h.replace("0x", ""), off = Number(BigInt("0x" + x.slice(0, 64))) * 2, n = Number(BigInt("0x" + x.slice(off, off + 64))); return x.slice(off + 64, off + 64 + n * 2); };
let bad = 0;
for (let m = 0; m < 128; m++) {
  const out = dec(await call(PROC, "0x934d06ea" + w(id) + w(64) + w(1) + m.toString(16).padStart(2, "0").padEnd(64, "0")));
  const got = parseInt(out.slice(0, 2) || "0", 16) & 3, q = Array.from({length: 7}, (_, k) => (m >> k) & 1);
  if (got !== reference(q)) { bad++; if (bad < 5) console.log("MISMATCH", m, "want", reference(q), "got", got, "raw", out); }
}
console.log(bad === 0 ? "OK: the processor's eval matches the rule table on all 128 combinations" : `FAIL: ${bad} mismatches`);
process.exit(bad ? 1 : 0);
