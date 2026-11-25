// Formal check that a circuit implements a policy, for EVERY combination of answers (not a sample), without trying them one by one.
//
// How: both sides are turned into reduced ordered binary decision diagrams (ROBDDs), a canonical form of a boolean function, so two functions are the
// same exactly when their diagrams are the same node. If they differ, a satisfying path through the XOR of the two gives a concrete answer set where
// the circuit and the rules disagree (a counterexample).
//   - The POLICY side is built straight from the parsed rules (questions, conditions, result numbers, first match wins, then the default). It does not call
//     the compiler or the reference evaluator (rules.js compile/run), so a bug in either of those cannot hide itself.
//   - The CIRCUIT side is built from the raw netlist records (7 bytes each: a type byte, then two 3-byte references; type 0 is NAND, references 0 and 1 are the
//     constants 0 and 1, inputs start at 2, and the outputs are the last gates), the same bytes the TapeOut processor stores and runs. It can come from the
//     compiler in this page or be read back from X Layer, which checks what was actually published.
// What this proves: the circuit and the rules compute the same result for all 2^n answers. What it does NOT prove: that the rules are fair or complete, that
// the answers are true, or that the questions mean what the business thinks. A BDD can in theory grow very large for unusual logic; there is a size limit, and
// then the result is "inconclusive" rather than a guess.
// Pure, so it can be tested in Node (module.exports); the page uses window.TB_VERIFY.
(function (root) {
  "use strict";
  const VERSION = "lgtie-verify/1";

  class BDD {
    constructor(nVars, limit) { this.n = nVars; this.limit = limit || 1500000; this.v = [nVars, nVars]; this.lo = [0, 1]; this.hi = [0, 1]; this.uniq = new Map(); this.memo = new Map(); }
    get size() { return this.v.length; }
    mk(v, lo, hi) {
      if (lo === hi) return lo;
      const k = v + "," + lo + "," + hi, f = this.uniq.get(k); if (f !== undefined) return f;
      if (this.v.length >= this.limit) throw new Error("size-limit");
      const id = this.v.length; this.v.push(v); this.lo.push(lo); this.hi.push(hi); this.uniq.set(k, id); return id;
    }
    variable(i) { return this.mk(i, 0, 1); }
    ite(f, g, h) {
      if (f === 1) return g; if (f === 0) return h; if (g === h) return g; if (g === 1 && h === 0) return f;
      const k = f + "," + g + "," + h, m = this.memo.get(k); if (m !== undefined) return m;
      const top = Math.min(this.v[f], this.v[g], this.v[h]);
      const co = (x, b) => this.v[x] === top ? (b ? this.hi[x] : this.lo[x]) : x;
      const r = this.mk(top, this.ite(co(f, 0), co(g, 0), co(h, 0)), this.ite(co(f, 1), co(g, 1), co(h, 1)));
      this.memo.set(k, r); return r;
    }
    not(f) { return this.ite(f, 0, 1); }
    and(f, g) { return this.ite(f, g, 0); }
    or(f, g) { return this.ite(f, 1, g); }
    xor(f, g) { return this.ite(f, this.not(g), g); }
    // one assignment (array of booleans, true = the variable is 1) that makes f true, or null. Variables the path does not mention are left at false.
    satisfy(f) {
      if (f === 0) return null; const a = new Array(this.n).fill(false);
      while (f > 1) { if (this.lo[f] !== 0) f = this.lo[f]; else { a[this.v[f]] = true; f = this.hi[f]; } }
      return a;
    }
  }

  // ---- reading a netlist ----
  // Netlist hex: records of 7 bytes: type (1), a (3), b (3). Type 0 = NAND. Returns {gates: [{type, a, b}]} or {error}.
  function decodeNetlist(hex) {
    const h = String(hex || "").replace(/^0x/i, "");
    if (!/^[0-9a-fA-F]*$/.test(h) || h.length % 2) return {error: "The netlist is not valid hex."};
    if (h.length === 0) return {error: "The netlist is empty."};
    if ((h.length / 2) % 7) return {error: "The netlist is " + h.length / 2 + " bytes, which is not a whole number of 7-byte records."};
    const gates = []; for (let i = 0; i < h.length; i += 14) gates.push({type: parseInt(h.slice(i, i + 2), 16), a: parseInt(h.slice(i + 2, i + 8), 16), b: parseInt(h.slice(i + 8, i + 14), 16)});
    return {gates};
  }
  const outBits = n => { let b = 1; while ((1 << b) < n) b++; return b; };

  // The circuit's output functions (one per result bit), by symbolic NAND evaluation. {outs, dead} or throws {message}.
  function circuitFunctions(bdd, gates, nIn, nOut) {
    if (gates.length < nOut) throw new Error("The circuit has fewer gates (" + gates.length + ") than outputs (" + nOut + ").");
    const val = new Array(2 + nIn + gates.length); val[0] = 0; val[1] = 1; for (let k = 0; k < nIn; k++) val[2 + k] = bdd.variable(k);
    const used = new Uint8Array(gates.length);
    gates.forEach((g, i) => {
      if (g.type !== 0) throw new Error("Record " + (i + 1) + " has type " + g.type + ", not NAND. This checker only handles NAND records (it does not handle REF or LATCH).");
      const self = 2 + nIn + i;
      if (g.a >= self || g.b >= self) throw new Error("Gate " + (i + 1) + " refers to a node that does not exist yet (" + (g.a >= self ? g.a : g.b) + ").");
      val[self] = bdd.not(bdd.and(val[g.a], val[g.b]));
      if (g.a >= 2 + nIn) used[g.a - 2 - nIn] = 1; if (g.b >= 2 + nIn) used[g.b - 2 - nIn] = 1;
    });
    const outs = []; for (let o = 0; o < nOut; o++) { const gi = gates.length - nOut + o; outs.push(val[2 + nIn + gi]); used[gi] = 1; }
    return {outs, dead: used.reduce((n, u) => n + (u ? 0 : 1), 0)};
  }

  // The policy's output functions, straight from the parsed rules: first matching rule wins, otherwise the default.
  function policyFunctions(bdd, P) {
    const nR = P.results.length, R = new Array(nR).fill(0); let before = 0;
    P.rules.forEach(r => {
      let match = 1; r.conds.forEach(c => { const lit = bdd.variable(c.q); match = bdd.and(match, c.yes ? lit : bdd.not(lit)); });
      R[r.result] = bdd.or(R[r.result], bdd.and(match, bdd.not(before))); before = bdd.or(before, match);
    });
    R[P.def.result] = bdd.or(R[P.def.result], bdd.not(before));
    const nOut = outBits(nR), outs = [];
    for (let b = 0; b < nOut; b++) { let f = 0; for (let r = 0; r < nR; r++) if ((r >> b) & 1) f = bdd.or(f, R[r]); outs.push(f); }
    return outs;
  }

  // Simulate the netlist for one set of answers (used only to double-check a counterexample).
  function simulate(gates, nIn, nOut, answers) {
    const v = {0: 0, 1: 1}; for (let k = 0; k < nIn; k++) v[2 + k] = answers[k] ? 1 : 0;
    gates.forEach((g, i) => { v[2 + nIn + i] = 1 - (v[g.a] & v[g.b]); });
    let out = 0; for (let o = 0; o < nOut; o++) out += v[2 + nIn + gates.length - nOut + o] * 2 ** o; return out;
  }
  function policyResult(P, answers) {
    for (const r of P.rules) if (r.conds.every(c => !!answers[c.q] === c.yes)) return r.result;
    return P.def.result;
  }

  // P: a parsed policy. netlist: hex string or {gates}. Returns a plain object (see report()).
  function check(P, netlist, opts) {
    const t0 = Date.now(), nQ = P.questions.length, nOut = outBits(P.results.length), out = {version: VERSION, nQuestions: nQ, nResults: P.results.length, nRules: P.rules.length, nOut};
    const dec = typeof netlist === "string" ? decodeNetlist(netlist) : {gates: netlist.gates.map(g => ({type: g.type === undefined ? 0 : g.type, a: g.a, b: g.b}))};
    if (dec.error) return Object.assign(out, {result: "unsupported", reason: dec.error});
    const gates = dec.gates; out.nGates = gates.length; out.records = {NAND: gates.filter(g => g.type === 0).length, other: gates.filter(g => g.type !== 0).length};
    try {
      const bdd = new BDD(nQ, opts && opts.limit), want = policyFunctions(bdd, P);
      let got, dead; try { ({outs: got, dead} = circuitFunctions(bdd, gates, nQ, nOut)); } catch (e) { if (e.message === "size-limit") throw e; return Object.assign(out, {result: "unsupported", reason: e.message}); }
      out.deadGates = dead; out.bddNodes = bdd.size;
      let diff = 0; for (let b = 0; b < nOut; b++) diff = bdd.or(diff, bdd.xor(want[b], got[b]));
      out.ms = Date.now() - t0;
      if (diff === 0) return Object.assign(out, {result: "equivalent", counterexample: null});
      const a = bdd.satisfy(diff), w = policyResult(P, a), g = simulate(gates, nQ, nOut, a);
      return Object.assign(out, {result: "different", counterexample: {answers: a, policyResult: w, circuitResult: g, confirmed: w !== g}});
    } catch (e) {
      if (e && e.message === "size-limit") return Object.assign(out, {result: "inconclusive", reason: "The diagram grew past its size limit before the comparison finished, so no claim is made.", ms: Date.now() - t0});
      throw e;
    }
  }

  // A report that can be saved and re-checked. extras: {policyHash, netlistHash, source, generatedAt, policyHashMethod}
  function report(P, res, extras) {
    const x = extras || {};
    return {
      tool: VERSION, compiler: x.compiler || null, generatedAt: x.generatedAt || new Date().toISOString(),
      method: "ROBDD symbolic equivalence over all 2^" + res.nQuestions + " answer combinations",
      policy: {name: P.name, questions: res.nQuestions, results: res.nResults, rules: res.nRules, rulesFingerprintSha256: x.policyHash || null},
      circuit: {source: x.source || "unspecified", records: res.nGates, nand: res.records ? res.records.NAND : null, otherRecords: res.records ? res.records.other : null, deadGates: res.deadGates === undefined ? null : res.deadGates, netlistFingerprintSha256: x.netlistHash || null},
      result: res.result, reason: res.reason || null,
      counterexample: res.counterexample ? {answers: res.counterexample.answers.map((a, i) => "Q" + (i + 1) + "=" + (a ? "yes" : "no")), policyResult: P.results[res.counterexample.policyResult], circuitResult: P.results[res.counterexample.circuitResult] !== undefined ? P.results[res.counterexample.circuitResult] : "code " + res.counterexample.circuitResult} : null,
      stats: {bddNodes: res.bddNodes === undefined ? null : res.bddNodes, milliseconds: res.ms === undefined ? null : res.ms},
      alsoSimulated: x.simulated || null,
      proves: res.result === "equivalent" ? "The circuit and the rules compute the same result for every one of the 2^" + res.nQuestions + " possible answer combinations." : null,
      doesNotProve: ["That the rules are fair, complete or sensible.", "That any answer is true.", "That the questions mean what the business intends.", "Anything about the contracts that run the case: they are unaudited."]
    };
  }


  // SHA-256 of the netlist bytes (what the report calls the netlist fingerprint). Works in the browser and in Node 19+.
  async function netlistFingerprint(hex) {
    const h = String(hex).replace(/^0x/i, ""), bytes = Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));
    return "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  const big = n => (2n ** BigInt(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // Plain words for a result, in English or Chinese: {level: "ok" | "err" | "mute", headline, detail}
  function describe(res, P, lang) {
    const zh = lang === "zh", n = res.nQuestions;
    if (res.result === "equivalent") return {level: "ok",
      headline: zh ? "✓ 已证明：电路与你的规则始终一致" : "✓ Proved: the circuit and the rules always agree",
      detail: zh ? `对全部 ${big(n)} 种（2^${n}）可能的答案组合都做了符号化检查，而不是抽样。这证明电路确实实现了所写的规则；它并不证明规则公平，也不证明答案属实。`
        : `Checked symbolically for all ${big(n)} possible answer combinations (2^${n}), not a sample. This proves the circuit implements the rules as written. It does not prove the rules are fair or the answers are true.`};
    if (res.result === "different") { const c = res.counterexample, ans = c.answers.map((a, i) => "Q" + (i + 1) + "=" + (zh ? (a ? "是" : "否") : (a ? "yes" : "no"))).join(", "), nm = i => P.results[i] !== undefined ? P.results[i] : (zh ? "代码 " : "code ") + i;
      return {level: "err", headline: zh ? "✗ 电路与规则不一致" : "✗ The circuit and the rules disagree",
        detail: zh ? `例如当答案为 ${ans} 时：规则给出“${nm(c.policyResult)}”，电路给出“${nm(c.circuitResult)}”。请不要依赖这个电路。` : `For example when the answers are ${ans}: the rules give "${nm(c.policyResult)}" but the circuit gives "${nm(c.circuitResult)}". Do not rely on this circuit.`}; }
    if (res.result === "unsupported") return {level: "mute", headline: zh ? "无法检查这个电路" : "This circuit cannot be checked", detail: res.reason};
    return {level: "mute", headline: zh ? "未作出结论" : "No conclusion", detail: zh ? "比较过程中图的规模超过了上限，因此不作任何结论。" : res.reason};
  }
  function describeMismatch(have, want, lang) {
    return lang === "zh" ? `这个电路有 ${have.nIn} 个输入和 ${have.nOut} 个输出，而这些规则有 ${want.nQ} 个问题（需要 ${want.nOut} 个输出）。它不是这套规则对应的电路。`
      : `This circuit has ${have.nIn} inputs and ${have.nOut} outputs, but these rules have ${want.nQ} questions (and need ${want.nOut} outputs). It is not the circuit for these rules.`;
  }

  const api = {VERSION, BDD, decodeNetlist, check, report, netlistFingerprint, describe, describeMismatch, circuitFunctions, policyFunctions, simulate, policyResult, outBits};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TB_VERIFY = api;
})(typeof window !== "undefined" ? window : globalThis);
