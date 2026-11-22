import {createRequire} from "node:module";
import {build, reference} from "../compiler/warranty.mjs";
const TB = createRequire(import.meta.url)("../site/rules.js");
let fails = 0; const ok = (name, cond, extra = "") => { console.log((cond ? "ok   " : "FAIL ") + name + (cond ? "" : " " + extra)); if (!cond) fails++; };
for (const key of Object.keys(TB.TEMPLATES)) {
  const r = TB.parse(TB.TEMPLATES[key]); ok(`${key}: parses`, !r.errors.length, JSON.stringify(r.errors));
  const P = r.policy, C = TB.compile(P), v = TB.verify(P, C);
  ok(`${key}: circuit equals the policy on ${v.checked} combinations`, v.ok, JSON.stringify(v));
  ok(`${key}: output width ${C.nOut} bits for ${P.results.length} results`, C.nOut === Math.max(1, Math.ceil(Math.log2(P.results.length))));
  console.log(`     ${key}: ${P.questions.length} questions, ${C.gates.length} gates`);
}
// The generic compiler agrees with the hand-built warranty circuit from the brief.
const P = TB.parse(TB.TEMPLATES.warranty).policy, C = TB.compile(P), hand = build();
let same = true; for (let m = 0; m < 128; m++) { const q = Array.from({length: 7}, (_, k) => (m >> k) & 1); if (TB.evalGates(C.gates, 7, 2, m) !== reference(q)) same = false; }
ok("warranty: generic compiler matches the reference rule table", same);
ok("warranty: hand-built circuit is smaller (" + hand.gates.length + " vs " + C.gates.length + " gates), same behaviour", hand.gates.length <= C.gates.length);
// Example from the brief: filer says all yes, decider says Q5 no -> not covered; all yes -> covered.
ok("all yes is Covered", TB.run(P, Array(7).fill(true)).result === 3);
ok("Q5 no is Not covered with a reason", TB.run(P, [true, true, true, true, false, true, true]).why.includes("excluded cause"));
// Parse errors are reported with line numbers.
const bad = TB.parse("name: x\nquestion: a\nresult: A\nresult: B\nrule: Q9=no -> A\nrule: nonsense\ndefault: Z");
ok("bad rules are rejected with line numbers", bad.errors.length >= 3 && bad.errors.every(e => typeof e.line === "number"), JSON.stringify(bad.errors));
ok("canonical text round-trips", (() => { const t = TB.canonical(P), r2 = TB.parse(t); return !r2.errors.length && TB.canonical(r2.policy) === t; })());
// Edge cases: a result that no rule can reach, a single rule, 1 question.
const e1 = TB.parse("name: tiny\nquestion: ok?\nresult: No\nresult: Yes\ndefault: Yes : fine").policy, c1 = TB.compile(e1);
ok("default-only policy compiles and is always Yes", TB.verify(e1, c1).ok && TB.evalGates(c1.gates, 1, c1.nOut, 0) === 1 && TB.evalGates(c1.gates, 1, c1.nOut, 1) === 1);
const e2 = TB.parse("name: t\nquestion: ok?\nresult: No\nresult: Yes\nrule: Q1=yes -> Yes : y\ndefault: No : n").policy;
ok("single rule: question yes -> Yes, no -> No", (() => { const c = TB.compile(e2); return TB.verify(e2, c).ok && TB.evalGates(c.gates, 1, c.nOut, 1) === 1 && TB.evalGates(c.gates, 1, c.nOut, 0) === 0; })());
console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
