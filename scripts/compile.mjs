// node scripts/compile.mjs <warranty|bounty|path/to/rules.txt>  -> prints JSON: {name, nQ, nOut, gates, hex, definitionsHash, canonical}
import {createRequire} from "node:module"; import {readFileSync} from "node:fs"; import {createHash} from "node:crypto";
const TB = createRequire(import.meta.url)("../site/rules.js");
const arg = process.argv[2]; if (!arg) { console.error("usage: compile.mjs <warranty|bounty|file>"); process.exit(2); }
const text = TB.TEMPLATES[arg] || readFileSync(arg, "utf8"), r = TB.parse(text);
if (r.errors.length) { console.error(r.errors.map(e => `line ${e.line}: ${e.message}`).join("\n")); process.exit(1); }
const P = r.policy, C = TB.compile(P), v = TB.verify(P, C); if (!v.ok) { console.error("Circuit does not match the rules: " + JSON.stringify(v)); process.exit(1); }
const canonical = TB.canonical(P);
console.log(JSON.stringify({name: P.name, nQ: C.nIn, nOut: C.nOut, gates: C.gates.length, hex: C.hex, definitionsHash: "0x" + createHash("sha256").update(canonical).digest("hex"), canonical}));
