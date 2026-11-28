// Unit tests for site/directory.js: the statistics behind the reviewer directory (docs/REVIEWER-DIRECTORY.md). Pure functions, no network.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const D = createRequire(import.meta.url)("../site/directory.js");
let n = 0; const ok = async (name, fn) => { try { await fn(); n++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + String(e.stack || e.message).split("\n").slice(0, 4).join("\n     ")); process.exitCode = 1; } };
const R = "0x" + "aa".repeat(20), R2 = "0x" + "bb".repeat(20);
const c = (o = {}) => ({reviewer: R, status: 2, hadDispute: true, acked: false, parties: ["p1", "p2"], business: null, ...o});

await ok("a reviewer's work counts only where the sides disagreed", () => {
  const s = D.computeStats([c(), c({hadDispute: false}), c({hadDispute: false, status: 2})], R);
  assert.equal(s.named, 3); assert.equal(s.asked, 1); assert.equal(s.decided, 1);
});
await ok("decided, no decision in time and open are counted separately, with open cases from any stage", () => {
  const s = D.computeStats([c({status: 2}), c({status: 3}), c({status: 3}), c({status: 1}), c({status: 0, hadDispute: false})], R);
  assert.equal(s.decided, 1); assert.equal(s.missed, 2); assert.equal(s.active, 2);
});
await ok("other reviewers' cases are ignored, and addresses compare without regard to case", () => {
  assert.equal(D.computeStats([c({reviewer: R2}), c({reviewer: R.toUpperCase().replace("0X", "0x")})], R).named, 1);
  assert.equal(D.computeStats([], R).named, 0);
});
await ok("acknowledged counts only cases where the sides disagreed", () => {
  const s = D.computeStats([c({acked: true}), c({acked: false}), c({acked: true, hadDispute: false})], R); assert.equal(s.asked, 2); assert.equal(s.acked, 1);
});
await ok("percentages stay hidden until there are five different parties, then show with their denominators", () => {
  const few = D.computeStats([c({status: 2}), c({status: 2}), c({status: 3})], R); assert.equal(few.parties, 2); assert.equal(few.enough, false); assert.equal(few.deadlinePct, null); assert.equal(few.acceptPct, null);
  const many = D.computeStats(["a", "b", "c", "d", "e"].map((k, i) => c({parties: [k, "x" + i], status: i === 0 ? 3 : 2, acked: i < 2})), R);
  assert.equal(many.parties >= 5, true); assert.equal(many.enough, true); assert.equal(many.deadlinePct, 80); assert.equal(many.acceptPct, 40);
});
await ok("distinct parties are counted once however many cases they appear in", () => { assert.equal(D.computeStats([c({parties: ["a", "b"]}), c({parties: ["a", "b"]}), c({parties: ["a", "c"]})], R).parties, 3); });
await ok("business concentration: the share of the most frequent wallet party among the cases that have one", () => {
  const s = D.computeStats([c({business: "acme"}), c({business: "acme"}), c({business: "acme"}), c({business: "shop"}), c({business: null})], R);
  assert.equal(s.bizCases, 4); assert.equal(s.topCount, 3); assert.equal(s.topShare, 0.75); assert.equal(s.businesses, 2);
  assert.equal(D.computeStats([c()], R).topShare, 0);   // none known: no number to show
});
await ok("priorWith counts earlier cases where this reviewer was named and one of the given people was a party", () => {
  const cs = [c({parties: ["me", "x"]}), c({parties: ["y", "z"]}), c({parties: ["me", "q"], reviewer: R2})];
  assert.equal(D.priorWith(cs, R, ["me"]), 1); assert.equal(D.priorWith(cs, R, ["nobody"]), 0); assert.equal(D.priorWith(cs, R, []), 0); assert.equal(D.priorWith(cs, R2, ["me"]), 1);
});
await ok("a wallet-era case becomes the common shape: disputed is a big number, the decider is the business, no acknowledgement exists", () => {
  const w = D.fromWalletCase({reviewer: R, status: 2, disputed: 4n, filer: "0x" + "11".repeat(20), decider: "0x" + "22".repeat(20)});
  assert.equal(w.hadDispute, true); assert.equal(w.acked, false); assert.equal(w.business, "0x" + "22".repeat(20)); assert.deepEqual(w.parties, ["0x" + "11".repeat(20), "0x" + "22".repeat(20)]);
  assert.equal(D.fromWalletCase({reviewer: R, status: 2, disputed: 0n, filer: "0x" + "11".repeat(20), decider: "0x" + "22".repeat(20)}).hadDispute, false);
});
await ok("a passkey-era case: passkey parties get their own keys, and the business is the one wallet party when there is exactly one", () => {
  const W1 = "0x" + "33".repeat(20), Z = "0x" + "00".repeat(20);
  const a = D.fromPasskeyCase({reviewer: R, status: 1, disputed: 1n, reviewerAcked: true, filer: {wallet: Z, passkey: 7n}, decider: {wallet: W1, passkey: 0n}});
  assert.deepEqual(a.parties, ["pk:7", W1]); assert.equal(a.business, W1); assert.equal(a.acked, true);
  const both = D.fromPasskeyCase({reviewer: R, status: 1, disputed: 1n, filer: {wallet: Z, passkey: 7n}, decider: {wallet: Z, passkey: 8n}});
  assert.equal(both.business, null);   // two passkey people: no wallet party to name
});
await ok("partyKey tells a passkey account from a wallet and ignores an empty side", () => {
  assert.equal(D.partyKey({wallet: "0x" + "AB".repeat(20), passkey: 0n}), "0x" + "ab".repeat(20)); assert.equal(D.partyKey({wallet: "0x" + "00".repeat(20), passkey: 5n}), "pk:5"); assert.equal(D.partyKey({wallet: "0x" + "00".repeat(20), passkey: 0n}), null); assert.equal(D.partyKey(null), null);
});
console.log(process.exitCode ? "FAILED" : `all ${n} passed`);
