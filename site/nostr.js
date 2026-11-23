// A tiny Nostr client for the business inbox: no libraries, no server of ours.
// A customer's phone posts a signed passkey action to a few public relays, tagged with the business's wallet address. The business page
// asks the same relays for anything tagged with its address. Relays only carry the message: they cannot change a signed action (the contract
// rejects any change) and they cannot read anything that is not already public on-chain. They can drop messages, so the page also offers a copy-link fallback.
// BIP-340 Schnorr over secp256k1 (needed because relays reject unsigned events), with BigInt. Works in the browser (window.TB_NOSTR) and Node (module.exports).
(function () {
  "use strict";
  const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn, N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n, GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;
  const KIND = 30078, DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://relay.primal.net", "wss://offchain.pub", "wss://relay.snort.social", "wss://nos.lol"];
  const mod = (a, m = P) => ((a % m) + m) % m;
  function inv(a, m = P) { let [lo, hi, x0, x1] = [mod(a, m), m, 1n, 0n]; while (hi) { const q = lo / hi; [lo, hi, x0, x1] = [hi, lo - q * hi, x1, x0 - q * x1]; } return mod(x0, m); }
  const add = (a, b) => {
    if (!a) return b; if (!b) return a;
    if (a[0] === b[0]) { if (mod(a[1] + b[1]) === 0n) return null; const l = mod(3n * a[0] * a[0] * inv(2n * a[1])), x = mod(l * l - 2n * a[0]); return [x, mod(l * (a[0] - x) - a[1])]; }
    const l = mod((b[1] - a[1]) * inv(b[0] - a[0])), x = mod(l * l - a[0] - b[0]); return [x, mod(l * (a[0] - x) - a[1])];
  };
  const mul = (pt, k) => { let r = null, q = pt; for (k = mod(k, N); k > 0n; k >>= 1n) { if (k & 1n) r = add(r, q); q = add(q, q); } return r; };
  const G = [GX, GY];
  const be = (n, len = 32) => { const o = new Uint8Array(len); for (let i = len - 1; i >= 0; i--) { o[i] = Number(n & 255n); n >>= 8n; } return o; };
  const num = b => b.reduce((a, x) => (a << 8n) | BigInt(x), 0n);
  const hex = b => [...b].map(x => x.toString(16).padStart(2, "0")).join(""), unhex = h => Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));
  const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; a.forEach(x => { o.set(x, i); i += x.length; }); return o; };
  const sha256 = async b => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
  const utf8 = s => new TextEncoder().encode(s);
  const tagged = async (tag, ...parts) => { const t = await sha256(utf8(tag)); return sha256(cat(t, t, ...parts)); };
  const liftX = x => { if (x >= P) return null; const y2 = mod(x * x * x + 7n); let y = 1n, e = (P + 1n) / 4n, b = y2, r = 1n; for (; e > 0n; e >>= 1n) { if (e & 1n) r = mod(r * b); b = mod(b * b); } y = r; return mod(y * y) === y2 ? [x, y & 1n ? P - y : y] : null; };

  const pubkeyOf = sk => hex(be(mul(G, num(sk))[0]));
  async function sign(msg, sk, aux) {
    const d0 = num(sk); if (d0 <= 0n || d0 >= N) throw new Error("bad key");
    const Pt = mul(G, d0), d = Pt[1] & 1n ? N - d0 : d0, px = be(Pt[0]);
    const t = be(d ^ num(await tagged("BIP0340/aux", aux || crypto.getRandomValues(new Uint8Array(32)))));
    const k0 = num(await tagged("BIP0340/nonce", t, px, msg)) % N; if (k0 === 0n) throw new Error("bad nonce");
    const R = mul(G, k0), k = R[1] & 1n ? N - k0 : k0, rx = be(R[0]);
    const e = num(await tagged("BIP0340/challenge", rx, px, msg)) % N;
    return hex(cat(rx, be((k + e * d) % N)));
  }
  async function verify(msg, sigHex, pubHex) {
    try {
      const Pt = liftX(num(unhex(pubHex))), sig = unhex(sigHex); if (!Pt || sig.length !== 64) return false;
      const r = num(sig.slice(0, 32)), s = num(sig.slice(32)); if (r >= P || s >= N) return false;
      const e = num(await tagged("BIP0340/challenge", sig.slice(0, 32), be(Pt[0]), msg)) % N;
      const R = add(mul(G, s), mul([Pt[0], P - Pt[1]], e)); return !!R && !(R[1] & 1n) && R[0] === r;
    } catch (e) { return false; }
  }

  // ----- events -----
  const addrTag = addr => "lgtie-in-" + String(addr).toLowerCase();
  const idOf = async ev => hex(await sha256(utf8(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))));
  // A one-off key signs each message, so nobody's identity is tied to it.
  async function makeEvent(toAddress, payload) {
    const sk = crypto.getRandomValues(new Uint8Array(32)), content = JSON.stringify(payload);
    const ev = {pubkey: pubkeyOf(sk), created_at: Math.floor(Date.now() / 1000), kind: KIND, tags: [["d", hex(crypto.getRandomValues(new Uint8Array(8)))], ["t", "lgtie"], ["t", addrTag(toAddress)]], content};
    ev.id = await idOf(ev); ev.sig = await sign(unhex(ev.id), sk); return ev;
  }
  const checkEvent = async ev => !!ev && typeof ev.id === "string" && ev.kind === KIND && typeof ev.content === "string" && Array.isArray(ev.tags) && (await idOf(ev)) === ev.id && await verify(unhex(ev.id), ev.sig, ev.pubkey);

  // ----- relays -----
  const WS = () => (typeof WebSocket !== "undefined" ? WebSocket : null);
  function relaysConfigured() { try { const o = JSON.parse(localStorage.getItem("lgtie.inboxRelays") || "null"); if (Array.isArray(o) && o.length) return o; } catch (e) {} return (typeof window !== "undefined" && window.TB_CONFIG && window.TB_CONFIG.inboxRelays) || DEFAULT_RELAYS; }
  // Post an event to every relay; resolves with how many relays acknowledged it.
  function publish(relays, ev, ms = 6000) {
    return Promise.all(relays.map(url => new Promise(res => {
      let done = false, w; const fin = v => { if (!done) { done = true; try { w && w.close(); } catch (e) {} res(v); } }; const t = setTimeout(() => fin(false), ms);
      try { w = new (WS())(url); } catch (e) { clearTimeout(t); return fin(false); }
      w.onopen = () => w.send(JSON.stringify(["EVENT", ev])); w.onerror = () => { clearTimeout(t); fin(false); };
      w.onmessage = m => { try { const a = JSON.parse(m.data); if (a[0] === "OK" && a[1] === ev.id) { clearTimeout(t); fin(a[2] === true); } } catch (e) {} };
    }))).then(r => r.filter(Boolean).length);
  }
  // Ask every relay for matching events. onEvent gets each verified, de-duplicated event. Returns a function that stops listening.
  function listen(relays, filter, onEvent, onStatus) {
    const seen = new Set(), socks = []; let open = 0, closed = false;
    relays.forEach(url => {
      let w; try { w = new (WS())(url); } catch (e) { return; } socks.push(w);
      w.onopen = () => { open++; onStatus && onStatus({open, total: relays.length}); w.send(JSON.stringify(["REQ", "lgtie", filter])); };
      w.onerror = () => {}; w.onclose = () => { if (!closed) { open = Math.max(0, open - 1); onStatus && onStatus({open, total: relays.length}); } };
      w.onmessage = async m => { try { const a = JSON.parse(m.data); if (a[0] === "EVENT" && a[2] && !seen.has(a[2].id)) { seen.add(a[2].id); if (await checkEvent(a[2])) onEvent(a[2]); } } catch (e) {} };
    });
    return () => { closed = true; socks.forEach(w => { try { w.close(); } catch (e) {} }); };
  }
  const filterFor = (addr, sinceSec) => ({kinds: [KIND], "#t": [addrTag(addr)], since: sinceSec});

  const api = {KIND, DEFAULT_RELAYS, pubkeyOf, sign, verify, idOf, makeEvent, checkEvent, addrTag, publish, listen, filterFor, relaysConfigured, hex, unhex};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else window.TB_NOSTR = api;
})();
