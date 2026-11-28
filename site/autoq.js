// Automatic questions, reference implementation (design: docs/AUTO-QUESTIONS.md, Phase 0). Pure functions, no DOM, no network, nothing deployed.
// A future TiebreakCaseV6 must give exactly these answers for the same inputs; tests/autoq.test.mjs is the table it is checked against.
// An automatic question is one whose answer the code works out. The parties cannot answer or dispute it and a reviewer cannot change it.
(function () {
  "use strict";
  const MAX_Q = 64, MIN_SEC = 3600, MAX_SEC = 90 * 86400, WHOLE_CASE = 255;
  const KINDS = ["evidenceBy", "openedBefore", "readAtLeast"];
  const big = v => { try { return typeof v === "bigint" ? v : BigInt(v); } catch { return null; } };

  /// Checks a spec list against a rule set with `nQuestions` questions. Returns a list of problems (empty when it is acceptable).
  function validate(specs, nQuestions) {
    const bad = [];
    if (!Number.isInteger(nQuestions) || nQuestions < 1 || nQuestions > MAX_Q) return ["the rule set must have 1 to " + MAX_Q + " questions"];
    if (!Array.isArray(specs)) return ["specs must be a list"];
    const seen = new Set();
    specs.forEach((s, i) => {
      const at = "automatic question " + (i + 1) + ": ";
      if (!s || !KINDS.includes(s.kind)) return bad.push(at + "unknown kind");
      if (!Number.isInteger(s.q) || s.q < 0 || s.q >= nQuestions) return bad.push(at + "no such question");
      if (seen.has(s.q)) bad.push(at + "question " + (s.q + 1) + " is already automatic");
      seen.add(s.q);
      if (s.kind === "evidenceBy") {
        if (s.role !== 0 && s.role !== 1) bad.push(at + "role must be 0 (filer) or 1 (decider)");
        if (!(Number.isInteger(s.question) && ((s.question >= 0 && s.question < nQuestions) || s.question === WHOLE_CASE))) bad.push(at + "evidence must be for a real question or the whole case");
        if (!Number.isInteger(s.withinSeconds) || s.withinSeconds < MIN_SEC || s.withinSeconds > MAX_SEC) bad.push(at + "the time limit must be 1 hour to 90 days");
      } else if (s.kind === "openedBefore") {
        if (!Number.isInteger(s.deadline) || s.deadline <= 0) bad.push(at + "the deadline must be a unix time");
      } else {
        if (!/^0x[0-9a-fA-F]{40}$/.test(String(s.target || ""))) bad.push(at + "the source must be a contract address");
        if (!/^0x(?:[0-9a-fA-F]{2}){4,100}$/.test(String(s.data || ""))) bad.push(at + "the call must be a 4-byte selector then arguments, at most 100 bytes");
        if (!["gte", "eq"].includes(s.cmp)) bad.push(at + "the comparison must be gte or eq");
        if (big(s.threshold) === null || big(s.threshold) < 0n) bad.push(at + "the threshold must be a whole number");
      }
    });
    return bad;
  }

  /// ctx: {openedAt, acceptedAt (agreement acceptance time, or null if the case has no agreement), specSetAt (when the spec was written),
  ///       evidence: [{role, question, at}], reads: {<question>: {ok, value}} for readAtLeast questions, taken when the case was opened}
  /// A spec written after the agreement was accepted (or after the case was opened, with no agreement) is ignored: the rules cannot change under a signed agreement.
  const applies = ctx => ctx.specSetAt <= (ctx.acceptedAt == null ? ctx.openedAt : ctx.acceptedAt);

  function one(s, ctx) {
    if (s.kind === "openedBefore") return {auto: true, yes: ctx.openedAt <= s.deadline};
    if (s.kind === "evidenceBy") {
      const limit = ctx.openedAt + s.withinSeconds;
      return {auto: true, yes: (ctx.evidence || []).some(e => e.role === s.role && e.question === s.question && e.at <= limit)};
    }
    const r = (ctx.reads || {})[s.q], v = r && r.ok ? big(r.value) : null;
    if (v === null) return {auto: false, why: "the source could not be read, so this stays a question for the parties"};   // falls back to a human question
    const t = big(s.threshold);
    return {auto: true, yes: s.cmp === "eq" ? v === t : v >= t};
  }

  /// Which questions the code answers, and how. autoMask bit q = question q is automatic for this case; autoBits bit q = its answer.
  function compute(specs, ctx, nQuestions) {
    const problems = validate(specs, nQuestions);
    if (problems.length) throw new Error(problems[0]);
    let autoMask = 0n, autoBits = 0n; const details = [];
    if (applies(ctx)) for (const s of specs) {
      const r = one(s, ctx); details.push({q: s.q, ...r});
      if (r.auto) { autoMask |= 1n << BigInt(s.q); if (r.yes) autoBits |= 1n << BigInt(s.q); }
    } else for (const s of specs) details.push({q: s.q, auto: false, why: "written after the agreement was accepted, so it does not apply"});
    return {autoMask, autoBits, details};
  }

  /// What the contract does when both sides have answered. Returns the questions still in dispute and the answers fixed so far.
  function combine(filer, decider, specs, ctx, nQuestions) {
    const {autoMask, autoBits, details} = compute(specs, ctx, nQuestions), all = (1n << BigInt(nQuestions)) - 1n;
    const f = big(filer), d = big(decider);
    if (f < 0n || d < 0n || (f & ~all) !== 0n || (d & ~all) !== 0n) throw new Error("answer outside the questions");
    const disputed = (f ^ d) & ~autoMask;
    const fixed = (f & ~disputed & ~autoMask) | autoBits;
    return {disputed, fixed, autoMask, autoBits, details, needsReview: disputed !== 0n};
  }

  /// The reviewer's answers count only on the disputed questions; automatic questions are never among them.
  function review(c, reviewed) { return c.fixed | (big(reviewed) & c.disputed); }

  const api = {validate, compute, combine, review, applies, KINDS, WHOLE_CASE, MIN_SEC, MAX_SEC};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else window.TB_AUTOQ = api;
})();
