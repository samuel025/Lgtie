// Unit tests for site/reviewerid.js: wallet-signature recovery against a real signature (made with `cast wallet sign`), profile codes, the public-page check.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const R = createRequire(import.meta.url)("../site/reviewerid.js");
let n = 0; const ok = async (name, fn) => { try { await fn(); n++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + String(e.stack || e.message).split("\n").slice(0, 4).join("\n     ")); process.exitCode = 1; } };

// A real personal_sign signature, produced with foundry's `cast wallet sign` for the well-known test key whose address is 0x7099...79C8.
const ADDR = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const FIELDS = {name: "Amina Yusuf", role: "independent assessor", url: "https://github.com/amina-y", address: ADDR};
const SIG = "0x2b15b18526351168d2c51cb209a1cc3d36dd226830e61f86433bd2d75a09c8d27a5fb39768e8c3b5d08d36a3e4fb5ef6571bf5f9675a901026e67d4d72c6a8861b";
const profile = {...FIELDS, sig: SIG};

await ok("the signed statement is exactly the text that was signed", () => {
  assert.equal(R.statement(FIELDS), "LGTIE REVIEWER PROFILE\nName: Amina Yusuf\nRole: independent assessor\nPublic page: https://github.com/amina-y\nAddress: " + ADDR + "\nI am the person named above. I control this address and the public page.");
});
await ok("recover() returns the wallet that signed a real personal_sign signature", () => {
  assert.equal(R.recover(R.personalHash(R.statement(FIELDS)), SIG), ADDR);
});
await ok("a changed name, role, page or address makes the signature recover a different wallet", () => {
  for (const k of ["name", "role", "url", "address"]) assert.notEqual(R.recover(R.personalHash(R.statement({...FIELDS, [k]: FIELDS[k] + "x"})), SIG), ADDR, k);
});
await ok("recover() rejects malformed signatures instead of throwing", () => {
  assert.equal(R.recover(R.personalHash("x"), "0x1234"), null);
  assert.equal(R.recover(R.personalHash("x"), "0x" + "00".repeat(65)), null);
  assert.equal(R.recover(R.personalHash("x"), "0x" + "ff".repeat(65)), null);
});
await ok("v may be 0/1 or 27/28", () => {
  const alt = SIG.slice(0, -2) + (SIG.endsWith("1b") ? "00" : "01"); assert.equal(R.recover(R.personalHash(R.statement(FIELDS)), alt), ADDR);
});
await ok("a profile code round-trips and verifies", () => {
  const code = R.makeCode(profile), r = R.parse(code); assert.ok(code.startsWith("lgtie-reviewer1.")); assert.equal(r.ok, true); assert.deepEqual(r.profile, {...profile, specialty: "", fee: ""}); assert.equal(r.code, code);
});
await ok("a profile code with a swapped name, page or address is rejected", () => {
  for (const bad of [{...profile, name: "Someone Else"}, {...profile, url: "https://evil.example/x"}, {...profile, address: "0x" + "11".repeat(20)}, {...profile, sig: SIG.slice(0, -4) + "0000"}]) {
    const r = R.parse(R.makeCode(bad)); assert.equal(r.ok, false); }
});
await ok("garbage and wrong-prefix codes give a clear error, not an exception", () => {
  for (const c of ["", "hello", "lgtie-reviewer1.", "lgtie-reviewer1.!!!", "lgtie-reviewer1." + Buffer.from("{}").toString("base64url")]) assert.equal(R.parse(c).ok, false);
});
await ok("validate(): name, role and https page rules", () => {
  assert.equal(R.validate({name: "A", role: "", url: "https://x.org"}).ok, false);
  assert.equal(R.validate({name: "Amina", role: "", url: "http://x.org"}).ok, false);
  assert.equal(R.validate({name: "Amina", role: "", url: "javascript:alert(1)"}).ok, false);
  assert.equal(R.validate({name: "Amina", role: "x".repeat(101), url: "https://x.org"}).ok, false);
  assert.equal(R.validate({name: "  Amina   Y ", role: "", url: "https://x.org/a"}).name, "Amina Y");
});
await ok("termsLine() names the reviewer and carries a fingerprint of the signed profile", () => {
  const l = R.termsLine(profile); assert.match(l, /^Reviewer identity: Amina Yusuf, independent assessor, https:\/\/github\.com\/amina-y \(signed profile fingerprint 0x[0-9a-f]{16}\)$/);
  assert.notEqual(R.termsLine({...profile, role: "other"}), l);
});
// a profile that also states what the reviewer can judge and what they charge (a second real signature from `cast wallet sign`)
const SIG2 = "0xaab5004544607121e71e01fe406da4babfce46e9c8a1039b4f528ac8b352933d70871dd2a5196c56423604096a21cc9703b02cf8f225782a527458846b95c4fb1c";
const profile2 = {...FIELDS, specialty: "Used electronics", fee: "US$10 per disputed question", sig: SIG2};
await ok("specialty and fee are part of the signed statement, only when given", () => {
  assert.equal(R.statement({...FIELDS, specialty: "Used electronics", fee: "US$10 per disputed question"}), "LGTIE REVIEWER PROFILE\nName: Amina Yusuf\nRole: independent assessor\nSpecialty: Used electronics\nFee: US$10 per disputed question\nPublic page: https://github.com/amina-y\nAddress: " + ADDR + "\nI am the person named above. I control this address and the public page.");
  assert.equal(R.statement({...FIELDS, specialty: "  ", fee: ""}), R.statement(FIELDS));   // empty values leave the older statement unchanged
});
await ok("a real signature over a profile with specialty and fee recovers the wallet and verifies", () => {
  assert.equal(R.recover(R.personalHash(R.statement(profile2)), SIG2), ADDR);
  const r = R.parse(R.makeCode(profile2)); assert.equal(r.ok, true); assert.equal(r.profile.specialty, "Used electronics"); assert.equal(r.profile.fee, "US$10 per disputed question");
});
await ok("changing the specialty or the fee after signing breaks the profile", () => {
  for (const bad of [{...profile2, specialty: "Smart-contract security"}, {...profile2, fee: "Free"}, {...profile2, specialty: ""}, {...profile2, fee: ""}]) assert.equal(R.parse(R.makeCode(bad)).ok, false);
});
await ok("validate() limits the specialty and the fee", () => {
  assert.equal(R.validate({name: "Amina", url: "https://x.org", specialty: "x".repeat(61)}).ok, false);
  assert.equal(R.validate({name: "Amina", url: "https://x.org", fee: "x".repeat(61)}).ok, false);
  assert.equal(R.validate({name: "Amina", url: "https://x.org", specialty: "Rentals", fee: "Free"}).ok, true);
});
await ok("termsLine() includes the specialty and fee, and changes with them", () => {
  const l = R.termsLine(profile2); assert.match(l, /specialty Used electronics, fee US\$10 per disputed question, https:\/\/github\.com\/amina-y/);
  assert.notEqual(l, R.termsLine({...profile2, fee: "Free"}));
});
const page = body => async () => ({ok: true, text: async () => body});
await ok("checkPage(): verified when the page carries the code or the signature", async () => {
  assert.equal((await R.checkPage(profile, page("hello " + R.makeCode(profile) + " bye"))).status, "verified");
  assert.equal((await R.checkPage(profile, page("my wallet proof " + SIG))).status, "verified");
});
await ok("checkPage(): missing when the page does not carry it, unreadable when the browser cannot read it", async () => {
  assert.equal((await R.checkPage(profile, page("nothing here"))).status, "missing");
  assert.equal((await R.checkPage(profile, async () => { throw new TypeError("Failed to fetch"); })).status, "unreadable");
  assert.equal((await R.checkPage(profile, async () => ({ok: false, text: async () => ""}))).status, "unreadable");
  assert.equal((await R.checkPage({...profile, url: "http://x.org"}, page(""))).status, "unreadable");
});
console.log(`\n${n} passed`);
