// Unit tests for site/reviewer.js: validation of the reviewer's reasons, the deterministic statement and its fingerprint, and blind-review labels.
import { createRequire } from "node:module";
import crypto from "node:crypto";
import assert from "node:assert/strict";
const R = createRequire(import.meta.url)("../site/reviewer.js");
let n = 0; const ok = async (name, fn) => { try { await fn(); n++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + String(e.message).split("\n").slice(0, 3).join("\n     ")); process.exitCode = 1; } };
const good = { oneLine: "Report shows impact damage", full: "The inspection report names impact damage around the casing. I could not verify who wrote the report.", coi: true };

await ok("good reasons pass and are tidied", () => { const v = R.validate({ ...good, oneLine: "  Report   shows impact damage  ", full: "a".repeat(45) + "\r\n" }); assert.equal(v.ok, true); assert.equal(v.oneLine, "Report shows impact damage"); assert.equal(v.full, "a".repeat(45)); });
await ok("a missing or short one-line reason is refused", () => { assert.equal(R.validate({ ...good, oneLine: "" }).ok, false); assert.equal(R.validate({ ...good, oneLine: "short" }).ok, false); });
await ok("a one-line reason over 60 bytes is refused, counting bytes not characters", () => {
  assert.equal(R.validate({ ...good, oneLine: "x".repeat(60) }).ok, true);
  assert.equal(R.validate({ ...good, oneLine: "x".repeat(61) }).ok, false);
  assert.equal(R.validate({ ...good, oneLine: "é".repeat(31) }).ok, false, "31 accented letters are 62 bytes");
  assert.equal(R.validate({ ...good, oneLine: "é".repeat(30) }).ok, true);
});
await ok("short or huge full reasons are refused", () => { assert.equal(R.validate({ ...good, full: "too short" }).ok, false); assert.equal(R.validate({ ...good, full: "y".repeat(R.LIMITS.fullMax + 1) }).ok, false); });
await ok("the conflict-of-interest declaration is required", () => { const v = R.validate({ ...good, coi: false }); assert.equal(v.ok, false); assert.match(v.error, /conflict of interest/); });

const input = { caseId: 7, reviewer: "0xABCDEF0000000000000000000000000000000001", decisions: [{ n: 5, text: "Is there no excluded cause?", yes: true }, { n: 6, text: "Is the product within its usage limit?", yes: false }], oneLine: "Report shows impact damage", full: "Line one.\nLine two.", date: "2026-11-24" };
await ok("the statement is deterministic and complete", () => {
  const a = R.build(input), b = R.build({ ...input });
  assert.equal(a, b);
  for (const s of ["LGTIE REVIEWER STATEMENT", "Case: #7", "Reviewer: 0xabcdef0000000000000000000000000000000001", "Written: 2026-11-24", " 5. Is there no excluded cause? -> Yes", " 6. Is the product within its usage limit? -> No", R.DECLARATION, "One-line reason (public): Report shows impact damage", "Line one.\nLine two."]) assert.ok(a.includes(s), s);
  assert.ok(a.endsWith("\n"));
});
await ok("the fingerprint is the SHA-256 of the exact statement bytes, and any edit changes it", async () => {
  const text = R.build(input), want = "0x" + crypto.createHash("sha256").update(text, "utf8").digest("hex");
  assert.equal(await R.sha256Hex(text), want);
  assert.notEqual(await R.sha256Hex(text.replace("Yes", "No")), want);
  assert.notEqual(await R.sha256Hex(text + " "), want);
});
await ok("blind review labels the sides and the reviewer, and never leaks an address", () => {
  const c = { filer: "0xAAA0000000000000000000000000000000000001", filerOp: "0x0000000000000000000000000000000000000000", decider: "0xBBB0000000000000000000000000000000000002", deciderOp: "0xCCC0000000000000000000000000000000000003", reviewer: "0xDDD0000000000000000000000000000000000004" };
  assert.equal(R.sideOf(c.filer.toLowerCase(), c), "Side A"); assert.equal(R.sideOf(c.decider, c), "Side B"); assert.equal(R.sideOf(c.deciderOp, c), "Side B");
  assert.equal(R.sideOf(c.reviewer, c), "Reviewer"); assert.equal(R.sideOf("0xEEE0000000000000000000000000000000000005", c), "Someone else");
  assert.equal(R.isReviewer(c.reviewer.toLowerCase(), c), true); assert.equal(R.isReviewer(c.filer, c), false); assert.equal(R.isReviewer(null, c), false);
});
await ok("only the reviewer's own evidence counts as reasons", () => {
  const c = { reviewer: "0xDDD0000000000000000000000000000000000004" };
  const ev = [{ by: "0xaaa0000000000000000000000000000000000001", note: "photo", hash: "0x1" }, { by: c.reviewer.toLowerCase(), note: "Report shows impact damage", hash: "0x2" }];
  assert.deepEqual(R.reasonsOf(ev, c), [{ note: "Report shows impact damage", hash: "0x2" }]); assert.deepEqual(R.reasonsOf([], c), []);
});

// ---- the evidence the reviewer examined ----
const E = (i, over) => ({ by: "0x" + String(i).repeat(40), passkey: 0, question: i % 3, at: 1790000000 + i * 60, hash: "0x" + String(i).repeat(64), note: "item " + i, ...over });
const evs = [E(1), E(2, { passkey: 7n, by: "0x" + "9".repeat(40) }), E(3, { question: 255 })];
const side = e => (e.by === "0x" + "1".repeat(40) ? "Side A" : e.passkey ? "Side B" : "Reviewer");
const withEv = async (entries, extra) => R.build({ ...input, evidence: { entries, digest: await R.evidenceDigest(entries), labelOf: side }, ...extra });

await ok("an entry line is number|submitter|passkey account|question|time|fingerprint|note", () => {
  assert.equal(R.entryLine(evs[0], 0), "1|0x" + "1".repeat(40) + "|0|1|1790000060|0x" + "1".repeat(64) + "|item 1");
  assert.match(R.entryLine(evs[1], 1), /^2\|0x9{40}\|7\|2\|/);
});
await ok("the digest is deterministic, and any change to any entry, its order or the list changes it", async () => {
  const d = await R.evidenceDigest(evs); assert.match(d, /^0x[0-9a-f]{64}$/); assert.equal(await R.evidenceDigest(evs), d);
  assert.equal(d, "0x" + crypto.createHash("sha256").update(evs.map(R.entryLine).join("\n"), "utf8").digest("hex"));
  for (const k of ["by", "passkey", "question", "at", "hash", "note"]) assert.notEqual(await R.evidenceDigest([evs[0], { ...evs[1], [k]: k === "passkey" ? 8n : k === "question" ? 5 : k === "at" ? 1 : "0x" + "e".repeat(40 + (k === "hash" ? 24 : 0)) }, evs[2]]), d, k);
  assert.notEqual(await R.evidenceDigest([evs[1], evs[0], evs[2]]), d, "order"); assert.notEqual(await R.evidenceDigest(evs.slice(0, 2)), d, "removal"); assert.notEqual(await R.evidenceDigest([...evs, E(4)]), d, "addition");
});
await ok("a statement without evidence is exactly as before (older statements stay valid)", () => assert.equal(R.build(input), R.build({ ...input, evidence: undefined })));
await ok("a statement with evidence lists every entry with a plain label, the question, fingerprint, time and note, and the digest", async () => {
  const t = await withEv(evs); assert.match(t, /Evidence examined: 3 entries recorded on this case when this statement was written \(entries 1 to 3, in on-chain order\):/);
  assert.match(t, / 1\. Side A · about question 2 · fingerprint 0x1{64} · 2026-.* UTC · note "item 1"/); assert.match(t, / 2\. Side B · about question 3 /); assert.match(t, / 3\. Reviewer · about the whole case /);
  assert.ok(t.includes("Evidence digest: " + await R.evidenceDigest(evs))); assert.match(t, /Entries added after this statement was written were not examined\./);
  assert.ok(t.indexOf("Evidence examined") < t.indexOf("Conflict-of-interest declaration"), "the section sits before the declaration"); assert.equal(t, await withEv(evs), "deterministic");
});
await ok("an empty case says so plainly", async () => { const t = await withEv([]); assert.match(t, /Evidence examined: none recorded when this statement was written\./); assert.ok(!/Evidence digest/.test(t)); });

const stmtOf = async (entries) => { const text = await withEv(entries), hash = await R.sha256Hex(text); return { text, hash, ownEntry: { by: "0x" + "4".repeat(40), passkey: 0, question: 255, at: 1790001000, hash, note: "Report shows impact damage" } }; };
await ok("checking a genuine statement against the chain: it matches, and nothing was added after it", async () => {
  const s = await stmtOf(evs), r = await R.checkStatement(s.text, [...evs, s.ownEntry], s.hash); assert.equal(r.status, "ok"); assert.equal(r.n, 3); assert.equal(r.missed, 0); assert.deepEqual(r.later, []);
});
await ok("evidence added after the statement is counted as not examined (the statement's own entry is not)", async () => {
  const s = await stmtOf(evs), r = await R.checkStatement(s.text, [...evs, s.ownEntry, E(5), E(6)], s.hash); assert.equal(r.status, "ok"); assert.equal(r.later.length, 2); assert.equal(r.missed, 0);
});
await ok("if an entry on the chain was swapped, changed, reordered or removed, the statement no longer matches", async () => {
  const s = await stmtOf(evs), own = s.ownEntry;
  for (const changed of [[E(1, { hash: "0x" + "f".repeat(64) }), evs[1], evs[2]], [evs[0], E(2, { note: "edited" }), evs[2]], [evs[1], evs[0], evs[2]], [evs[0], evs[1], E(3, { at: 5 })]]) {
    const r = await R.checkStatement(s.text, [...changed, own], s.hash); assert.equal(r.status, "mismatch"); assert.notEqual(r.expected, r.found); }
  assert.equal((await R.checkStatement(s.text, [evs[0], evs[1], own], s.hash)).status, "toomany");
});
await ok("a statement that lists fewer entries than existed before it was recorded is flagged (evidence left out)", async () => {
  const s = await stmtOf(evs.slice(0, 2)), r = await R.checkStatement(s.text, [...evs, s.ownEntry], s.hash);
  assert.equal(r.status, "ok"); assert.equal(r.n, 2); assert.equal(r.missed, 1, "entry 3 was recorded before the statement but is not in its list");
});
await ok("a statement cannot claim entries recorded after it", async () => {
  const s = await stmtOf(evs), r = await R.checkStatement(s.text, [evs[0], s.ownEntry, evs[1], evs[2]], s.hash); assert.equal(r.status, "toomany");
});
await ok("a statement that says no evidence existed is flagged when entries were recorded before it", async () => {
  const s = await stmtOf([]), r = await R.checkStatement(s.text, [evs[0], s.ownEntry], s.hash); assert.equal(r.status, "ok"); assert.equal(r.n, 0); assert.equal(r.missed, 1);
  const r2 = await R.checkStatement(s.text, [s.ownEntry], s.hash); assert.equal(r2.missed, 0);
});
await ok("an older statement with no evidence section is reported as such, not as a failure", async () => assert.equal((await R.checkStatement(R.build(input), evs, "0x1")).status, "none"));
await ok("text with a forged digest line is caught", async () => { const s = await stmtOf(evs), forged = s.text.replace(/Evidence digest: 0x[0-9a-f]{64}/, "Evidence digest: 0x" + "0".repeat(64)); assert.equal((await R.checkStatement(forged, [...evs, s.ownEntry], await R.sha256Hex(forged))).status, "mismatch"); });
await ok("the decision form says what the statement will cover", () => {
  const el = { textContent: "" }; R.evidenceNote(el, evs); assert.match(el.textContent, /list the 3 evidence entries recorded so far, with a digest anyone can check against X Layer\. Anything added after you record your reasons is not covered\./);
  R.evidenceNote(el, [evs[0]]); assert.match(el.textContent, /the 1 evidence entry recorded/); R.evidenceNote(el, []); assert.match(el.textContent, /No evidence has been recorded yet\./); R.evidenceNote(null, evs);
});
console.log(process.exitCode ? "FAILED" : `all ${n} passed`);
