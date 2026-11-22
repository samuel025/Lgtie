// LGtie rule engine: parse a plain-text policy, run it, compile it to a TapeOut NAND netlist, prove the two agree.
// Works in the browser (window.TB) and in Node (require). No dependencies.
(function (root) {
  "use strict";
  // ---------- policy text format ----------
  // name: Warranty claims
  // about: one line shown to the person answering
  // question: Is it within the warranty period? | Purchase date on the receipt
  // result: Not covered                      (results are numbered in the order written: 0, 1, 2 ...)
  // rule: Q2=no -> Not covered : Explanation shown when this rule decides      (rules are checked top to bottom; first match wins)
  // default: Covered : Explanation shown when no rule matched
  function parse(text) {
    const P = {name: "", about: "", questions: [], results: [], rules: [], def: null}, errors = [];
    const err = (n, m) => errors.push({line: n, message: m});
    String(text || "").split(/\r?\n/).forEach((raw, i) => {
      const n = i + 1, line = raw.trim(); if (!line || line.startsWith("#")) return;
      const m = /^(name|about|question|result|rule|default)\s*:\s*(.*)$/i.exec(line);
      if (!m) { err(n, "Start the line with name:, about:, question:, result:, rule: or default:"); return; }
      const key = m[1].toLowerCase(), val = m[2].trim();
      if (key === "name") P.name = val; else if (key === "about") P.about = val;
      else if (key === "question") { const [q, hint] = val.split("|").map(s => s.trim()); if (!q) err(n, "A question needs some text."); else P.questions.push({id: "Q" + (P.questions.length + 1), text: q, hint: hint || ""}); }
      else if (key === "result") { if (!val) err(n, "A result needs a name."); else P.results.push(val); }
      else if (key === "default") { const [r, why] = val.split(/\s:\s/).map(s => s.trim()); P.def = {resultName: r, why: why || "", line: n}; }
      else { // rule
        const arrow = val.split(/\s*->\s*/); if (arrow.length !== 2) { err(n, "A rule looks like: Q1=no & Q2=yes -> Result name : explanation"); return; }
        const [rname, why] = arrow[1].split(/\s:\s/).map(s => s.trim());
        const conds = arrow[0].split("&").map(s => s.trim()).filter(Boolean).map(c => { const cm = /^Q(\d+)\s*=\s*(yes|no)$/i.exec(c); return cm ? {q: Number(cm[1]) - 1, yes: cm[2].toLowerCase() === "yes", raw: c} : {bad: c}; });
        if (!conds.length) { err(n, "A rule needs at least one condition, such as Q1=no."); return; }
        conds.filter(c => c.bad).forEach(c => err(n, `"${c.bad}" is not a condition. Use Q1=yes or Q1=no.`));
        P.rules.push({conds, resultName: rname, why: why || "", line: n});
      }
    });
    if (!P.name) errors.push({line: 0, message: "Add a name: line."});
    if (!P.questions.length) errors.push({line: 0, message: "Add at least one question: line."});
    if (P.questions.length > 64) errors.push({line: 0, message: "At most 64 questions."});
    if (P.results.length < 2) errors.push({line: 0, message: "Add at least two result: lines."});
    if (P.results.length > 256) errors.push({line: 0, message: "At most 256 results."});
    if (!P.def) errors.push({line: 0, message: "Add a default: line (the result when no rule matches)."});
    const idx = nm => P.results.findIndex(r => r.toLowerCase() === String(nm || "").toLowerCase());
    P.rules.forEach(r => { r.result = idx(r.resultName); if (r.result < 0) err(r.line, `"${r.resultName}" is not one of the result: lines.`); r.conds.forEach(c => { if (!c.bad && (c.q < 0 || c.q >= P.questions.length)) err(r.line, `${c.raw} refers to a question that does not exist.`); }); });
    if (P.def) { P.def.result = idx(P.def.resultName); if (P.def.result < 0) err(P.def.line, `"${P.def.resultName}" is not one of the result: lines.`); }
    return errors.length ? {errors} : {policy: P, errors: []};
  }

  // ---------- run a policy directly (the reference the circuit is checked against) ----------
  // answers: array of booleans, one per question. -> {result, why, ruleIndex} (ruleIndex -1 = default)
  function run(P, answers) {
    for (let i = 0; i < P.rules.length; i++) { const r = P.rules[i]; if (r.conds.every(c => !!answers[c.q] === c.yes)) return {result: r.result, why: r.why, ruleIndex: i}; }
    return {result: P.def.result, why: P.def.why, ruleIndex: -1};
  }
  const resultBits = P => Math.max(1, Math.ceil(Math.log2(P.results.length)));

  // ---------- NAND netlist builder (refs: 0/1 reserved, inputs from 2, gates after; 7 bytes per gate) ----------
  class Net {
    constructor(nIn) { this.nIn = nIn; this.gates = []; this.memo = new Map(); this.inputs = Array.from({length: nIn}, (_, i) => 2 + i); }
    nand(a, b) { const k = a < b ? a + "," + b : b + "," + a; if (this.memo.has(k)) return this.memo.get(k); this.gates.push({a, b}); const r = 2 + this.nIn + this.gates.length - 1; this.memo.set(k, r); return r; }
    not(a) { return this.nand(a, a); }
    and(a, b) { return this.not(this.nand(a, b)); }
    or(a, b) { return this.nand(this.not(a), this.not(b)); }
    finalCopy(x) { this.gates.push({a: x, b: x}); return 2 + this.nIn + this.gates.length - 1; } // an output owns its gate: NOT(x) with x = NOT(wanted)
  }
  const hexOf = gates => "0x" + gates.map(g => "00" + g.a.toString(16).padStart(6, "0") + g.b.toString(16).padStart(6, "0")).join("");
  function evalGates(gates, nIn, nOut, m) { // m = integer, input k = bit k
    const v = {0: 0, 1: 1}; for (let k = 0; k < nIn; k++) v[2 + k] = Math.floor(m / 2 ** k) % 2;
    gates.forEach((g, i) => { v[2 + nIn + i] = 1 - (v[g.a] & v[g.b]); });
    let out = 0; for (let o = 0; o < nOut; o++) out += v[2 + nIn + gates.length - nOut + o] * 2 ** o; return out;
  }

  // ---------- compile: first-match rules -> NAND circuit ----------
  function compile(P) {
    const nQ = P.questions.length, nOut = resultBits(P), n = new Net(nQ);
    const lit = (q, yes) => yes ? n.inputs[q] : n.not(n.inputs[q]);
    const x0 = n.inputs[0]; let zeroSig = null; const zero = () => zeroSig === null ? (zeroSig = n.and(x0, n.not(x0))) : zeroSig, one = () => n.not(zero()); // only built when a bit is constant
    const fires = []; let notYet = null; // notYet = no earlier rule matched
    P.rules.forEach(r => {
      let cond = lit(r.conds[0].q, r.conds[0].yes); for (const c of r.conds.slice(1)) cond = n.and(cond, lit(c.q, c.yes));
      fires.push({res: r.result, sig: notYet === null ? cond : n.and(cond, notYet)});
      notYet = notYet === null ? n.not(cond) : n.and(notYet, n.not(cond));
    });
    fires.push({res: P.def.result, sig: notYet === null ? one() : notYet});
    const bitSig = [];
    for (let b = 0; b < nOut; b++) {
      const terms = fires.filter(f => (f.res >> b) & 1).map(f => f.sig);
      bitSig.push(terms.length ? terms.reduce((acc, t) => n.or(acc, t)) : zero());
    }
    const inv = bitSig.map(s => n.not(s)); // computed before the output gates so they stay last
    inv.forEach(s => n.finalCopy(s));
    const gates = prune(n.gates, nQ, nOut);
    return {gates, hex: hexOf(gates), nIn: nQ, nOut};
  }

  // Drop gates that feed no output (outputs are the last nOut gates) and renumber. Behaviour is unchanged.
  function prune(gates, nIn, nOut) {
    const base = 2 + nIn, live = new Set(), stack = [];
    for (let i = gates.length - nOut; i < gates.length; i++) { live.add(i); stack.push(i); }
    while (stack.length) { const g = gates[stack.pop()]; for (const r of [g.a, g.b]) { const k = r - base; if (k >= 0 && !live.has(k)) { live.add(k); stack.push(k); } } }
    const keep = [...live].sort((a, b) => a - b), idx = new Map(keep.map((k, i) => [k, i])), re = r => { const k = r - base; return k < 0 ? r : base + idx.get(k); };
    return keep.map(k => ({a: re(gates[k].a), b: re(gates[k].b)}));
  }

  // Prove the circuit equals the policy on every answer combination (or a seeded sample when there are many questions).
  function verify(P, C) {
    const nQ = P.questions.length, total = 2 ** Math.min(nQ, 40), exhaustive = nQ <= 14, N = exhaustive ? 2 ** nQ : 4096;
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < N; i++) {
      const m = exhaustive ? i : Math.floor(rnd() * 2 ** Math.min(nQ, 48));
      const answers = Array.from({length: nQ}, (_, k) => Math.floor(m / 2 ** k) % 2 === 1);
      const want = run(P, answers).result, got = evalGates(C.gates, nQ, C.nOut, m);
      if (want !== got) return {ok: false, checked: i + 1, exhaustive, m, want, got};
    }
    return {ok: true, checked: N, exhaustive, total};
  }

  const encodeAnswers = answers => answers.reduce((acc, a, k) => acc + (a ? 2 ** k : 0), 0); // question k = bit k (TapeOut input order)
  const decodeAnswers = (m, nQ) => Array.from({length: nQ}, (_, k) => Math.floor(m / 2 ** k) % 2 === 1);

  // Canonical text of a policy (what gets hashed and published as the "definitions document").
  function canonical(P) {
    return [`name: ${P.name}`, P.about ? `about: ${P.about}` : null, ...P.questions.map(q => `question: ${q.text}${q.hint ? " | " + q.hint : ""}`), ...P.results.map(r => `result: ${r}`),
      ...P.rules.map(r => `rule: ${r.conds.map(c => `Q${c.q + 1}=${c.yes ? "yes" : "no"}`).join(" & ")} -> ${r.resultName}${r.why ? " : " + r.why : ""}`), `default: ${P.def.resultName}${P.def.why ? " : " + P.def.why : ""}`].filter(Boolean).join("\n") + "\n";
  }

  // ---------- built-in templates ----------
  const TEMPLATES = {
    warranty: `name: Warranty claims
about: Find out whether a repair would be covered before you file a claim.
question: Is the product registered, or can you show proof of purchase? | Registration number or receipt
question: Is it still within the warranty period? | Purchase date
question: Was it bought from an authorised seller? | Seller name on the receipt
question: Is this type of damage or fault one the warranty covers? | Fault description and photos
question: Is there no excluded cause, such as water damage, a drop or an unauthorised repair? | Repair centre inspection note
question: Is the product within its usage limit? | Usage reading or hours
question: Is the repair you need one the warranty covers? | Repair centre quote
result: Not covered
result: Needs review
result: Partly covered (parts, not labour)
result: Covered
rule: Q1=no -> Not covered : The product is not registered and no proof of purchase was shown.
rule: Q2=no -> Not covered : The warranty period has ended.
rule: Q4=no -> Not covered : This type of damage or fault is not covered by the warranty.
rule: Q5=no -> Not covered : An excluded cause was found (for example water damage, a drop or an unauthorised repair).
rule: Q7=no -> Not covered : This type of repair is not covered by the warranty.
rule: Q3=no -> Needs review : It was not bought from an authorised seller, so a person has to look at it.
rule: Q6=no -> Partly covered (parts, not labour) : The usage limit was exceeded, so parts are covered but labour is not.
default: Covered : Every condition of the warranty is met.
`,
    bounty: `name: Bug bounty severity
about: Agree how serious a reported vulnerability is by answering plain questions instead of arguing about the label.
question: Can an attacker start it without any special role or permission? | Reproduction steps from an unprivileged account
question: Can it cause an unauthorised loss of funds or assets? | Proof of concept or transaction trace
question: Does it affect more than one user or pool? | Proof of concept showing a second victim
question: Does it work without any victim having to sign or click anything? | Demonstration with no victim step
question: Can the attacker repeat it with the same effect? | A second run on the same fork
question: Is the damage permanent, so the project cannot reverse it? | Analysis of recovery options
question: Could a reviewer reproduce it on a fork or testnet? | Reviewer's reproduction log
question: Is the affected asset on the programme's published scope list? | Link to the scope entry
result: Rejected
result: Low
result: Medium
result: High
result: Critical
rule: Q8=no -> Rejected : The affected asset is not in the programme's scope.
rule: Q7=no -> Rejected : The issue could not be reproduced.
rule: Q1=yes & Q2=yes & Q4=yes & Q6=yes -> Critical : Anyone can steal funds permanently without any victim action.
rule: Q2=yes & Q6=yes -> High : Funds can be lost permanently, but the attack needs a special role or a victim action.
rule: Q2=yes -> Medium : Funds can be lost, but the loss can be reversed.
rule: Q6=yes -> Medium : Permanent damage without a loss of funds.
default: Low : It is reproducible and in scope, but there is no loss of funds and no permanent damage.
`
  };

  const API = {parse, run, compile, verify, resultBits, encodeAnswers, decodeAnswers, canonical, hexOf, evalGates, TEMPLATES, Net};
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.TB = API;
})(typeof window !== "undefined" ? window : globalThis);
