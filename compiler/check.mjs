import {build, reference, QUESTIONS, RESULTS} from "./warranty.mjs";
import {hexOf, evalGates} from "./nand.mjs";
const net = build(), rows = evalGates(net.gates, 7, 2);
let bad = 0;
for (let m = 0; m < 128; m++) {
  const q = Array.from({length: 7}, (_, k) => (m >> k) & 1), want = reference(q), got = rows[m][0] | (rows[m][1] << 1);
  if (want !== got) { bad++; if (bad < 5) console.log("MISMATCH", q.join(""), "want", want, "got", got); }
}
const counts = [0, 0, 0, 0]; rows.forEach(r => counts[r[0] | (r[1] << 1)]++);
console.log(bad === 0 ? "OK: circuit matches the rule table on all 128 answer combinations" : `FAIL: ${bad} mismatches`);
console.log("gates:", net.gates.length, "| result counts over 128 rows:", RESULTS.map((r, i) => `${r}: ${counts[i]}`).join(", "));
console.log("netlist:", hexOf(net.gates));
process.exit(bad ? 1 : 0);
