// Checks site/pkcore.js against Foundry's `cast` byte for byte: keccak256, ABI encoding, function selectors, the payload hashes and the
// WebAuthn challenge a passkey signs. If this passes, the page signs exactly what the contracts will verify. Needs `cast` on the PATH.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url), K = require("../site/pkcore.js");
const cast = (...args) => execFileSync("cast", args, { encoding: "utf8" }).trim();
let n = 0; const ok = (name, fn) => { try { fn(); n++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + (e.message || e).toString().split("\n").slice(0, 4).join("\n     ")); process.exitCode = 1; } };

ok("keccak256 of the empty input", () => assert.equal(K.keccak(""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"));
ok("keccak256 matches cast for short, block-sized and multi-block inputs", () => {
  for (const len of [0, 1, 3, 31, 32, 135, 136, 137, 271, 272, 273, 1000]) {
    const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 7 + 3) & 255);
    assert.equal(K.keccak(bytes), cast("keccak", len ? K.hex(bytes) : "0x"), "length " + len);
  }
});
ok("ABI encoding of static and dynamic arguments matches cast", () => {
  const got = K.hex(K.encode(["string", "uint256", "bool", "uint64"], ["SUBMIT", 7, false, 0x3fn]));
  assert.equal(got, cast("abi-encode", "f(string,uint256,bool,uint64)", "SUBMIT", "7", "false", "63"));
  const got2 = K.hex(K.encode(["address", "bytes32", "bytes", "string"], ["0x00000000000000000000000000000000000000aa", "0x" + "11".repeat(32), "0xdeadbeef", "héllo"]));
  assert.equal(got2, cast("abi-encode", "f(address,bytes32,bytes,string)", "0x00000000000000000000000000000000000000aa", "0x" + "11".repeat(32), "0xdeadbeef", "héllo"));
});
ok("function selectors match cast", () => {
  const sig = "submitSigned(uint256,bool,uint64,(uint256,uint256,uint8,(bytes,string,uint256,uint256,uint256,uint256)))";
  const got = K.hex(K.call("submitSigned", ["uint256", "bool", "uint64", K.SIGAUTH], [1, false, 5, [0, 100, 0, [new Uint8Array(37), "{}", 1, 23, 5, 6]]])).slice(0, 10);
  assert.equal(got, cast("sig", sig));
});
ok("a full submitSigned calldata with a struct holding bytes and a string matches cast", () => {
  // cast's command-line tuple parser cannot take quotes inside an argument, so use a plain token; the encoding of a dynamic string does not depend on its content.
  const ad = "0x" + "ab".repeat(37), cdj = "clientdatajson-token-longer-than-thirty-two-bytes-to-cross-a-word";
  const got = K.hex(K.call("submitSigned", ["uint256", "bool", "uint64", K.SIGAUTH], [12, false, 0x7fn, [3, 1700000000, 1, [ad, cdj, 1, 23, 123456789n, 987654321n]]]));
  const want = cast("calldata", "submitSigned(uint256,bool,uint64,(uint256,uint256,uint8,(bytes,string,uint256,uint256,uint256,uint256)))", "12", "false", "127", `(3,1700000000,1,(${ad},${cdj},1,23,123456789,987654321))`);
  assert.equal(got, want);
});
ok("a calldata with a tuple of static members (create a passkey account) matches cast", () => {
  const got = K.hex(K.call("create", ["bytes32", K.KEY], ["0x" + "22".repeat(32), [11n, 12n, "0x" + "33".repeat(32)]]));
  assert.equal(got, cast("calldata", "create(bytes32,(uint256,uint256,bytes32))", "0x" + "22".repeat(32), `(11,12,0x${"33".repeat(32)})`));
});
ok("the payload hashes match keccak(abi.encode(...)) from cast", () => {
  const h = x => cast("keccak", x);
  assert.equal(K.hex(K.payload.submit(5, false, 63n)), h(cast("abi-encode", "f(string,uint256,bool,uint64)", "SUBMIT", "5", "false", "63")));
  const note = "photo", eh = "0x" + "44".repeat(32);
  assert.equal(K.hex(K.payload.evidence(5, true, 4, eh, note)), h(cast("abi-encode", "f(string,uint256,bool,uint8,bytes32,bytes32)", "EVIDENCE", "5", "true", "4", eh, cast("keccak", K.hex(K.utf8(note))))));
  assert.equal(K.hex(K.payload.open(9, eh, false)), h(cast("abi-encode", "f(string,uint256,bytes32,bool)", "OPEN_CASE", "9", eh, "false")));
  assert.equal(K.hex(K.payload.removeKey(2)), h(cast("abi-encode", "f(string,uint8)", "REMOVE_KEY", "2")));
  assert.equal(K.hex(K.payload.addKey({ x: 5n, y: 6n, rpIdHash: eh })), h(cast("abi-encode", "f(string,uint256,uint256,bytes32)", "ADD_KEY", "5", "6", eh)));
  assert.equal(K.hex(K.payload.accept(3, K.keccak256(K.utf8("terms")))), h(cast("abi-encode", "f(string,uint256,bytes32)", "ACCEPT_AGREEMENT", "3", K.keccak("terms"))));
});
ok("the terms digest of an agreement matches keccak(abi.encode(parties, terms...))", () => {
  const a = { proposerWallet: "0x00000000000000000000000000000000000000b1", proposerPasskey: 0, counterpartyWallet: "0x0000000000000000000000000000000000000000", counterpartyPasskey: 4, ruleSetId: 1, termsHash: "0x" + "55".repeat(32), reviewer: "0x00000000000000000000000000000000000000c3", answerWindow: 259200, reviewWindow: 172800 };
  const want = cast("keccak", cast("abi-encode", "f((address,uint256),(address,uint256),uint256,bytes32,address,uint32,uint32)", "(0x00000000000000000000000000000000000000b1,0)", "(0x0000000000000000000000000000000000000000,4)", "1", a.termsHash, a.reviewer, "259200", "172800"));
  assert.equal(K.hex(K.payload.termsDigest(a)), want);
});
ok("the WebAuthn challenge matches keccak(abi.encode(domain, chain, registry, consumer, ...))", () => {
  const p = { chainId: 196, registry: "0x00000000000000000000000000000000000000d1", consumer: "0x00000000000000000000000000000000000000e2", accountId: 3, nonce: 4, deadline: 1700003600, payloadHash: K.keccak256(K.utf8("x")) };
  const want = cast("keccak", cast("abi-encode", "f(bytes32,uint256,address,address,uint256,uint256,uint256,bytes32)", K.hex(K.DOMAIN), "196", p.registry, p.consumer, "3", "4", "1700003600", K.hex(p.payloadHash)));
  assert.equal(K.hex(K.challenge(p)), want);
});
ok("a DER signature becomes the right r and s", () => {
  const der = Uint8Array.from([0x30, 0x46, 0x02, 0x21, 0x00, ...Array(32).fill(0xaa), 0x02, 0x21, 0x00, ...Array(32).fill(0xbb)]);
  const { r, s } = K.derToRS(der);
  assert.equal(r, BigInt("0x" + "aa".repeat(32))); assert.equal(s, BigInt("0x" + "bb".repeat(32)));
});
ok("a dynamic list of tuples that hold bytes (the automatic-questions spec) encodes exactly as cast does", () => {
  const SPEC = {tuple: ["uint8", "uint8", "uint8", "uint8", "uint32", "uint64", "address", "uint8", "uint256", "bytes"]}, Z = "0x" + "00".repeat(20), TOK = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736";
  const mine = K.hex(K.call("set", ["uint256", {array: SPEC}], [3, [[1, 0, 0, 2, 1209600, 0, Z, 0, 0, "0x"], [3, 2, 0, 0, 0, 0, TOK, 1, 1000000, "0x70a08231000000000000000000000000000000000000000000000000000000000000dead"]]]));
  const theirs = cast("calldata", "set(uint256,(uint8,uint8,uint8,uint8,uint32,uint64,address,uint8,uint256,bytes)[])", "3", "[(1,0,0,2,1209600,0," + Z + ",0,0,0x),(3,2,0,0,0,0," + TOK + ",1,1000000,0x70a08231000000000000000000000000000000000000000000000000000000000000dead)]");
  assert.equal(mine, theirs);
  assert.equal(K.hex(K.call("set", ["uint256", {array: SPEC}], [1, []])), cast("calldata", "set(uint256,(uint8,uint8,uint8,uint8,uint32,uint64,address,uint8,uint256,bytes)[])", "1", "[]"));
});
console.log(process.exitCode ? "FAILED" : `all ${n} passed`);
