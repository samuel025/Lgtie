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
  const code = R.makeCode(profile), r = R.parse(code); assert.ok(code.startsWith("lgtie-reviewer1.")); assert.equal(r.ok, true); assert.deepEqual(r.profile, {...profile, specialty: "", fee: "", disclosure: "", regions: "", arrangements: "", avail: "", confirmed: "", max: "", response: "", listed: false}); assert.equal(r.code, code);
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
  assert.equal(R.validate({name: "Amina", url: "https://x.org", specialty: "x".repeat(121)}).ok, false);
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
// ---- the reviewer's disclosure of relationships (shown to whoever is asked to accept them) ----
const DIS = "Independent. No employment, financial or personal tie to either party.", SIG3 = "0x53e58b5cec1f199d76551a892f4df14f64bb4aa0f8c3b8d312c5c3e5cfba05231c6a498f749a31d1736143e647a064fd41fb4be8b13cdd35c28ba8c0c9ec61fb1c";
const profile3 = {...FIELDS, disclosure: DIS, sig: SIG3};
await ok("the disclosure is part of the signed statement, only when given (older profiles are unchanged)", () => {
  assert.ok(R.statement({...FIELDS, disclosure: DIS}).includes("\nDisclosure: " + DIS + "\nPublic page:"));
  assert.equal(R.statement({...FIELDS, disclosure: "  "}), R.statement(FIELDS));
});
await ok("a real signature over a profile with a disclosure recovers the wallet and verifies, and the disclosure survives the code", () => {
  assert.equal(R.recover(R.personalHash(R.statement(profile3)), SIG3), ADDR);
  const r = R.parse(R.makeCode(profile3)); assert.equal(r.ok, true); assert.equal(r.profile.disclosure, DIS);
});
await ok("changing the disclosure after signing breaks the profile (a reviewer cannot be shown with a different disclosure)", () => {
  const code = R.makeCode({...profile3, disclosure: "Employed by the business."});
  assert.equal(R.parse(code).ok, false);
});
await ok("the disclosure is in the terms line both sides fingerprint, and a profile with none has no such text", () => {
  assert.ok(R.termsLine(R.parse(R.makeCode(profile3)).profile).includes("disclosed relationships: " + DIS));
  assert.ok(!R.termsLine(R.parse(R.makeCode(profile)).profile).includes("disclosed relationships"));
});
await ok("a disclosure that is too long is refused", () => {
  assert.equal(R.validate({...FIELDS, disclosure: "x".repeat(201)}).ok, false);
});


// ---- directory fields (docs/REVIEWER-DIRECTORY.md): optional, signed, and backward compatible. Real signatures from `cast`.
import { execFileSync } from "node:child_process";
const TESTKEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";   // the well-known test key whose address is 0x7099...79C8
const signed = fields => { const text = R.statement({...fields, address: ADDR}); const sig = execFileSync("cast", ["wallet", "sign", "--private-key", TESTKEY, text], {encoding: "utf8"}).trim(); return {...fields, address: ADDR, sig}; };
const BASE = {name: "Amina Yusuf", role: "independent assessor", url: "https://github.com/amina-y", disclosure: "Independent: no tie to any business"};
const DIR = {...BASE, specialty: "Freelance work, software", fee: "20 USDT per case", regions: "West Africa", arrangements: "split,sponsored,volunteer", avail: "yes", confirmed: R.today(), max: "5", response: "within 24 hours", listed: true};
await ok("a profile with every directory field is signed, round-trips and verifies", () => {
  const p = signed(DIR), r = R.parse(R.makeCode(p)); assert.equal(r.ok, true, r.error); assert.equal(r.profile.listed, true); assert.equal(r.profile.arrangements, "split,sponsored,volunteer"); assert.equal(r.profile.max, "5"); assert.equal(r.profile.confirmed, R.today()); assert.equal(r.profile.response, "within 24 hours"); assert.equal(R.recover(R.personalHash(R.statement(r.profile)), r.profile.sig), ADDR);
});
await ok("the directory fields are part of the signed text, so changing any one breaks the signature", () => {
  const p = signed(DIR);
  for (const [k, v] of [["listed", false], ["max", "50"], ["avail", "no"], ["fee", "1 USDT per case"], ["regions", "Europe"], ["arrangements", "volunteer"], ["response", "instantly"], ["confirmed", "2020-01-01"]]) assert.equal(R.parse(R.makeCode({...p, [k]: v})).ok, false, k);
});
await ok("being listed is a signed choice: a relay or a stranger cannot list someone who did not opt in", () => {
  const unlisted = signed({...DIR, listed: false}); assert.equal(R.parse(R.makeCode(unlisted)).ok, true);
  assert.equal(R.parse(R.makeCode({...unlisted, listed: true})).ok, false);   // the same signature does not cover "listed"
});
await ok("a profile made before the directory fields existed still verifies, unlisted, with no availability", () => {
  const r = R.parse(R.makeCode({...FIELDS, sig: SIG})); assert.equal(r.ok, true); assert.equal(r.profile.listed, false); assert.equal(r.profile.avail, ""); assert.equal(r.profile.arrangements, "");
});
await ok("validate() checks the directory fields", () => {
  const v = o => R.validate({name: "Amina", url: "https://x.org", ...o});
  assert.equal(v({arrangements: "split,barter"}).ok, false); assert.equal(v({arrangements: "volunteer,split"}).arrangements, "split,volunteer");   // known values only, in a fixed order
  assert.equal(v({avail: "maybe", confirmed: R.today()}).ok, false); assert.equal(v({avail: "yes"}).ok, false);   // availability needs its date
  assert.equal(v({avail: "yes", confirmed: "2999-01-01"}).ok, false);   // not in the future
  assert.equal(v({max: "0"}).ok, false); assert.equal(v({max: "100"}).ok, false); assert.equal(v({max: "abc"}).ok, false); assert.equal(v({max: "5"}).ok, true);
  assert.equal(v({regions: "x".repeat(81)}).ok, false); assert.equal(v({response: "x".repeat(41)}).ok, false);
  assert.equal(v({listed: true}).ok, false);   // listing needs a disclosure
  assert.equal(v({listed: true, disclosure: "Independent"}).ok, true);
  assert.equal(v({avail: "no", confirmed: R.today()}).avail, "no");
});
await ok("an unset availability carries no date into the signed text", () => { assert.doesNotMatch(R.statement({...FIELDS, avail: "", confirmed: "2026-01-01"}), /Availability/); assert.match(R.statement({...FIELDS, avail: "yes", confirmed: "2026-01-01"}), /Availability: available \(confirmed 2026-01-01\)/); });
console.log(`\n${n} passed`);
