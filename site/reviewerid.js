// Named reviewers. A reviewer used to appear only as a wallet address. This lets a reviewer attach a real, checkable identity, with no contract
// change and no server of ours:
//  1. The reviewer signs a short statement with their wallet (personal_sign): their name, role and the address of a public page they control.
//  2. The signature is checked in the browser by recovering the signer's address (secp256k1), so a profile cannot be forged for someone else's wallet.
//  3. The reviewer pastes the same signed "profile code" on their public page (a GitHub profile or gist, a company page). Anyone can fetch that page
//     and see that the person who controls the page also controls the wallet. Where the browser is not allowed to read a page, the site says so and
//     links to it, so the check can be done by eye.
//  4. The profile code is also posted to a few public relays (the same ones the inbox uses, under a different tag), so both sides can see the
//     name next to the address on the agreement, the case and the receipt. A relay can drop a profile but cannot change one: any change breaks the signature.
// What this does NOT prove: that the person is honest, qualified or free of conflicts. It proves the wallet and the public page share an owner.
// Pure functions are testable in Node (module.exports); the page helpers use the browser (window.TB_RID).
(function () {
  "use strict";
  const K = typeof module !== "undefined" && module.exports ? require("./pkcore.js") : window.TB_PK;
  const NOSTR = () => (typeof module !== "undefined" && module.exports ? require("./nostr.js") : window.TB_NOSTR);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const ADDR = /^0x[0-9a-fA-F]{40}$/, PREFIX = "lgtie-reviewer1.", LIM = {name: 80, role: 100, url: 200, specialty: 60, fee: 60};

  // ---------- secp256k1 public-key recovery (what ecrecover does), with BigInt ----------
  const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn, N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const G = [0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n, 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n];
  const mod = (a, m = P) => ((a % m) + m) % m;
  function inv(a, m = P) { let [lo, hi, x0, x1] = [mod(a, m), m, 1n, 0n]; while (hi) { const q = lo / hi; [lo, hi, x0, x1] = [hi, lo - q * hi, x1, x0 - q * x1]; } return mod(x0, m); }
  const add = (a, b) => {
    if (!a) return b; if (!b) return a;
    if (a[0] === b[0]) { if (mod(a[1] + b[1]) === 0n) return null; const l = mod(3n * a[0] * a[0] * inv(2n * a[1])), x = mod(l * l - 2n * a[0]); return [x, mod(l * (a[0] - x) - a[1])]; }
    const l = mod((b[1] - a[1]) * inv(b[0] - a[0])), x = mod(l * l - a[0] - b[0]); return [x, mod(l * (a[0] - x) - a[1])];
  };
  const mul = (pt, k) => { let r = null, q = pt; for (k = mod(k, N); k > 0n; k >>= 1n) { if (k & 1n) r = add(r, q); q = add(q, q); } return r; };
  const pow = (b, e, m) => { let r = 1n; b = mod(b, m); for (; e > 0n; e >>= 1n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; } return r; };
  const big = u8 => u8.reduce((a, x) => (a << 8n) | BigInt(x), 0n);
  const be32 = n => { const o = new Uint8Array(32); for (let i = 31; i >= 0; i--) { o[i] = Number(n & 255n); n >>= 8n; } return o; };
  const unhex = h => Uint8Array.from((String(h).replace(/^0x/, "").match(/../g) || []), x => parseInt(x, 16));
  const hexOf = u8 => [...u8].map(x => x.toString(16).padStart(2, "0")).join("");

  // The address that signed `hash32` (32 bytes) with a 65-byte signature r||s||v. Returns a lowercase 0x address, or null if the signature is not valid.
  function recover(hash32, sigHex) {
    try {
      const sig = unhex(sigHex); if (sig.length !== 65) return null;
      const r = big(sig.slice(0, 32)), s = big(sig.slice(32, 64)); let v = sig[64]; if (v >= 27) v -= 27; if (v > 1) return null;
      if (r <= 0n || r >= N || s <= 0n || s >= N) return null;
      const y2 = mod(r * r * r + 7n), y0 = pow(y2, (P + 1n) / 4n, P); if (mod(y0 * y0) !== y2) return null;
      const R = [r, Number(y0 & 1n) === v ? y0 : P - y0], e = big(hash32) % N;
      const Q = mul(add(mul(R, s), mul(G, N - e)), inv(r, N)); if (!Q) return null;
      return "0x" + hexOf(K.keccak256(K.concat([be32(Q[0]), be32(Q[1])])).slice(12));
    } catch (e) { return null; }
  }
  // What a wallet signs for personal_sign (EIP-191): keccak256("\x19Ethereum Signed Message:\n" + length + message).
  const personalHash = text => { const m = K.utf8(text); return K.keccak256(K.concat([K.utf8("\x19Ethereum Signed Message:\n" + m.length), m])); };

  // ---------- the profile ----------
  const clean = s => String(s || "").replace(/\s+/g, " ").trim();
  const urlOk = u => /^https:\/\/[^\s<>"']+$/i.test(u) && u.length <= LIM.url;
  // The exact text the reviewer's wallet signs. Deterministic: the same fields always give the same text.
  const statement = ({name, role, specialty, fee, url, address}) => ["LGTIE REVIEWER PROFILE", "Name: " + clean(name), "Role: " + clean(role), ...(clean(specialty) ? ["Specialty: " + clean(specialty)] : []), ...(clean(fee) ? ["Fee: " + clean(fee)] : []), "Public page: " + clean(url), "Address: " + String(address).toLowerCase(), "I am the person named above. I control this address and the public page."].join("\n");
  function validate({name, role, url, specialty, fee}) {
    name = clean(name); role = clean(role); url = clean(url); specialty = clean(specialty); fee = clean(fee);
    if (name.length < 2 || name.length > LIM.name) return {ok: false, error: "Enter your name (2 to " + LIM.name + " characters)."};
    if (role.length > LIM.role) return {ok: false, error: "Keep the role under " + LIM.role + " characters."};
    if (!urlOk(url)) return {ok: false, error: "Enter the address of a public page you control, starting with https:// (for example your GitHub profile or company page)."};
    if (specialty.length > LIM.specialty) return {ok: false, error: "Keep the specialty under " + LIM.specialty + " characters."};
    if (fee.length > LIM.fee) return {ok: false, error: "Keep the fee under " + LIM.fee + " characters."};
    return {ok: true, name, role, url, specialty, fee};
  }
  const b64u = s => btoa(String.fromCharCode(...K.utf8(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));
  const makeCode = p => PREFIX + b64u(JSON.stringify({n: p.name, r: p.role, ...(p.specialty ? {p: p.specialty} : {}), ...(p.fee ? {f: p.fee} : {}), u: p.url, a: p.address.toLowerCase(), s: p.sig}));
  // Read a profile code and check its signature. Returns {ok, profile} or {ok: false, error}.
  function parse(code) {
    try {
      code = clean(code); if (!code.startsWith(PREFIX)) return {ok: false, error: "That is not a reviewer profile code (it should start with " + PREFIX + ")."};
      const o = JSON.parse(unb64u(code.slice(PREFIX.length))), profile = {name: clean(o.n), role: clean(o.r), specialty: clean(o.p), fee: clean(o.f), url: clean(o.u), address: String(o.a).toLowerCase(), sig: String(o.s)};
      const v = validate(profile); if (!v.ok) return v; if (!ADDR.test(profile.address)) return {ok: false, error: "The profile has no valid address."};
      const signer = recover(personalHash(statement(profile)), profile.sig);
      if (!signer || signer !== profile.address) return {ok: false, error: "The signature does not match the address, so this profile is not genuine."};
      return {ok: true, profile, code: makeCode(profile)};
    } catch (e) { return {ok: false, error: "That profile code could not be read."}; }
  }
  // The line added to the written terms of an agreement, so the identity is part of what both sides fingerprinted.
  const termsLine = p => "Reviewer identity: " + p.name + (p.role ? ", " + p.role : "") + (p.specialty ? ", specialty " + p.specialty : "") + (p.fee ? ", fee " + p.fee : "") + ", " + p.url + " (signed profile fingerprint " + K.hex(K.keccak256(K.utf8(statement(p) + "\n" + p.sig))).slice(0, 18) + ")";

  // ---------- checking the public page ----------
  // Does the page the reviewer named really carry their signed profile? status: "verified" | "missing" | "unreadable".
  async function checkPage(profile, fetchFn, ms = 7000) {
    if (!urlOk(profile.url)) return {status: "unreadable", why: "The page address is not a plain https:// address."};
    const f = fetchFn || (typeof fetch !== "undefined" ? fetch : null); if (!f) return {status: "unreadable", why: "No network."};
    try {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null, t = ctl && setTimeout(() => ctl.abort(), ms);
      const res = await f(profile.url, {mode: "cors", credentials: "omit", signal: ctl && ctl.signal}); if (t) clearTimeout(t);
      if (!res.ok) return {status: "unreadable", why: "The page answered with an error."};
      const text = (await res.text()).slice(0, 2000000), code = makeCode(profile);
      return text.includes(code) || text.includes(profile.sig) ? {status: "verified"} : {status: "missing", why: "The page was read, but it does not contain the signed profile."};
    } catch (e) { return {status: "unreadable", why: "The browser is not allowed to read that page (most sites do not allow it), or it could not be reached."}; }
  }

  // ---------- relays: store and find a profile ----------
  const tagOf = addr => "lgtie-rid-" + String(addr).toLowerCase();
  async function publish(profile, relays) {
    const N_ = NOSTR(), sk = crypto.getRandomValues(new Uint8Array(32)), code = makeCode(profile);
    const ev = {pubkey: N_.pubkeyOf(sk), created_at: Math.floor(Date.now() / 1000), kind: N_.KIND, tags: [["d", "rid-" + profile.address], ["t", "lgtie"], ["t", tagOf(profile.address)]], content: JSON.stringify({code})};
    ev.id = await N_.idOf(ev); ev.sig = await N_.sign(N_.unhex(ev.id), sk);
    return N_.publish(relays || N_.relaysConfigured(), ev);
  }
  const mem = new Map();
  const localKey = a => "lgtie.rid." + String(a).toLowerCase();
  // Find the newest valid profile for an address. Looks at this device first, then asks the relays for a few seconds.
  function lookup(addr, {relays, ms = 3500, fresh = false} = {}) {
    const a = String(addr).toLowerCase(); if (!fresh && mem.has(a)) return mem.get(a);
    const p = new Promise(resolve => {
      let best = null, done = false, stop = null; const finish = () => { if (done) return; done = true; try { stop && stop(); } catch (e) {} resolve(best ? best.profile : null); };
      try { const c = localStorage.getItem(localKey(a)); const r = c && parse(c); if (r && r.ok && r.profile.address === a) best = {at: 0, profile: r.profile}; } catch (e) {}
      const N_ = NOSTR(); let t0 = Date.now();
      try {
        stop = N_.listen(relays || N_.relaysConfigured(), {kinds: [N_.KIND], "#t": [tagOf(a)], limit: 20}, ev => {
          try { const r = parse(JSON.parse(ev.content).code); if (r.ok && r.profile.address === a && (!best || ev.created_at > best.at)) { best = {at: ev.created_at, profile: r.profile}; setTimeout(finish, Math.max(300, 900 - (Date.now() - t0))); } } catch (e) {}
        });
      } catch (e) {}
      setTimeout(finish, ms);
    });
    mem.set(a, p); p.then(v => { if (!v) mem.delete(a); }); return p;
  }
  const remember = profile => { try { localStorage.setItem(localKey(profile.address), makeCode(profile)); } catch (e) {} mem.delete(profile.address); };

  // ---------- browser UI ----------
  const short = a => a.slice(0, 6) + "…" + a.slice(-4), link = u => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u.replace(/^https:\/\//, ""))}</a>`;
  const pageBadge = r => r.status === "verified" ? `<span class="badge ok">public page confirms it</span>` : r.status === "missing" ? `<span class="badge warn">page does not show the proof</span>` : `<span class="badge">page could not be read here</span>`;
  const nameHtml = p => `<b>${esc(p.name)}</b>${p.role ? ", " + esc(p.role) : ""}`;
  const extraHtml = p => (p.specialty ? `<span class="small">Specialty: ${esc(p.specialty)}</span> ` : "") + (p.fee ? `<span class="small">Fee: ${esc(p.fee)}</span>` : "");
  // Fill every <span data-rid="0x…"> on the page with the reviewer's name (or a note that only an address is known).
  async function decorate(root) {
    for (const el of root.querySelectorAll("[data-rid]")) {
      const addr = el.getAttribute("data-rid"); if (!ADDR.test(addr) || el.dataset.done) continue; el.dataset.done = "1";
      el.innerHTML = `<span class="small mute">looking for a signed identity…</span>`;
      lookup(addr).then(p => {
        if (!el.isConnected) return;
        el.innerHTML = p ? `${nameHtml(p)} <span class="badge ok">identity signed by this wallet</span> <span class="small">${link(p.url)}</span>${extraHtml(p) ? "<br>" + extraHtml(p) : ""}`
          : `<span class="badge warn">address only</span> <span class="small mute">no signed identity found. <a href="#reviewer/${addr}">Ask the reviewer to add one</a>.</span>`;
      });
    }
  }
  const field = (id, label, ph, extra = "") => `<label class="field"><span>${label}</span><input id="${id}" type="text" placeholder="${ph}" autocomplete="off" ${extra}></label>`;
  // The "who is this reviewer" card on #reviewer/<address>. If the connected wallet is this address, it also offers the setup.
  async function profileCard(el, addr) {
    addr = addr.toLowerCase();
    el.innerHTML = `<h3>Who is this reviewer?</h3><div id="rid-view"><p class="small mute">Looking for a signed identity…</p></div><div id="rid-setup"></div>`;
    const view = el.querySelector("#rid-view"), setup = el.querySelector("#rid-setup");
    async function show(p) {
      if (!p) { view.innerHTML = `<p><span class="badge warn">address only</span> No signed identity was found for <code>${addr}</code>. Anyone can be named reviewer by an address alone, so ask this person to add a profile before you accept them.</p>`; return; }
      view.innerHTML = `<p style="font-size:20px;margin:0 0 6px">${nameHtml(p)}</p><p class="small">Public page: ${link(p.url)} <span id="rid-pg" class="mute">checking…</span></p>
        ${p.specialty ? `<p class="small">Specialty: <b>${esc(p.specialty)}</b></p>` : ""}${p.fee ? `<p class="small">Fee: <b>${esc(p.fee)}</b>. <span class="mute">Agreed and paid directly between the parties and the reviewer. LGtie holds no money.</span></p>` : ""}
        <p class="small"><span class="badge ok">signed by this wallet</span> The name was signed with the wallet <code>${addr}</code>, and anyone can re-check that signature.</p>
        <details class="small"><summary>The signed profile code</summary><textarea readonly rows="3" style="width:100%">${esc(makeCode(p))}</textarea></details>
        <p class="small mute">This shows that whoever controls the wallet also controls the public page. It does not show that the person is honest or free of conflicts.</p>`;
      const r = await checkPage(p); const pg = view.querySelector("#rid-pg"); if (pg) pg.innerHTML = pageBadge(r) + (r.status === "unreadable" ? ` <span class="small mute">Open the page and look for the code above.</span>` : "");
    }
    show(await lookup(addr, {fresh: true}));
    setup.innerHTML = `<div class="row"><button class="btn small ghost" id="rid-me" type="button">This is my address: set up my profile</button><span id="rid-msg" class="small"></span></div>`;
    setup.querySelector("#rid-me").onclick = async () => {
      const msg = setup.querySelector("#rid-msg");
      try {
        msg.textContent = "Connect your wallet…"; const acct = await window.TB_WALLET.connect();
        if (acct.toLowerCase() !== addr) { msg.innerHTML = `<span class="err">The connected wallet is ${short(acct)}, not ${short(addr)}. Switch accounts in your wallet and try again.</span>`; return; }
        msg.textContent = "";
        setup.innerHTML = `<div class="note"><b>Sign a short statement with this wallet.</b> It costs nothing and sends no transaction.</div>
          ${field("rid-name", "Your name", "For example: Amina Yusuf", 'maxlength="80"')}${field("rid-role", "Role or organisation (optional)", "For example: independent warranty assessor", 'maxlength="100"')}${field("rid-spec", "What you can judge (optional)", "For example: used electronics, smart-contract security", 'maxlength="60"')}${field("rid-fee", "Your fee (optional)", "For example: US$10 per disputed question", 'maxlength="60"')}${field("rid-url", "A public page you control", "https://github.com/your-name", 'maxlength="200"')}
          <div class="row"><button class="btn small" id="rid-sign" type="button">Sign with my wallet</button><span id="rid-m2" class="small"></span></div><div id="rid-out"></div>`;
        setup.querySelector("#rid-sign").onclick = async () => {
          const m2 = setup.querySelector("#rid-m2"), v = validate({name: setup.querySelector("#rid-name").value, role: setup.querySelector("#rid-role").value, specialty: setup.querySelector("#rid-spec").value, fee: setup.querySelector("#rid-fee").value, url: setup.querySelector("#rid-url").value});
          if (!v.ok) { m2.innerHTML = `<span class="err">${esc(v.error)}</span>`; return; }
          try {
            m2.textContent = "Confirm the signature in your wallet…";
            const text = statement({...v, address: addr}), sig = await window.ethereum.request({method: "personal_sign", params: [K.hex(K.utf8(text)), addr]});
            const profile = {...v, address: addr, sig}, r = parse(makeCode(profile)); if (!r.ok) throw new Error(r.error);
            remember(r.profile); m2.textContent = "";
            setup.querySelector("#rid-out").innerHTML = `<div class="card"><h4>Your profile is signed</h4>
              <p class="small"><b>1.</b> Put this code on your public page (in your bio, or a note on the page), so anyone can see that the page and the wallet belong to the same person.</p>
              <textarea id="rid-code" readonly rows="3" style="width:100%">${esc(r.code)}</textarea>
              <div class="row"><button class="btn small ghost" id="rid-copy" type="button">Copy the code</button></div>
              <p class="small"><b>2.</b> Publish it so both sides can see your name next to your address.</p>
              <div class="row"><button class="btn small" id="rid-pub" type="button">Publish my profile</button><span id="rid-m3" class="small"></span></div>
              <p class="small"><b>3.</b> After you have put the code on your page, check it.</p>
              <div class="row"><button class="btn small ghost" id="rid-chk" type="button">Check my public page</button><span id="rid-m4" class="small"></span></div></div>`;
            const q = s => setup.querySelector(s);
            q("#rid-copy").onclick = async () => { try { await navigator.clipboard.writeText(r.code); q("#rid-copy").textContent = "Copied"; } catch (e) { q("#rid-code").select(); } };
            q("#rid-pub").onclick = async () => { q("#rid-m3").textContent = "Publishing…"; const n = await publish(r.profile).catch(() => 0); q("#rid-m3").innerHTML = n ? `<span class="ok">Published to ${n} relay${n === 1 ? "" : "s"}.</span>` : `<span class="err">No relay accepted it. Your profile is still kept on this device; try again later.</span>`; if (n) { mem.delete(addr); show(r.profile); } };
            q("#rid-chk").onclick = async () => { q("#rid-m4").textContent = "Reading your page…"; const c = await checkPage(r.profile); q("#rid-m4").innerHTML = pageBadge(c) + (c.why ? ` <span class="small mute">${esc(c.why)}</span>` : ""); };
          } catch (e) { m2.innerHTML = `<span class="err">${esc(e && e.message ? e.message : String(e))}</span>`; }
        };
      } catch (e) { msg.innerHTML = `<span class="err">${esc(e && e.message ? e.message : String(e))}</span>`; }
    };
  }
  // On the reviewer's own decision form: say plainly whether the people they are deciding for can see who they are.
  async function noteFor(el, addr) {
    if (!el || !ADDR.test(addr || "")) return; const p = await lookup(addr);
    el.innerHTML = p ? `<p class="small">Both sides see you as ${nameHtml(p)}, with the identity you signed.</p>` : `<p class="small"><span class="badge warn">address only</span> Both sides currently see only your wallet address. <a href="#reviewer/${addr}">Add a signed identity</a> so they know who decided.</p>`;
  }

  // Pages are drawn at different times; fill any [data-rid] span that appears.
  if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") { let t = 0; new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => decorate(document), 120); }).observe(document.documentElement, {childList: true, subtree: true}); }

  const api = {recover, personalHash, statement, validate, makeCode, parse, termsLine, checkPage, publish, lookup, remember, decorate, profileCard, noteFor, PREFIX, tagOf};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else window.TB_RID = api;
})();
