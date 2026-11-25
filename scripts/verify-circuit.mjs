// Prove that a circuit implements a set of rules, for EVERY combination of answers (a symbolic check, not a sample), and write a report.
//   node scripts/verify-circuit.mjs <warranty|bounty|path/to/rules.txt>                       compile the rules here and check the result
//   node scripts/verify-circuit.mjs <warranty|bounty|rules.txt> --circuit 13                 read circuit #13's netlist from X Layer and check THAT
//   options: --rpc <url>   --processor <0x…>   --out report.json
// Exit code 0 only when the circuit is proved equivalent to the rules. Read-only: it never sends a transaction. See docs/VERIFICATION.md.
import {createRequire} from "node:module";
import fs from "node:fs";
import {createHash} from "node:crypto";
const require = createRequire(import.meta.url), TB = require("../site/rules.js"), V = require("../site/verify.js");
const args = process.argv.slice(2), flag = k => { const i = args.indexOf("--" + k); return i < 0 ? null : args[i + 1]; };
const src = args.find(a => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--circuit" && args[args.indexOf(a) - 1] !== "--rpc" && args[args.indexOf(a) - 1] !== "--processor" && args[args.indexOf(a) - 1] !== "--out");
if (!src) { console.error("usage: verify-circuit.mjs <warranty|bounty|rules.txt> [--circuit N] [--rpc URL] [--processor 0x…] [--out report.json]"); process.exit(2); }
const text = TB.TEMPLATES[src] || fs.readFileSync(src, "utf8"), parsed = TB.parse(text);
if (parsed.errors.length) { console.error("The rules have errors:\n" + parsed.errors.map(e => "  " + (e.line ? "line " + e.line + ": " : "") + e.message).join("\n")); process.exit(2); }
const P = parsed.policy, nQ = P.questions.length, nOut = V.outBits(P.results.length);
let hex, source;
const circuit = flag("circuit");
if (circuit) {
  const cfg = fs.readFileSync(new URL("../site/config.js", import.meta.url), "utf8"), proc = flag("processor") || /processor:\s*"(0x[0-9a-fA-F]{40})"/.exec(cfg)[1], rpcUrl = flag("rpc") || "https://rpc.xlayer.tech", id = BigInt(circuit), w = n => n.toString(16).padStart(64, "0");
  const call = async data => { const r = await (await fetch(rpcUrl, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_call", params: [{to: proc, data}, "latest"]})})).json(); if (r.error) throw new Error(r.error.message); return r.result.replace("0x", ""); };
  const info = await call("0x084d60f1" + w(id)), nIn = Number(BigInt("0x" + info.slice(0, 64))), outs = Number(BigInt("0x" + info.slice(64, 128)));
  if (nIn !== nQ || outs !== nOut) { console.error(`Circuit #${circuit} has ${nIn} inputs and ${outs} outputs, but these rules have ${nQ} questions (and need ${nOut} outputs). It is not the circuit for these rules.`); process.exit(1); }
  const x = await call("0x3fc4be56" + w(id)), off = Number(BigInt("0x" + x.slice(0, 64))) * 2, len = Number(BigInt("0x" + x.slice(off, off + 64)));
  hex = "0x" + x.slice(off + 64, off + 64 + len * 2); source = `X Layer circuit #${circuit} on processor ${proc} (read via ${rpcUrl})`;
} else { hex = TB.compile(P).hex; source = "compiled locally from the rules by " + TB.COMPILER_VERSION; }

const res = V.check(P, hex), bytes = Buffer.from(hex.slice(2), "hex");
const rep = V.report(P, res, {compiler: TB.COMPILER_VERSION, policyHash: "0x" + createHash("sha256").update(TB.canonical(P)).digest("hex"), netlistHash: "0x" + createHash("sha256").update(bytes).digest("hex"), source});
const d = V.describe(res, P, "en");
console.log(`${P.name}: ${nQ} questions, ${P.rules.length} rules, ${P.results.length} results\ncircuit: ${source}\n  ${res.nGates || 0} gates, netlist fingerprint ${rep.circuit.netlistFingerprintSha256}\n  rules fingerprint   ${rep.policy.rulesFingerprintSha256}\n${d.headline}\n${d.detail}`);
if (res.result === "equivalent") console.log(`(${res.bddNodes} diagram nodes, ${res.ms} ms)`);
const out = flag("out"); if (out) { fs.writeFileSync(out, JSON.stringify(rep, null, 2)); console.log("report written to " + out); }
process.exit(res.result === "equivalent" ? 0 : 1);
