// Agreement cards (docs/AGREEMENT-CARDS.md): two people each sign one deal with their passkey, off-chain, with no wallet and no fee. Nothing goes on X Layer
// unless there is a dispute; then anyone can record the card (AgreementRegistryV4.anchor) and the case starts.
//   #card/<card>   a card at any stage: waiting for the sender to sign, complete, or recorded. The card is plain data inside the link (public keys and signatures only).
//   #cards         the cards saved on this phone.
// The deal link (deal.js) carries the sender's passkey code. The other person signs first (they now know both keys); the sender signs second; either can then
// record the finished card. Static: no server. Signatures are checked in the browser before anything is trusted.
(function () {
  "use strict";
  const K = window.TB_PK, CFG = window.TB_CONFIG, main = document.querySelector("#main"), $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const ZERO = "0x" + "0".repeat(40), DAY = 86400, STORE = "lgtie.cards";
  const P = () => window.TB_PASSKEYS, D = () => window.TB_DEAL, W = () => window.TB_WALLET;
  const on = () => !!(CFG.v8 && CFG.v8.agreements && CFG.v8.agreements !== ZERO && P() && P().canCards && P().canCards());
  const hx = n => "0x" + BigInt(n).toString(16).padStart(64, "0");
  const b64 = o => K.b64u(K.utf8(JSON.stringify(o))), unb64 = s => JSON.parse(new TextDecoder().decode(K.unb64u(s)));
  const short = a => String(a).slice(0, 6) + "…" + String(a).slice(-4);
  const sha256 = async s => "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", typeof s === "string" ? new TextEncoder().encode(s) : s))].map(b => b.toString(16).padStart(2, "0")).join("");
  const when = sec => new Date(Number(sec) * 1000).toLocaleDateString([], {dateStyle: "medium"});
  const rpc = (m, p) => W().rpc(m, p);
  const enc = (n, t, v) => K.hex(K.call(n, t, v));

  // ---------- the card ----------
  // C = {v: 1, d: <deal link payload>, k: <the other person's passkey code>, t: {r, h, v, a, w, e, s}, sb, sa}: the deal; the other person's code; the terms
  // (rule set, terms fingerprint, reviewer, answer window, review window, last day, salt); the other person's signature (sb) and the sender's (sa).
  const keyOf = claim => { const c = P().parseClaim(claim); return {x: c.x, y: c.y, rpIdHash: String(c.rpIdHash).toLowerCase(), handleHash: String(c.handleHash).toLowerCase()}; };
  const termsTuple = t => ({ruleSetId: Number(t.r), termsHash: t.h, reviewer: t.v, answerWindow: Number(t.a), reviewWindow: Number(t.w), expiry: Number(t.e), salt: t.s});
  const dealOf = C => { const r = D().parseDeal(C.d); return r.deal || null; };
  const digestOf = C => { const d = dealOf(C); return K.hex(K.cardDigest({chainId: CFG.chainId, registry: CFG.v8.agreements, keyA: keyOf(d.k), keyB: keyOf(C.k), t: termsTuple(C.t)})); };
  async function termsFor(d) {
    const rule = D().ruleOf(d); if (!rule) throw new Error("These rules are not published on X Layer yet, so a signed card cannot use them.");
    const salt = K.hex(crypto.getRandomValues(new Uint8Array(32)));
    return {r: rule, h: await sha256(D().termsText(d)), v: d.v || ZERO, a: 7 * DAY, w: 7 * DAY, e: Math.floor(Date.now() / 1000) + 90 * DAY, s: salt};
  }
  /// The signer's passkey signs the digest (as the WebAuthn challenge). Returns plain data that anyone can verify.
  async function sign(info, digestHex) {
    const a = await navigator.credentials.get({publicKey: {challenge: K.unhex(digestHex), rpId: location.hostname, userVerification: "required", allowCredentials: info && info.credentialId ? [{type: "public-key", id: K.unb64u(info.credentialId)}] : []}});
    const t = K.assertionTuple(new Uint8Array(a.response.authenticatorData), new TextDecoder().decode(a.response.clientDataJSON), new Uint8Array(a.response.signature));
    return {ad: K.hex(t[0]), cd: t[1], r: hx(t[4]), s: hx(t[5])};
  }
  /// Checks a signature in the browser, the same things the contract checks: the challenge is this digest, it is for this key's site and user-verified, and it verifies.
  async function verify(sig, claim, digestHex) {
    try {
      const k = keyOf(claim), ad = K.unhex(sig.ad), cdj = JSON.parse(sig.cd);
      if (cdj.type !== "webauthn.get" || cdj.challenge !== K.b64u(K.unhex(digestHex))) return false;
      if (K.hex(ad.slice(0, 32)).toLowerCase() !== k.rpIdHash || !(ad[32] & 4)) return false;
      const raw = new Uint8Array(65); raw[0] = 4; raw.set(K.unhex(hx(k.x)), 1); raw.set(K.unhex(hx(k.y)), 33);
      const pub = await crypto.subtle.importKey("raw", raw, {name: "ECDSA", namedCurve: "P-256"}, false, ["verify"]);
      const rs = new Uint8Array(64); rs.set(K.unhex(sig.r), 0); rs.set(K.unhex(sig.s), 32);
      const msg = new Uint8Array(ad.length + 32); msg.set(ad); msg.set(K.unhex(await sha256(sig.cd)), ad.length);
      return await crypto.subtle.verify({name: "ECDSA", hash: "SHA-256"}, pub, rs, msg);
    } catch { return false; }
  }
  const assertionOf = sig => [K.unhex(sig.ad), sig.cd, sig.cd.indexOf('"type":"webauthn.get"'), sig.cd.indexOf('"challenge":"'), BigInt(sig.r), BigInt(sig.s)];
  const signerOf = (claim, sig) => { const k = keyOf(claim); return [[k.x, k.y, k.rpIdHash], k.handleHash, assertionOf(sig)]; };
  const anchorData = C => { const d = dealOf(C), t = termsTuple(C.t); return enc("anchor", [K.TERMS, K.SIGNER, K.SIGNER], [[t.ruleSetId, t.termsHash, t.reviewer, t.answerWindow, t.reviewWindow, t.expiry, t.salt], signerOf(d.k, C.sa), signerOf(C.k, C.sb)]); };

  // ---------- saved cards ----------
  const saved = () => { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; } };
  const keep = C => { try { const all = saved(); all[digestOf(C)] = C; localStorage.setItem(STORE, JSON.stringify(all)); } catch (e) {} };
  const link = C => location.href.split("#")[0] + "#card/" + b64(C);

  // ---------- starting and answering (used by the deal pages) ----------
  /// The sender's passkey code for a deal link: the passkey already on this phone, or a new one.
  async function senderClaim() { const my = P().myPasskey(); return (my && my.claim) ? my.claim : (await P().createPasskey("LGtie deal")).claim; }
  /// The other person agrees: make or reuse a passkey, sign the card, and return the link to send back.
  async function respond(d, payload, name) {
    const my = P().myPasskey(), info = (my && my.claim) ? my : await P().createPasskey(name || "LGtie deal");
    if (info.claim === d.k) throw new Error("This is your own deal link. Send it to the other person: they agree on their phone.");
    const C = {v: 1, d: payload, k: info.claim, t: await termsFor(d)};
    C.sb = await sign(info, digestOf(C)); keep(C);
    return {C, link: link(C), reused: !!(my && my.claim)};
  }

  // ---------- reading the chain ----------
  async function recorded(C) { try { const r = await rpc("eth_call", [{to: CFG.v8.agreements, data: enc("anchoredAs", ["bytes32"], [digestOf(C)])}, "latest"]); return Number(BigInt(r)); } catch { return null; } }

  // ---------- the card page ----------
  async function page(blob) {
    if (!on()) { main.innerHTML = `<h1>Agreement card</h1><div class="note">Agreement cards are not available yet.</div>`; return; }
    let C; try { C = unb64(blob); if (!C || C.v !== 1 || typeof C.d !== "string" || typeof C.k !== "string" || !C.t) throw 0; } catch { main.innerHTML = `<h1>Agreement card</h1><p class="err">This link is not a valid card.</p><p><a class="btn" href="#templates">See the templates</a></p>`; return; }
    const d = dealOf(C); if (!d || !d.k) { main.innerHTML = `<h1>Agreement card</h1><p class="err">This card is not valid.</p>`; return; }
    let digest; try { digest = digestOf(C); } catch (e) { main.innerHTML = `<h1>Agreement card</h1><p class="err">This card is damaged.</p>`; return; }
    main.innerHTML = `<h1>Agreement card</h1><p class="mute">Checking the signatures…</p>`;
    const [okB, okA] = await Promise.all([C.sb ? verify(C.sb, C.k, digest) : false, C.sa ? verify(C.sa, d.k, digest) : false]);
    const my = P().myPasskey(), isSender = !!(my && my.claim === d.k), isOther = !!(my && my.claim === C.k), complete = okA && okB, row = (l, v) => v ? `<tr><td>${l}</td><td>${esc(v)}</td></tr>` : "";
    const bad = (C.sb && !okB) || (C.sa && !okA);
    const fp = c => K.keccak(K.concat([K.u256(keyOf(c).x), K.u256(keyOf(c).y)])).slice(2, 14).replace(/(.{4})/g, "$1 ").trim();
    const id = complete ? await recorded(C) : null, expired = Math.floor(Date.now() / 1000) > Number(C.t.e);
    if (complete && (isSender || isOther)) keep(C);
    const deal = `<div class="card"><h3>The deal</h3><table class="small vt"><tbody>${row("From", d.a)}${row("With", d.b)}${row("About", d.w)}${row("Price", d.p)}${row("Date", d.d)}<tr><td>Rules</td><td>${esc(window.TB.templateInfo(d.t).title)} (rule set #${Number(C.t.r)})</td></tr>
        <tr><td>Reviewer</td><td>${C.t.v !== ZERO ? `<code>${esc(short(C.t.v))}</code>, named in advance` : "None yet: you agree on one together if a dispute starts"}</td></tr><tr><td>Valid until</td><td>${esc(when(C.t.e))}</td></tr></tbody></table></div>`;
    const who = `<div class="card"><h3>Who signed</h3><table class="small vt"><tbody><tr><td>${d.a ? esc(d.a) : "The sender"}</td><td>${okA ? `<span class="badge ok">Signed</span>` : `<span class="badge warn">Not yet</span>`} <span class="mute">passkey ${esc(fp(d.k))}</span>${isSender ? " (this phone)" : ""}</td></tr>
        <tr><td>${d.b ? esc(d.b) : "The other person"}</td><td>${okB ? `<span class="badge ok">Signed</span>` : `<span class="badge warn">Not yet</span>`} <span class="mute">passkey ${esc(fp(C.k))}</span>${isOther ? " (this phone)" : ""}</td></tr></tbody></table></div>`;
    let body = "";
    if (bad) body = `<div class="note err"><b>A signature on this card did not check out.</b> Do not rely on it. Ask the person to sign again.</div>`;
    else if (!okB) body = `<div class="note">This card has no signature from ${d.b ? esc(d.b) : "the other person"} yet.</div>`;
    else if (!okA) body = isSender
      ? `<div class="card"><h3>Your turn</h3><p class="small">${d.b ? esc(d.b) : "They"} signed. Check the deal above, then sign with your passkey on this phone. No wallet, no fee.</p><div class="row"><button class="btn" id="cd-sign" type="button">Sign with my passkey</button></div><p id="cd-msg" class="small"></p></div>`
      : `<div class="note">${d.b ? esc(d.b) : "They"} signed. This is now waiting for ${d.a ? esc(d.a) : "the sender"} to sign on their phone${my ? ". This phone's passkey is not the one named on the deal" : ""}.</div>`;
    else body = `<div class="note ok-note"><b>✓ Signed by both.</b> This card is a record that you both agreed to these terms. ${id ? `It is recorded on X Layer as <a href="#pk/agreement/${id}">agreement #${id}</a>.` : "Nothing is on X Layer yet, and nothing needs to be unless there is a dispute."}</div>
      ${id ? `<div class="card"><h3>Next</h3><p class="small">The agreement is in force. To start a dispute, open <a href="#mine">My cases</a> on your phone, tap <i>Find my cases with my passkey</i> and start it from the agreement.</p></div>`
        : `<div class="card"><h3>If something goes wrong</h3><p class="small">Record this card on X Layer so a case can start. Anyone can do it and pays the small network fee, so it can be you, the other person or a friend with a wallet. After that, whoever starts the dispute signs it with their passkey.</p>
          ${expired ? `<p class="err small">This card has expired and can no longer be recorded.</p>` : `<div class="row"><button class="btn" id="cd-rec" type="button">Record it on X Layer with my wallet</button><button class="btn ghost" id="cd-cp" type="button">Copy a link for someone with a wallet</button></div><p id="cd-msg" class="small"></p>`}</div>`}`;
    main.innerHTML = `<h1>Agreement card</h1><p class="lede">${d.a ? esc(d.a) : "Someone"} and ${d.b ? esc(d.b) : "the other person"} agreed the rules for ${d.w ? "<b>" + esc(d.w) + "</b>" : "a deal"} before any money moved.</p>${deal}${who}${body}
      <p class="small mute">Not a court, an arbitration or legal advice. It records what you both agreed to, and the published rules decide how a dispute is settled. <a href="#cards">Cards saved on this phone</a></p>`;
    if ($("#cd-sign")) $("#cd-sign").onclick = async () => {
      const m = $("#cd-msg"); $("#cd-sign").disabled = true; m.className = "small mute"; m.textContent = "Follow your device's prompt…";
      try {
        const C2 = {...C, sa: await sign(my, digest)}; if (!(await verify(C2.sa, d.k, digest))) throw new Error("That signature did not check out. Try again.");
        keep(C2); const l = link(C2), text = `Done: our agreement is signed. Tap to save your copy: ${l}`;
        main.innerHTML = `<h1>Agreement card</h1><div class="note ok-note"><b>✓ Signed by both.</b> Send ${C.k ? (d.b ? esc(d.b) : "them") : "them"} the finished card so they have a copy too.</div><textarea id="cd-msgbox" rows="3" readonly>${esc(text)}</textarea>${D().shareHtml("cd-share", text, l)}<p class="small"><a href="#card/${b64(C2)}">Open the finished card</a></p>`;
        D().bindShare("cd-share", text);
      } catch (e) { m.className = "small err"; m.textContent = (e && e.message) || String(e); $("#cd-sign").disabled = false; }
    };
    if ($("#cd-cp")) $("#cd-cp").onclick = e => { const t = link(C); navigator.clipboard.writeText(t).then(() => { e.target.textContent = "Copied"; }, () => prompt("Copy this:", t)); };
    if ($("#cd-rec")) $("#cd-rec").onclick = async () => {
      const m = $("#cd-msg"); $("#cd-rec").disabled = true; m.className = "small mute"; m.textContent = "Checking it would succeed…";
      try {
        const from = await W().connect(), data = anchorData(C);
        try { await rpc("eth_call", [{from, to: CFG.v8.agreements, data}, "latest"]); } catch (e) { throw new Error(friendly(e)); }
        m.textContent = "Confirm in your wallet…"; const rc = await W().send(CFG.v8.agreements, data);
        await page(blob); main.insertAdjacentHTML("afterbegin", `<div class="note ok-note">✓ Recorded. <a href="${CFG.explorer}/tx/${rc.transactionHash}" target="_blank" rel="noopener">${rc.transactionHash.slice(0, 12)}…</a></div>`);
      } catch (e) { m.className = "small err"; m.textContent = (e && e.message) || String(e); $("#cd-rec").disabled = false; }
    };
  }
  const friendly = e => { const m = String((e && e.message) || e); return /already recorded/.test(m) ? "This card is already recorded." : /expired/.test(m) ? "This card has expired." : /belongs to another key/.test(m) ? "One of the passkeys' handles was registered to a different key first, so this card cannot be recorded. Make new passkeys and a new card." : /signature is not valid/.test(m) ? "A signature on this card is not valid." : m; };

  // ---------- the saved cards ----------
  async function list() {
    if (!on()) { main.innerHTML = `<h1>My signed deals</h1><div class="note">Agreement cards are not available yet.</div>`; return; }
    const all = Object.values(saved()).filter(C => { try { digestOf(C); return !!(C.sa && C.sb); } catch { return false; } });
    main.innerHTML = `<h1>My signed deals</h1><p class="lede">Agreement cards saved on this phone. They stay here and are never uploaded. If you clear this browser's data, ask the other person to send the card again.</p><div id="cl">${all.length ? "" : `<p class="mute">None yet. A card appears here once you and the other person have both signed.</p>`}</div>`;
    for (const C of all.reverse()) { const d = dealOf(C); if (!d) continue; const id = await recorded(C); $("#cl").insertAdjacentHTML("beforeend", `<div class="card"><h3>${esc(d.w || window.TB.templateInfo(d.t).title)}</h3><p class="small">${d.a ? esc(d.a) + " and " : ""}${d.b ? esc(d.b) : "the other person"} · ${esc(window.TB.templateInfo(d.t).title)} · ${id ? `<span class="badge ok">Recorded as agreement #${id}</span>` : `<span class="badge">Not recorded (not needed unless there is a dispute)</span>`}</p><p><a class="btn small ghost" href="#card/${b64(C)}">Open</a></p></div>`); }
  }
  window.TB_CARDS = {on, page, list, senderClaim, respond, digestOf, verify, sign, anchorData, link, keep};
})();
