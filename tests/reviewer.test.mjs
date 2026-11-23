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
console.log(process.exitCode ? "FAILED" : `all ${n} passed`);
