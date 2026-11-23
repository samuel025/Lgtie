// Unit tests for site/nostr.js: BIP-340 Schnorr against the official test vectors, plus event creation and verification.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const N = createRequire(import.meta.url)("../site/nostr.js");
let n = 0; const ok = async (name, fn) => { try { await fn(); n++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + String(e.stack || e.message).split("\n").slice(0, 4).join("\n     ")); process.exitCode = 1; } };
const h = s => N.unhex(s.toLowerCase());

await ok("BIP-340 vector 0: public key, exact signature, and it verifies", async () => {
  const sk = h("0000000000000000000000000000000000000000000000000000000000000003"), msg = new Uint8Array(32), aux = new Uint8Array(32);
  assert.equal(N.pubkeyOf(sk), "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9");
  const sig = await N.sign(msg, sk, aux);
  assert.equal(sig, "e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1ce2dca821525f66a4a85ea8b71e482a74f382d2ce5ebeee8fdb2172f477df4900d310536c0");
  assert.equal(await N.verify(msg, sig, N.pubkeyOf(sk)), true);
});
await ok("BIP-340 vector 1: exact signature", async () => {
  const sk = h("B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF"), msg = h("243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89"), aux = h("0000000000000000000000000000000000000000000000000000000000000001");
  assert.equal(N.pubkeyOf(sk), "dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659");
  assert.equal(await N.sign(msg, sk, aux), "6896bd60eeae296db48a229ff71dfe071bde413e6d43f917dc8dcf8c78de33418906d11ac976abccb20b091292bff4ea897efcb639ea871cfa95f6de339e4b0a");
});
await ok("BIP-340 vectors that must fail do fail (wrong message, wrong key, flipped signature)", async () => {
  const sk = h("0000000000000000000000000000000000000000000000000000000000000003"), msg = new Uint8Array(32), sig = await N.sign(msg, sk, new Uint8Array(32)), pk = N.pubkeyOf(sk);
  assert.equal(await N.verify(new Uint8Array(32).fill(1), sig, pk), false);
  assert.equal(await N.verify(msg, sig, "dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659"), false);
  assert.equal(await N.verify(msg, sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0"), pk), false);
  assert.equal(await N.verify(msg, "00".repeat(64), pk), false); assert.equal(await N.verify(msg, "zz", pk), false);
});
await ok("a new event is well formed, tagged for the business address, and verifies", async () => {
  const addr = "0xAbCdEf0000000000000000000000000000000001", ev = await N.makeEvent(addr, { v: 1, pack: "abc" });
  assert.equal(ev.kind, 30078); assert.ok(ev.tags.some(t => t[0] === "t" && t[1] === "lgtie-in-" + addr.toLowerCase())); assert.deepEqual(JSON.parse(ev.content), { v: 1, pack: "abc" });
  assert.match(ev.id, /^[0-9a-f]{64}$/); assert.match(ev.sig, /^[0-9a-f]{128}$/); assert.equal(await N.checkEvent(ev), true);
});
await ok("a tampered event is rejected", async () => {
  const ev = await N.makeEvent("0x0000000000000000000000000000000000000001", { v: 1, pack: "abc" });
  assert.equal(await N.checkEvent({ ...ev, content: JSON.stringify({ v: 1, pack: "evil" }) }), false);
  assert.equal(await N.checkEvent({ ...ev, tags: [["t", "lgtie-in-0x0000000000000000000000000000000000000002"]] }), false);
  assert.equal(await N.checkEvent({ ...ev, kind: 1 }), false); assert.equal(await N.checkEvent(null), false); assert.equal(await N.checkEvent({ ...ev, sig: "00".repeat(64) }), false);
});
await ok("each event uses a different one-off key", async () => { const a = await N.makeEvent("0x01", {}), b = await N.makeEvent("0x01", {}); assert.notEqual(a.pubkey, b.pubkey); });
console.log(process.exitCode ? "FAILED" : `all ${n} passed`);
