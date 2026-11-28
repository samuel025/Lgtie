// Core for passkey parties: keccak256, a small ABI encoder, and builders for the exact bytes a passkey must sign and the calldata a
// submitter sends. Pure functions, no network. Works in the browser (window.TB_PK) and in Node (module.exports) so it can be tested
// byte-for-byte against Foundry (`cast`). Everything the person's passkey signs is computed HERE, not asked of an RPC node.
(function () {
  "use strict";
  // ---------- keccak256 ----------
  const M = (1n << 64n) - 1n;
  const RC = [0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an, 0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n];
  const ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]];   // ROT[x][y]
  const rotl = (v, n) => n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & M;
  function keccakF(s) {
    for (let r = 0; r < 24; r++) {
      const C = new Array(5), B = new Array(25);
      for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
      for (let x = 0; x < 5; x++) { const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1); for (let y = 0; y < 5; y++) s[x + 5 * y] ^= D; }
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x][y]);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & M & B[((x + 2) % 5) + 5 * y]);
      s[0] ^= RC[r];
    }
  }
  function keccak256(input) {                       // input: Uint8Array -> Uint8Array(32)
    const rate = 136, padLen = rate - (input.length % rate), data = new Uint8Array(input.length + padLen);
    data.set(input); data[input.length] ^= 0x01; data[data.length - 1] ^= 0x80;
    const s = new Array(25).fill(0n);
    for (let off = 0; off < data.length; off += rate) {
      for (let i = 0; i < rate / 8; i++) { let lane = 0n; for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(data[off + i * 8 + b]); s[i] ^= lane; }
      keccakF(s);
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 4; i++) { let lane = s[i]; for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; } }
    return out;
  }

  // ---------- bytes helpers ----------
  const hex = u8 => "0x" + [...u8].map(b => b.toString(16).padStart(2, "0")).join("");
  const unhex = h => { h = h.replace(/^0x/, ""); if (h.length % 2) h = "0" + h; return Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16)); };
  const utf8 = s => new TextEncoder().encode(s);
  const concat = arrs => { const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0; arrs.forEach(a => { out.set(a, o); o += a.length; }); return out; };
  const u256 = v => { let n = BigInt(v); if (n < 0n || n >= (1n << 256n)) throw new Error("number out of range"); const out = new Uint8Array(32); for (let i = 31; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; };
  const k256 = u8 => keccak256(u8);
  const kHex = s => hex(keccak256(typeof s === "string" ? utf8(s) : s));

  // ---------- ABI encoding (the parts we use) ----------
  // A type is "uint256" | "uint64" | "uint8" | "uint32" | "bool" | "address" | "bytes32" | "bytes" | "string" | {tuple: [types]} | {array: type} (a dynamic list).
  const isTuple = t => typeof t === "object" && t !== null && Array.isArray(t.tuple);
  const isArr = t => typeof t === "object" && t !== null && t.array !== undefined;
  const isDyn = t => t === "bytes" || t === "string" || isArr(t) || (isTuple(t) && t.tuple.some(isDyn));
  const staticSize = t => isTuple(t) ? t.tuple.reduce((n, c) => n + staticSize(c), 0) : 32;
  function encStatic(t, v) {
    if (isTuple(t)) return concat(t.tuple.map((c, i) => encStatic(c, v[i])));
    if (t === "bool") return u256(v ? 1 : 0);
    if (t === "address") { const a = unhex(v); if (a.length !== 20) throw new Error("bad address"); return concat([new Uint8Array(12), a]); }
    if (t === "bytes32") { const b = unhex(v); if (b.length !== 32) throw new Error("bad bytes32"); return b; }
    if (/^uint\d+$/.test(t)) return u256(v);
    throw new Error("unsupported type " + t);
  }
  function encDyn(t, v) {
    if (t === "bytes" || t === "string") { const d = t === "string" ? utf8(v) : (typeof v === "string" ? unhex(v) : v), pad = (32 - d.length % 32) % 32; return concat([u256(d.length), d, new Uint8Array(pad)]); }
    if (isArr(t)) return concat([u256(v.length), encode(v.map(() => t.array), v)]);   // length, then the items (offsets are relative to the start of the items)
    return encode(t.tuple, v);   // a dynamic tuple is encoded like a list of its members
  }
  function encode(types, values) {
    const head = [], tail = []; let headSize = 0;
    types.forEach(t => { headSize += isDyn(t) ? 32 : staticSize(t); });
    let tailSize = 0;
    types.forEach((t, i) => {
      if (isDyn(t)) { head.push(u256(headSize + tailSize)); const d = encDyn(t, values[i]); tail.push(d); tailSize += d.length; }
      else head.push(encStatic(t, values[i]));
    });
    return concat([...head, ...tail]);
  }
  const typeStr = t => isArr(t) ? typeStr(t.array) + "[]" : isTuple(t) ? "(" + t.tuple.map(typeStr).join(",") + ")" : t;
  // calldata for a function: 4-byte selector from its canonical signature, then the encoded arguments
  const call = (name, types, values) => concat([keccak256(utf8(name + "(" + types.map(typeStr).join(",") + ")")).slice(0, 4), encode(types, values)]);

  // ---------- the contracts' types ----------
  const ASSERTION = {tuple: ["bytes", "string", "uint256", "uint256", "uint256", "uint256"]};     // authenticatorData, clientDataJSON, typeIndex, challengeIndex, r, s
  const SIGAUTH = {tuple: ["uint256", "uint256", "uint8", ASSERTION]};                            // nonce, deadline, keyIndex, assertion
  const KEY = {tuple: ["uint256", "uint256", "bytes32"]};                                         // x, y, rpIdHash
  const PARTY = {tuple: ["address", "uint256"]};                                                  // wallet, passkey account id

  // ---------- what a passkey signs ----------
  const DOMAIN = keccak256(utf8("LGtie.PasskeyRegistry.v1"));
  // keccak256(abi.encode("SUBMIT", id, asFiler, answers)) etc. A string literal is encoded as a dynamic `string`.
  const payload = {
    submit: (id, asFiler, answers) => keccak256(encode(["string", "uint256", "bool", "uint64"], ["SUBMIT", id, asFiler, answers])),
    evidence: (id, asFiler, question, hash, note) => keccak256(encode(["string", "uint256", "bool", "uint8", "bytes32", "bytes32"], ["EVIDENCE", id, asFiler, question, hash, hex(keccak256(utf8(note)))])),
    open: (agreementId, evidenceHash, asProposer) => keccak256(encode(["string", "uint256", "bytes32", "bool"], ["OPEN_CASE", agreementId, evidenceHash, asProposer])),
    // the agreement's terms digest is keccak256(abi.encode(proposer, counterparty, ruleSetId, termsHash, reviewer, answerWindow, reviewWindow))
    termsDigest: a => keccak256(encode([PARTY, PARTY, "uint256", "bytes32", "address", "uint32", "uint32"], [[a.proposerWallet, a.proposerPasskey], [a.counterpartyWallet, a.counterpartyPasskey], a.ruleSetId, a.termsHash, a.reviewer, a.answerWindow, a.reviewWindow])),
    // AgreementRegistryV3: a passkey proposes (every term is signed) or withdraws its own proposal
    propose: p => keccak256(encode(["string", "uint256", PARTY, "uint256", "bytes32", "address", "uint32", "uint32"], ["PROPOSE_AGREEMENT", p.proposerPasskey, [p.counterpartyWallet, p.counterpartyPasskey], p.ruleSetId, p.termsHash, p.reviewer, p.answerWindow, p.reviewWindow])),
    cancelAgreement: id => keccak256(encode(["string", "uint256"], ["CANCEL_AGREEMENT", id])),
    accept: (id, termsDigest) => keccak256(encode(["string", "uint256", "bytes32"], ["ACCEPT_AGREEMENT", id, hex(termsDigest)])),
    addKey: key => keccak256(encode(["string", "uint256", "uint256", "bytes32"], ["ADD_KEY", key.x, key.y, key.rpIdHash])),
    removeKey: index => keccak256(encode(["string", "uint8"], ["REMOVE_KEY", index]))
  };
  // keccak256(abi.encode(DOMAIN, chainid, registry, consumer, id, nonce, deadline, payloadHash)): the WebAuthn challenge
  const challenge = ({chainId, registry, consumer, accountId, nonce, deadline, payloadHash}) =>
    keccak256(encode(["bytes32", "uint256", "address", "address", "uint256", "uint256", "uint256", "bytes32"], [hex(DOMAIN), chainId, registry, consumer, accountId, nonce, deadline, hex(payloadHash)]));

  // ---------- base64url ----------
  const b64u = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

  // ---------- a WebAuthn assertion, in the shape the contract wants ----------
  // The DER signature becomes fixed r and s; the indexes say where `"type":"webauthn.get"` and `"challenge":"` sit in the client data.
  function derToRS(der) {
    const d = new Uint8Array(der); let i = 2; if (d[1] & 0x80) i += d[1] & 0x7f;
    const rl = d[i + 1], r = d.slice(i + 2, i + 2 + rl); i += 2 + rl; const sl = d[i + 1], s = d.slice(i + 2, i + 2 + sl);
    const big = v => { let n = 0n; v.forEach(b => { n = (n << 8n) | BigInt(b); }); return n; };
    return {r: big(r), s: big(s)};
  }
  function assertionTuple(authenticatorData, clientDataJSON, derSignature) {
    const {r, s} = derToRS(derSignature);
    return [authenticatorData, clientDataJSON, clientDataJSON.indexOf('"type":"webauthn.get"'), clientDataJSON.indexOf('"challenge":"'), r, s];
  }
  const sigAuthTuple = (nonce, deadline, keyIndex, assertion) => [nonce, deadline, keyIndex, assertion];

  const api = {keccak256, keccak: kHex, hex, unhex, utf8, concat, u256, encode, call, typeStr, ASSERTION, SIGAUTH, KEY, PARTY, DOMAIN, payload, challenge, b64u, unb64u, derToRS, assertionTuple, sigAuthTuple};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else window.TB_PK = api;
})();
