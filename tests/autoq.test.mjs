// Table of cases for site/autoq.js, the reference for automatic questions (docs/AUTO-QUESTIONS.md). A future contract must match these answers.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const A = createRequire(import.meta.url)("../site/autoq.js");
let n = 0; const ok = async (name, fn) => { try { await fn(); n++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + String(e.stack || e.message).split("\n").slice(0, 4).join("\n     ")); process.exitCode = 1; } };
const DAY = 86400, T0 = 1_800_000_000;
const base = {openedAt: T0, acceptedAt: T0 - 5 * DAY, specSetAt: T0 - 9 * DAY, evidence: [], reads: {}};
const bit = (r, q) => (r.autoBits >> BigInt(q)) & 1n, auto = (r, q) => (r.autoMask >> BigInt(q)) & 1n;

// ---- evidenceBy: was the filer's evidence for question 0 attached within 14 days of opening?
const EV = {kind: "evidenceBy", q: 2, role: 0, question: 0, withinSeconds: 14 * DAY};
const evCases = [
  ["on time",                       [{role: 0, question: 0, at: T0 + 3 * DAY}], 1n],
  ["exactly on the limit",          [{role: 0, question: 0, at: T0 + 14 * DAY}], 1n],
  ["one second late",               [{role: 0, question: 0, at: T0 + 14 * DAY + 1}], 0n],
  ["no evidence at all",            [], 0n],
  ["attached by the other side",    [{role: 1, question: 0, at: T0 + DAY}], 0n],
  ["for a different question",      [{role: 0, question: 1, at: T0 + DAY}], 0n],
  ["one late item, one on time",    [{role: 0, question: 0, at: T0 + 20 * DAY}, {role: 0, question: 0, at: T0 + DAY}], 1n],
];
for (const [name, evidence, yes] of evCases) await ok("evidenceBy: " + name, () => {
  const r = A.compute([EV], {...base, evidence}, 4); assert.equal(auto(r, 2), 1n); assert.equal(bit(r, 2), yes);
});

// ---- openedBefore
for (const [name, openedAt, yes] of [["before", 100, 1n], ["exactly on the deadline", 200, 1n], ["one second after", 201, 0n]]) await ok("openedBefore: " + name, () => {
  const r = A.compute([{kind: "openedBefore", q: 0, deadline: 200}], {...base, openedAt, acceptedAt: 1, specSetAt: 1}, 3); assert.equal(bit(r, 0), yes);
});

// ---- readAtLeast, and the fallback when the source fails
const RD = {kind: "readAtLeast", q: 1, target: "0x" + "ab".repeat(20), selector: "0x70a08231", cmp: "gte", threshold: "1000000"};
for (const [name, read, yes, isAuto] of [
  ["above the threshold", {ok: true, value: 2000000n}, 1n, 1n], ["exactly the threshold", {ok: true, value: "1000000"}, 1n, 1n],
  ["below", {ok: true, value: 999999n}, 0n, 1n],
  ["the call reverted: stays a human question", {ok: false}, 0n, 0n], ["no read taken: stays a human question", undefined, 0n, 0n],
]) await ok("readAtLeast: " + name, () => {
  const r = A.compute([RD], {...base, reads: read ? {1: read} : {}}, 3); assert.equal(auto(r, 1), isAuto); assert.equal(bit(r, 1), yes);
});
await ok("readAtLeast eq compares for equality", () => {
  const s = {...RD, cmp: "eq", threshold: 5};
  assert.equal(bit(A.compute([s], {...base, reads: {1: {ok: true, value: 5n}}}, 3), 1), 1n);
  assert.equal(bit(A.compute([s], {...base, reads: {1: {ok: true, value: 6n}}}, 3), 1), 0n);
});

// ---- the fairness rule: a spec written after acceptance is ignored
await ok("a spec written after the agreement was accepted does not apply", () => {
  const r = A.compute([EV], {...base, specSetAt: base.acceptedAt + 1}, 4); assert.equal(r.autoMask, 0n); assert.match(r.details[0].why, /after the agreement/);
});
await ok("a spec written exactly at acceptance applies", () => assert.equal(auto(A.compute([EV], {...base, specSetAt: base.acceptedAt}, 4), 2), 1n));
await ok("with no agreement the case opening is the cut-off", () => {
  const ctx = {...base, acceptedAt: null};
  assert.equal(auto(A.compute([EV], {...ctx, specSetAt: T0}, 4), 2), 1n);
  assert.equal(auto(A.compute([EV], {...ctx, specSetAt: T0 + 1}, 4), 2), 0n);
});

// ---- combining with the parties' answers
const ctxLate = {...base, evidence: [{role: 0, question: 0, at: T0 + 30 * DAY}]};   // evidence too late: question 2 is automatically "no"
await ok("an automatic question is never disputed, whatever the parties answer", () => {
  const c = A.combine(0b0100n, 0b0000n, [EV], ctxLate, 4);   // they differ on question 2 only
  assert.equal(c.disputed, 0n); assert.equal(c.needsReview, false); assert.equal(c.fixed & 0b0100n, 0n);
});
await ok("the code's answer replaces what both sides claimed", () => {
  const c = A.combine(0b0100n, 0b0100n, [EV], ctxLate, 4);   // both claim "yes" on question 2; the chain says no
  assert.equal(c.fixed, 0n);
});
await ok("other disagreements still go to the reviewer, and only those", () => {
  const c = A.combine(0b0101n, 0b0000n, [EV], ctxLate, 4);   // differ on questions 0 and 2
  assert.equal(c.disputed, 0b0001n); assert.equal(c.needsReview, true);
  assert.equal(A.review(c, 0b1111n), 0b0001n);   // the reviewer says yes to everything: only question 0 can change, question 2 stays no
  assert.equal(A.review(c, 0n), 0n);
});
await ok("a reviewer cannot touch an automatic question", () => {
  const ctxOn = {...base, evidence: [{role: 0, question: 0, at: T0 + DAY}]};   // automatically yes
  const c = A.combine(0b0000n, 0b0000n, [EV], ctxOn, 4);
  assert.equal(A.review(c, 0n), 0b0100n);
});
await ok("with no specs the result is exactly the old behaviour", () => {
  for (const [f, d] of [[0b1010n, 0b1010n], [0b1010n, 0b0110n], [0n, 0b1111n]]) {
    const c = A.combine(f, d, [], base, 4); assert.equal(c.disputed, f ^ d); assert.equal(c.fixed, f & ~(f ^ d)); assert.equal(c.autoMask, 0n);
  }
});
await ok("a failing source falls back: the parties decide that question and may dispute it", () => {
  const c = A.combine(0b0010n, 0b0000n, [RD], {...base, reads: {1: {ok: false}}}, 3);
  assert.equal(c.disputed, 0b0010n);
});
await ok("answers outside the questions are refused", () => assert.throws(() => A.combine(0b10000n, 0n, [], base, 4), /outside the questions/));
await ok("deterministic: the same inputs always give the same output", () => {
  const run = () => JSON.stringify(A.combine(0b0101n, 0b0011n, [EV, RD], {...ctxLate, reads: {1: {ok: true, value: 5n}}}, 4), (k, v) => typeof v === "bigint" ? v.toString() : v);
  assert.equal(run(), run());
});

// ---- validation
for (const [name, specs, n_, re] of [
  ["a question that does not exist", [{...EV, q: 4}], 4, /no such question/],
  ["the same question twice", [EV, {...EV}], 4, /already automatic/],
  ["a time limit under an hour", [{...EV, withinSeconds: 60}], 4, /1 hour to 90 days/],
  ["a time limit over 90 days", [{...EV, withinSeconds: 91 * DAY}], 4, /1 hour to 90 days/],
  ["a bad role", [{...EV, role: 2}], 4, /role/],
  ["a source that is not an address", [{...RD, target: "0x12"}], 4, /contract address/],
  ["a selector of the wrong length", [{...RD, selector: "0x1234"}], 4, /4-byte/],
  ["a negative threshold", [{...RD, threshold: -1}], 4, /whole number/],
  ["an unknown kind", [{kind: "magic", q: 0}], 4, /unknown kind/],
]) await ok("validate rejects " + name, () => assert.match(A.validate(specs, n_).join("|"), re));
await ok("validate accepts a good list, and compute refuses a bad one", () => {
  assert.deepEqual(A.validate([EV, RD], 4), []);
  assert.throws(() => A.compute([{...EV, q: 9}], base, 4), /no such question/);
});
console.log(n + " passed" + (process.exitCode ? ", some FAILED" : ""));
