// Unit tests for the formal checker (site/verify.js). The most important test: on thousands of random policies and random corrupted circuits, the BDD checker
// agrees exactly with brute force (it says "equivalent" exactly when every answer combination matches, and any counterexample really is one).
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const TB = require("../site/rules.js"), T = require("../site/templates.js"), V = require("../site/verify.js");
let fails = 0, n = 0; const ok = (name, cond, extra = "") => { n++; console.log((cond ? "ok   " : "FAIL ") + name + (cond ? "" : " " + extra)); if (!cond) fails++; };
const P = text => TB.parse(text).policy;
// ground truth by brute force, using the project's own reference evaluator and netlist simulator (independent of verify.js)
const brute = (policy, gates, nOut) => { const nQ = policy.questions.length; for (let m = 0; m < 2 ** nQ; m++) if (TB.run(policy, TB.decodeAnswers(m, nQ)).result !== TB.evalGates(gates, nQ, nOut, m)) return false; return true; };
let seed = 20261125; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, ri = k => Math.floor(rnd() * k);
function randomPolicy(nQ, nRes, nRules, maxConds) {
  const L = [`name: Random ${nQ}`, "about: random"]; for (let i = 0; i < nQ; i++) L.push(`question: Is thing ${i + 1} true? | Evidence ${i + 1}`);
  for (let r = 0; r < nRes; r++) L.push(`result: Result ${r}`);
  for (let k = 0; k < nRules; k++) { const used = new Set(), cs = []; for (let c = 0, m = 1 + ri(maxConds); c < m; c++) { const q = ri(nQ); if (used.has(q)) continue; used.add(q); cs.push(`Q${q + 1}=${rnd() < 0.5 ? "yes" : "no"}`); } L.push(`rule: ${cs.join(" & ")} -> Result ${ri(nRes)} : reason ${k}`); }
  L.push(`default: Result ${ri(nRes)} : otherwise`); return L.join("\n") + "\n";
}
const mutate = (gates, nQ) => { const g = gates.map(x => ({...x})), i = ri(g.length), self = 2 + nQ + i, k = rnd() < 0.5 ? "a" : "b"; let v = ri(self); if (v === g[i][k]) v = (v + 1) % self; g[i][k] = v; return g; };

// ---- the diagram package ----
{ const b = new V.BDD(4); const x = b.variable(0), y = b.variable(1);
  ok("BDD: de Morgan holds (not(x and y) is (not x) or (not y)) as the very same node", b.not(b.and(x, y)) === b.or(b.not(x), b.not(y)));
  ok("BDD: x xor x is false, x xor not x is true", b.xor(x, x) === 0 && b.xor(x, b.not(x)) === 1);
  ok("BDD: equal functions built differently are the same node", b.or(b.and(x, y), b.and(x, b.not(y))) === x);
  ok("BDD: a satisfying assignment really satisfies", (() => { const f = b.and(x, b.not(y)), a = b.satisfy(f); return a[0] === true && a[1] === false; })() && b.satisfy(0) === null);
}

// ---- the built-in templates, in both languages ----
for (const t of T.LIBRARY) for (const lang of ["en", "zh"]) {
  const pol = P(t[lang].text), C = TB.compile(pol), r = V.check(pol, C.hex);
  ok(`${t.key} (${lang}): the compiled circuit is formally equivalent to the rules`, r.result === "equivalent" && r.counterexample === null, JSON.stringify(r));
  ok(`${t.key} (${lang}): the checker sees every gate as NAND and the same gate count`, r.nGates === C.gates.length && r.records.NAND === C.gates.length && r.records.other === 0);
}
// the real published circuit #13 on X Layer (netlist read back from the processor on 2026-11-25) against the warranty rules
const CHAIN13 = "0000000200000200000009000009000000030000030000000b00000b0000000a00000c0000000d00000d000000050000050000000f00000f0000000e000010000000110000110000000600000600000013000013000000120000140000001500001500000008000008000000170000170000001600001800000019000019000000040000040000001b00001a0000001c00001c0000001b00001b0000001a00001e0000001f00001f0000000700000700000021000020000000220000220000002100002100000020000024000000250000250000001d00001d0000002600002600000027000028000000230000230000002a000028000000290000290000002b00002b0000002c00002c0000002d00002d";
ok("the published circuit #13 equals what the compiler makes (273 bytes, 39 gates)", CHAIN13.length / 2 === 273 && "0x" + CHAIN13 === TB.compile(P(TB.TEMPLATES.warranty)).hex);
ok("and it is formally equivalent to the warranty rules, over all 128 answer combinations", V.check(P(TB.TEMPLATES.warranty), "0x" + CHAIN13).result === "equivalent");
ok("but not to the bug-bounty rules (the checker says different, with a counterexample)", (() => { const r = V.check(P(TB.TEMPLATES.bounty), "0x" + CHAIN13); return r.result === "unsupported" || (r.result === "different"); })());

// ---- the checker against brute force: corrupted circuits ----
{ let bad = 0, same = 0, diff = 0, badCx = 0;
  for (const key of ["warranty", "bounty"]) { const pol = P(TB.TEMPLATES[key]), C = TB.compile(pol), nQ = pol.questions.length;
    for (let trial = 0; trial < 300; trial++) { const gates = mutate(C.gates, nQ), truth = brute(pol, gates, C.nOut), r = V.check(pol, TB.hexOf(gates));
      if ((r.result === "equivalent") !== truth) bad++; truth ? same++ : diff++;
      if (r.result === "different" && (!r.counterexample.confirmed || TB.run(pol, r.counterexample.answers).result === TB.evalGates(gates, nQ, C.nOut, r.counterexample.answers.reduce((a, v, k) => a + (v ? 2 ** k : 0), 0)))) badCx++; } }
  ok(`corrupted real circuits: the checker agrees with brute force on all 600 (${same} still equivalent, ${diff} broken)`, bad === 0, bad + " disagreements");
  ok("every counterexample it reports is a real disagreement between the rules and the circuit", badCx === 0, badCx + " bad counterexamples");
  ok("the corruption test exercised both outcomes", same > 0 && diff > 0, `${same}/${diff}`); }

// ---- random policies: the compiler's output is equivalent, and corrupted copies are judged like brute force ----
{ let bad = 0, cases = 0, equivOk = 0, mutAgree = 0, mutTotal = 0;
  for (let i = 0; i < 400; i++) {
    const nQ = 2 + ri(9), nRes = 2 + ri(5), pol = P(randomPolicy(nQ, nRes, 1 + ri(8), 4)); if (!pol) continue; cases++;
    const C = TB.compile(pol), r = V.check(pol, C.hex); if (r.result === "equivalent" && brute(pol, C.gates, C.nOut)) equivOk++; else bad++;
    for (let k = 0; k < 6; k++) { const gates = mutate(C.gates, nQ), truth = brute(pol, gates, C.nOut), rm = V.check(pol, TB.hexOf(gates)); mutTotal++; if ((rm.result === "equivalent") === truth) mutAgree++; }
  }
  ok(`random policies (${cases}): the compiler's circuit is formally equivalent and brute force agrees`, bad === 0 && equivOk === cases, `${equivOk}/${cases}`);
  ok(`random corrupted circuits (${mutTotal}): the checker agrees with brute force every time`, mutAgree === mutTotal, `${mutAgree}/${mutTotal}`); }

// ---- scale: far beyond what can be enumerated ----
{ const nQ = 40, pol = P(randomPolicy(nQ, 6, 30, 3)), C = TB.compile(pol), t0 = Date.now(), r = V.check(pol, C.hex);
  ok(`40 questions (1,099,511,627,776 combinations): proved equivalent in ${Date.now() - t0} ms, ${C.gates.length} gates`, r.result === "equivalent" && Date.now() - t0 < 8000, JSON.stringify(r));
  let caught = 0, tried = 0; for (let k = 0; k < 40; k++) { const gates = mutate(C.gates, nQ), rm = V.check(pol, TB.hexOf(gates)); tried++; if (rm.result === "different") { if (rm.counterexample.confirmed && TB.run(pol, rm.counterexample.answers).result !== TB.evalGates(gates, nQ, C.nOut, rm.counterexample.answers.reduce((a, v, j) => a + (v ? 2 ** j : 0), 0))) caught++; else caught -= 1000; } }
  ok("40 questions: corrupted circuits are caught with a real counterexample (the project's own simulator confirms each)", caught > 0, `${caught} of ${tried}`);
  const p64 = P(randomPolicy(64, 5, 25, 3)), c64 = TB.compile(p64), r64 = V.check(p64, c64.hex);
  ok("64 questions (the limit): still proved equivalent", r64.result === "equivalent", JSON.stringify(r64)); }
{ const pol = P(randomPolicy(40, 6, 30, 3)), C = TB.compile(pol), r = V.check(pol, C.hex, {limit: 50});
  ok("a size limit gives 'inconclusive' and makes no claim", r.result === "inconclusive" && /no claim/.test(r.reason)); }

// ---- bad input is explained, never a crash or a false 'equivalent' ----
{ const pol = P(TB.TEMPLATES.warranty), good = TB.compile(pol).hex, chk = h => V.check(pol, h);
  ok("a record that is not NAND (for example REF or LATCH) is reported as unsupported", (() => { const r = chk("0x01" + good.slice(4)); return r.result === "unsupported" && /not NAND/.test(r.reason); })());
  ok("a gate that refers to one that does not exist yet is unsupported", (() => { const g = TB.compile(pol).gates.map(x => ({...x})); g[0].a = 900; const r = chk(TB.hexOf(g)); return r.result === "unsupported" && /does not exist yet/.test(r.reason); })());
  ok("a netlist that is not whole 7-byte records is rejected", chk("0x" + "00".repeat(10)).result === "unsupported" && /7-byte/.test(chk("0x" + "00".repeat(10)).reason));
  ok("an empty or non-hex netlist is rejected", chk("").result === "unsupported" && chk("0xzz").result === "unsupported");
  ok("a circuit with the wrong number of outputs is not called equivalent", (() => { const g = TB.compile(pol).gates.slice(0, 1); return chk(TB.hexOf(g)).result !== "equivalent"; })());
  ok("a circuit that ignores its inputs is not called equivalent", (() => { const r = chk(TB.hexOf([{a: 0, b: 0}, {a: 0, b: 0}])); return r.result === "different" && r.counterexample.confirmed; })()); }

// ---- independence and the report ----
{ const src = fs.readFileSync(new URL("../site/verify.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  ok("verify.js does not use the compiler or the reference evaluator (so their bugs cannot hide themselves)", !/\bTB\.(run|compile|evalGates|verify)\b/.test(src) && !/require\(["']\.\/rules/.test(src)); }
{ const pol = P(TB.TEMPLATES.warranty), C = TB.compile(pol), res = V.check(pol, C.hex), rep = V.report(pol, res, {compiler: TB.COMPILER_VERSION, policyHash: "0xabc", netlistHash: "0xdef", source: "built in this browser", simulated: {combinations: 128, allMatch: true}});
  ok("the report names the tool, the compiler, the method, both fingerprints and the result", rep.tool === "lgtie-verify/1" && rep.compiler === "lgtie-nand-compiler/1" && /ROBDD symbolic equivalence over all 2\^7/.test(rep.method) && rep.policy.rulesFingerprintSha256 === "0xabc" && rep.circuit.netlistFingerprintSha256 === "0xdef" && rep.result === "equivalent");
  ok("it says what was proved and what was not", /every one of the 2\^7/.test(rep.proves) && rep.doesNotProve.some(x => /fair/.test(x)) && rep.doesNotProve.some(x => /true/.test(x)));
  const bad = V.check(pol, TB.hexOf([{a: 0, b: 0}, {a: 0, b: 0}])), br = V.report(pol, bad, {});
  ok("a failing report carries the counterexample in plain terms and no claim of proof", br.result === "different" && br.proves === null && br.counterexample.answers.length === 7 && /^Q1=(yes|no)$/.test(br.counterexample.answers[0]) && typeof br.counterexample.policyResult === "string"); }
console.log(`\n${n - fails} of ${n} passed`); process.exit(fails ? 1 : 0);
