// Passkey parties: a customer with no wallet acts with a passkey (Face ID, fingerprint, PIN); anyone with a wallet relays the signed message.
// Pages: #join (create a passkey), #mine (find my agreements and cases, check I control the account, sign), #relay/<pack> (send a signed
// action), #pk/agree, #pk/agreement/<id>, #pk/case/<id> (the business and reviewer, using wallets). Static: no server. See docs/PASSKEYS.md.
(function () {
  "use strict";
  const K = window.TB_PK, CFG = window.TB_CONFIG, TB = window.TB, W = () => window.TB_WALLET, main = document.querySelector("#main"), $ = s => document.querySelector(s);
  const ZERO = "0x" + "0".repeat(40), DAY = 86400, STATUS = ["Waiting for answers", "Waiting for the reviewer", "Decided", "No decision (expired)"];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const short = a => a.slice(0, 6) + "…" + a.slice(-4), isAddr = a => /^0x[0-9a-fA-F]{40}$/.test(a), hexw = n => K.hex(K.u256(n));
  const V4 = () => CFG.v4 || {}, deployed = () => !!(V4().cases && V4().cases !== ZERO && V4().passkeys && V4().agreements);
  const copy = async (t, btn) => { try { await navigator.clipboard.writeText(t); const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => btn.textContent = o, 1400); } catch { prompt("Copy this:", t); } };
  const when = sec => new Date(Number(sec) * 1000).toLocaleString([], {dateStyle: "medium", timeStyle: "short"});
  const notDeployed = title => { main.innerHTML = `<h1>${title}</h1><div class="note">Passkey cases are built and tested but not deployed on X Layer yet, so this page has nothing to talk to.</div>`; };

  // ---------- chain reads ----------
  const enc = (name, types, vals) => K.hex(K.call(name, types, vals));
  const call = (to, data) => W().rpc("eth_call", [{to, data}, "latest"]);
  const words = h => { const x = h.replace(/^0x/, ""), out = []; for (let i = 0; i + 64 <= x.length; i += 64) out.push(BigInt("0x" + x.slice(i, i + 64))); return out; };
  const addrOf = n => "0x" + n.toString(16).padStart(40, "0");
  const readNonce = async id => words(await call(V4().passkeys, enc("nonceOf", ["uint256"], [id])))[0];
  const readAccountByHandle = async h => words(await call(V4().passkeys, enc("accountOfHandle", ["bytes32"], [h])))[0];
  const readKey = async (id, i) => { const w = words(await call(V4().passkeys, enc("keyAt", ["uint256", "uint256"], [id, i]))); return {x: w[0], y: w[1], rpIdHash: "0x" + w[2].toString(16).padStart(64, "0")}; };
  const readKeyCount = async id => Number(words(await call(V4().passkeys, enc("keyCount", ["uint256"], [id])))[0]);
  function decodeAgreement(h) { const w = words(h); return {proposer: {wallet: addrOf(w[0]), passkey: w[1]}, counterparty: {wallet: addrOf(w[2]), passkey: w[3]}, ruleSetId: Number(w[4]), termsHash: "0x" + w[5].toString(16).padStart(64, "0"), reviewer: addrOf(w[6]), answerWindow: Number(w[7]), reviewWindow: Number(w[8]), proposedAt: Number(w[9]), acceptedAt: Number(w[10]), cancelled: w[11] === 1n}; }
  function decodeCase(h) { const w = words(h); return {ruleSetId: Number(w[0]), filer: {wallet: addrOf(w[1]), passkey: w[2]}, decider: {wallet: addrOf(w[3]), passkey: w[4]}, reviewer: addrOf(w[5]), filerOp: addrOf(w[6]), deciderOp: addrOf(w[7]), evidenceHash: w[8], agreementId: Number(w[9]), openedAt: Number(w[10]), answerBy: Number(w[11]), reviewWindow: Number(w[12]), reviewBy: Number(w[13]),
    filerAnswers: w[14], deciderAnswers: w[15], filerIn: w[16] === 1n, deciderIn: w[17] === 1n, disputed: w[18], finalAnswers: w[19], result: Number(w[20]), filerOk: w[21] === 1n, deciderOk: w[22] === 1n, reviewerAcked: w[23] === 1n, status: Number(w[24])}; }
  const readEvidence = async id => {
    const n = Number(words(await call(V4().cases, enc("evidenceCount", ["uint256"], [id])))[0]), out = [];
    for (let i = 0; i < n; i++) {
      const x = (await call(V4().cases, enc("evidenceAt", ["uint256", "uint256"], [id, i]))).replace(/^0x/, ""), wd = k => BigInt("0x" + x.slice(k * 64, k * 64 + 64)), ts = Number(wd(0)) / 32;
      const base = ts * 64 + Number(wd(ts + 5)) * 2, len = Number(BigInt("0x" + x.slice(base, base + 64))), note = new TextDecoder().decode(Uint8Array.from(x.slice(base + 64, base + 64 + len * 2).match(/../g) || [], b => parseInt(b, 16)));
      out.push({by: addrOf(wd(ts)), passkey: wd(ts + 1), question: Number(wd(ts + 2)), at: Number(wd(ts + 3)), hash: "0x" + wd(ts + 4).toString(16).padStart(64, "0"), note});
    }
    return out;
  };
  let namesFor2 = 0;
  const readAgreement = async id => decodeAgreement(await call(V4().agreements, enc("get", ["uint256"], [id])));
  const readCase = async id => decodeCase(await call(V4().cases, enc("get", ["uint256"], [id])));
  const count = async to => Number(words(await call(to, enc("count", [], [])))[0]);
  async function scan(to, reader, limit = 200) { const n = await count(to), out = [], lo = Math.max(1, n - limit + 1); for (let i = n; i >= lo; i -= 10) { const ids = []; for (let k = i; k > i - 10 && k >= lo; k--) ids.push(k); (await Promise.all(ids.map(id => reader(id).then(v => ({id, ...v}), () => null)))).forEach(v => v && out.push(v)); } return out; }
  const policyOf = ruleSetId => { const key = Object.keys(CFG.published).find(k => CFG.published[k].ruleSetId === Number(ruleSetId)); return key ? TB.parse(TB.TEMPLATES[key]).policy : null; };
  const bits = (m, n) => Array.from({length: n}, (_, k) => ((BigInt(m) >> BigInt(k)) & 1n) === 1n);
  const sha256 = async u8 => new Uint8Array(await crypto.subtle.digest("SHA-256", u8));
  const hashText = async t => K.hex(await sha256(K.utf8(t)));

  // ---------- the passkey itself ----------
  const STORE = "lgtie.passkey";
  const mine = () => { try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch { return null; } };
  const remember = o => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch {} };
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const pad32 = v => "0x" + BigInt(v).toString(16).padStart(64, "0");
  async function createPasskey(label) {
    if (!window.PublicKeyCredential) throw new Error("This browser does not support passkeys.");
    const handle = rand(32), rpId = location.hostname;
    const cred = await navigator.credentials.create({publicKey: {rp: {name: "LGtie", id: rpId}, user: {id: handle, name: label || "LGtie claimant", displayName: label || "LGtie claimant"}, challenge: rand(32), pubKeyCredParams: [{type: "public-key", alg: -7}],
      authenticatorSelection: {residentKey: "required", userVerification: "required"}, attestation: "none"}});
    const spki = new Uint8Array(cred.response.getPublicKey()), xy = spki.slice(spki.length - 64);
    const info = {credentialId: K.b64u(new Uint8Array(cred.rawId)), x: K.hex(xy.slice(0, 32)), y: K.hex(xy.slice(32)), rpIdHash: K.hex(await sha256(K.utf8(rpId))), handleHash: K.keccak(handle), rpId};
    info.claim = "lgtie1." + K.b64u(K.utf8(JSON.stringify({x: info.x, y: info.y, rp: info.rpIdHash, h: info.handleHash, id: rpId})));
    remember(info); return info;
  }
  function parseClaim(code) {
    const m = /^lgtie1\.([A-Za-z0-9_-]+)$/.exec((code || "").trim()); if (!m) throw new Error("That is not a claim code. It starts with lgtie1.");
    let o; try { o = JSON.parse(new TextDecoder().decode(K.unb64u(m[1]))); } catch { throw new Error("That claim code is damaged."); }
    const h32 = v => /^0x[0-9a-f]{64}$/.test(v); if (!h32(o.x) || !h32(o.y) || !h32(o.rp) || !h32(o.h)) throw new Error("That claim code is incomplete.");
    return {x: BigInt(o.x), y: BigInt(o.y), rpIdHash: o.rp, handleHash: o.h, rpId: o.id || ""};
  }
  const fingerprint = c => K.keccak(K.concat([K.u256(c.x), K.u256(c.y)])).slice(2, 14).replace(/(.{4})/g, "$1 ").trim();

  // ---------- signing and relaying ----------
  // Sign one action: fetch the account's current nonce, build the challenge locally, ask the passkey, check on-chain that this passkey controls the account.
  // A signed action must be submitted in order (the contract requires the exact next number). If the customer signs a second action before the first
  // has been submitted, give it the following number and remember that locally. A remembered number is forgotten after a day (the deadline), or once the chain catches up.
  let lastSigned = null, chainNonceSeen = 0n;
  const nonceKey = id => "lgtie.nonce." + CFG.chainId + "." + id;
  async function nextNonce(id) {
    const chain = await readNonce(id); chainNonceSeen = chain; let q = null; try { q = JSON.parse(localStorage.getItem(nonceKey(id)) || "null"); } catch (e) {}
    return q && BigInt(q.next) > chain && Date.now() / 1000 - q.at < DAY ? BigInt(q.next) : chain;
  }
  const saveNonce = (id, nonce) => { try { localStorage.setItem(nonceKey(id), JSON.stringify({next: Number(nonce) + 1, at: Math.floor(Date.now() / 1000)})); } catch (e) {} };
  async function signAction({accountId, consumer, payloadHash, credentialId}) {
    const nonce = await nextNonce(accountId), head = await W().rpc("eth_getBlockByNumber", ["latest", false]), deadline = BigInt(Number(BigInt(head.timestamp)) + DAY);   // the chain's clock, not the browser's
    const ch = K.challenge({chainId: CFG.chainId, registry: V4().passkeys, consumer, accountId, nonce, deadline, payloadHash});
    const a = await navigator.credentials.get({publicKey: {challenge: ch, rpId: location.hostname, userVerification: "required", allowCredentials: credentialId ? [{type: "public-key", id: K.unb64u(credentialId)}] : []}});
    const assertion = K.assertionTuple(new Uint8Array(a.response.authenticatorData), new TextDecoder().decode(a.response.clientDataJSON), new Uint8Array(a.response.signature));
    const r = words(await call(V4().passkeys, enc("isControlledBy", ["uint256", "bytes32", K.ASSERTION], [accountId, K.hex(ch), assertion])));
    if (r[0] !== 1n) throw new Error("This passkey does not control that account, so nothing was signed for it.");
    saveNonce(accountId, nonce); lastSigned = {nonce: Number(nonce), acct: Number(accountId), queued: nonce > chainNonceSeen};
    return K.sigAuthTuple(nonce, deadline, Number(r[1]), assertion);
  }
  const packOf = (to, data, summary) => K.b64u(K.utf8(JSON.stringify({v: 1, to, data, summary, chainId: CFG.chainId, ...(lastSigned ? {n: lastSigned.nonce, a: lastSigned.acct} : {})})));
  const isRealAddr = a => isAddr(a) && !/^0x0+$/.test(a);
  // After signing, drop the signed action in the other side's inbox (public relays). The copy-link fallback stays, because relays can drop messages.
  function packBox(to, data, summary, target) {
    const pack = packOf(to, data, summary), link = location.href.split("#")[0] + "#relay/" + pack, canPost = isRealAddr(target) && window.TB_NOSTR;
    if (canPost) setTimeout(() => deliver(target, pack), 0);
    const queued = lastSigned && lastSigned.queued;
    return `<div class="note ok-note" id="packbox"><b>Signed.</b> ${esc(summary)}<br>${queued ? `<span class="small">This is queued behind something you signed earlier that has not been submitted yet. They are submitted in order.</span><br>` : ""}
      ${canPost ? `<span class="small" id="inboxst">Sending it to the other side's inbox…</span><br><span class="small mute">They see it when they open their inbox and submit it for you. It only does what you just approved, and it expires in 24 hours.</span>` : `<span class="small">Send this link to the person who will submit it (the business, or anyone with a wallet). It only does what you just approved, and it expires in 24 hours.</span>`}
      <div class="row"><button class="btn small ${canPost ? "ghost" : ""}" id="cplink" type="button" data-link="${esc(link)}">${canPost ? "Or copy the link and send it yourself" : "Copy the link"}</button></div><details><summary class="small">Show the signed action</summary><pre id="packtxt">${esc(link)}</pre></details></div>`;
  }
  async function deliver(target, pack) {
    const st = () => document.querySelector("#inboxst"); let n = 0;
    try { const N = window.TB_NOSTR, rel = N.relaysConfigured(), ev = await N.makeEvent(target, {v: 1, pack}); n = await N.publish(rel, ev); } catch (e) { n = 0; }
    const el = st(); if (!el) return;
    if (n > 0) { el.className = "small ok"; el.textContent = `✓ Sent to the other side's inbox (${n} relay${n > 1 ? "s" : ""}).`; }
    else { el.className = "small err"; el.textContent = "Could not reach the inbox relays. Copy the link below and send it yourself."; }
  }

  // ---------- #join: create a passkey ----------
  function join() {
    if (!deployed()) { notDeployed("Get a passkey"); return; }
    const have = mine();
    main.innerHTML = `<h1>Use your fingerprint or face instead of a wallet</h1>
      <p class="lede">Create a passkey in a few seconds. You will not need a wallet, a seed phrase or any crypto. Then give your claim code to the business that invited you. It identifies your passkey and contains nothing secret.</p>
      <div class="card"><div class="row"><button class="btn" id="mk" type="button">Create my passkey</button><span id="jm" class="small"></span></div>
        <div id="out">${have ? claimView(have, true) : ""}</div></div>
      <div class="note">Your passkey stays on your device (and in your phone's or browser's password manager, if you use one). If you lose every device with it, you could lose access to your cases, so add a second device when you can. This page and its contracts are an unaudited prototype.</div>`;
    $("#mk").onclick = async () => {
      const m = $("#jm"); m.className = "small mute"; m.textContent = "Follow your device's prompt…";
      try { const info = await createPasskey("LGtie claimant"); $("#out").innerHTML = claimView(info, false); bindClaim(info); m.textContent = ""; if (window.parent !== window) window.parent.postMessage({lgtie: "passkey-claim", claim: info.claim}, "*"); }
      catch (e) { m.className = "small err"; m.textContent = (e && e.message) || String(e); }
    };
    if (have) bindClaim(have);
  }
  const claimView = (c, existing) => `<p>${existing ? "A passkey already exists on this device." : "<b>Your passkey is ready.</b>"} Give this claim code to the business:</p><textarea id="claim" rows="3" readonly class="mono" style="min-height:70px">${esc(c.claim)}</textarea>
    <div class="row"><button class="btn small" id="cpclaim" type="button">Copy claim code</button><span class="small mute">Read-back code for a phone or chat check: <b>${esc(fingerprint({x: BigInt(c.x), y: BigInt(c.y)}))}</b></span></div>
    <p class="small mute">Next: once the business adds you, open <a href="#mine">My cases</a> to see and act on them.</p>`;
  const bindClaim = c => { const b = $("#cpclaim"); if (b) b.onclick = e => copy(c.claim, e.target); };

  // ---------- #mine: find my agreements and cases, and sign ----------
  async function mineView() {
    if (!deployed()) { notDeployed("My cases"); return; }
    main.innerHTML = `<h1>My cases</h1><p class="lede">Use your passkey to find the agreements and cases that name you, and to answer or accept. Nothing is sent from here: you sign, and the business (or anyone with a wallet) submits.</p>
      <div class="card"><div class="row"><button class="btn" id="find" type="button">Find my cases with my passkey</button><a class="btn ghost" href="#join">I need a passkey first</a><span id="fm" class="small"></span></div></div><div id="list"></div>`;
    $("#find").onclick = async () => {
      const m = $("#fm"); m.className = "small mute"; m.textContent = "Follow your device's prompt…";
      try {
        const ch = rand(32), a = await navigator.credentials.get({publicKey: {challenge: ch, rpId: location.hostname, userVerification: "required", allowCredentials: []}});   // discoverable: the device offers its passkeys
        const handle = new Uint8Array(a.response.userHandle || []); if (!handle.length) throw new Error("This passkey carries no account handle.");
        const accountId = Number(await readAccountByHandle(K.keccak(handle)));
        if (!accountId) { m.textContent = ""; $("#list").innerHTML = `<div class="note">No account is registered for this passkey yet. Give the business your claim code from <a href="#join">Get a passkey</a>.</div>`; return; }
        const assertion = K.assertionTuple(new Uint8Array(a.response.authenticatorData), new TextDecoder().decode(a.response.clientDataJSON), new Uint8Array(a.response.signature));
        const r = words(await call(V4().passkeys, enc("isControlledBy", ["uint256", "bytes32", K.ASSERTION], [accountId, K.hex(ch), assertion])));
        if (r[0] !== 1n) { m.textContent = ""; $("#list").innerHTML = `<div class="note"><b>Do not use this account.</b> An account was registered under your handle, but your passkey does not control it. Contact the business and ask them to add your claim code again.</div>`; return; }
        m.className = "small ok"; m.textContent = `✓ Account #${accountId} is controlled by your passkey.`;
        const credentialId = K.b64u(new Uint8Array(a.rawId)); await renderMine(accountId, credentialId);
      } catch (e) { m.className = "small err"; m.textContent = (e && e.message) || String(e); }
    };
  }
  async function renderMine(accountId, credentialId) {
    const list = $("#list"); list.innerHTML = `<p class="mute">Reading from X Layer…</p>`;
    const [ags, cases] = await Promise.all([scan(V4().agreements, readAgreement), scan(V4().cases, readCase)]);
    const mineAg = ags.filter(a => a.counterparty.passkey === BigInt(accountId) || a.proposer.passkey === BigInt(accountId));
    const mineCases = cases.filter(c => c.filer.passkey === BigInt(accountId) || c.decider.passkey === BigInt(accountId));
    list.innerHTML = `<h2>Agreements</h2><div id="ags">${mineAg.length ? "" : `<p class="mute">None yet.</p>`}</div><h2>Cases</h2><div id="cs">${mineCases.length ? "" : `<p class="mute">None yet.</p>`}</div>`;
    mineAg.forEach(a => agreementCard(a, accountId, credentialId)); mineCases.forEach(c => caseCard(c, accountId, credentialId));
  }
  const ctx = {};   // the account and credential in use, for the buttons below
  function agreementCard(a, accountId, credentialId) {
    const P = policyOf(a.ruleSetId), inForce = a.acceptedAt !== 0 && !a.cancelled, state = a.cancelled ? "Withdrawn" : inForce ? "In force since " + when(a.acceptedAt) : "Waiting for you to accept", div = document.createElement("div"); div.className = "card";
    div.innerHTML = `<h3>Agreement #${a.id}: ${esc(P ? P.name : "rule set " + a.ruleSetId)}</h3><p><span class="badge${inForce ? " ok" : ""}">${esc(state)}</span></p>
      <p class="small">Proposed by <code>${short(a.proposer.wallet)}</code>. The neutral reviewer is <code>${short(a.reviewer)}</code> <span data-rid="${a.reviewer}"></span>. You have ${a.answerWindow / DAY} day(s) to answer after a dispute starts, then the reviewer has ${a.reviewWindow / DAY} day(s). Once you accept, nothing can change.</p>
      ${!inForce && !a.cancelled && a.counterparty.passkey === BigInt(accountId) ? `<div class="row"><button class="btn" data-act="accept" type="button">Accept with my passkey</button></div>` : ""}
      ${inForce ? `<div class="row"><button class="btn ghost" data-act="open" type="button">Start a dispute under this agreement</button></div>` : ""}<div class="act"></div>`;
    $("#ags").appendChild(div);
    const box = div.querySelector(".act"), run = async (fn, signedNote, btnEl) => { try { box.innerHTML = `<p class="small mute">Follow your device's prompt…</p>`; box.innerHTML = await fn(); if (btnEl) { btnEl.hidden = true; const bd = div.querySelector(".badge"); if (bd && signedNote) { bd.className = "badge warn"; bd.textContent = signedNote; } } const cp = box.querySelector("#cplink"); if (cp) cp.onclick = e => copy(cp.dataset.link, e.target); } catch (e) { box.innerHTML = `<p class="small err">${esc((e && e.message) || String(e))}</p>`; } };
    const accept = div.querySelector('[data-act="accept"]'), open = div.querySelector('[data-act="open"]');
    if (accept) accept.onclick = () => run(async () => {
      const digest = K.payload.termsDigest({proposerWallet: a.proposer.wallet, proposerPasskey: a.proposer.passkey, counterpartyWallet: a.counterparty.wallet, counterpartyPasskey: a.counterparty.passkey, ruleSetId: a.ruleSetId, termsHash: a.termsHash, reviewer: a.reviewer, answerWindow: a.answerWindow, reviewWindow: a.reviewWindow});
      const s = await signAction({accountId, consumer: V4().agreements, payloadHash: K.payload.accept(a.id, digest), credentialId});
      return packBox(V4().agreements, enc("acceptSigned", ["uint256", K.SIGAUTH], [a.id, s]), "Accept agreement #" + a.id, a.proposer.wallet);
    }, "Signed. Not final until someone submits the link", accept);
    if (open) open.onclick = () => run(async () => {
      const asProposer = a.proposer.passkey === BigInt(accountId), eh = "0x" + "0".repeat(64);
      const s = await signAction({accountId, consumer: V4().cases, payloadHash: K.payload.open(a.id, eh, asProposer), credentialId});
      return packBox(V4().cases, enc("openFromAgreementSigned", ["uint256", "bytes32", "bool", K.SIGAUTH], [a.id, eh, asProposer, s]), "Start a dispute under agreement #" + a.id, asProposer ? a.counterparty.wallet : a.proposer.wallet);
    }, "Signed. Not started until someone submits the link", open);
  }
  function caseCard(c, accountId, credentialId) {
    const P = policyOf(c.ruleSetId); if (!P) return;
    const mySide = c.filer.passkey === BigInt(accountId), asFiler = mySide, nQ = P.questions.length, myIn = mySide ? c.filerIn : c.deciderIn, div = document.createElement("div"); div.className = "card";
    const fa = bits(c.filerAnswers, nQ), da = bits(c.deciderAnswers, nQ), dis = bits(c.disputed, nQ), fin = bits(c.finalAnswers, nQ), yn = v => v ? "Yes" : "No";
    div.innerHTML = `<h3>Case #${c.id}: ${esc(P.name)}</h3><p><span class="badge${c.status === 2 ? " ok" : ""}">${esc(STATUS[c.status])}</span> <span class="small mute">${c.status === 0 ? "Answers due by " + when(c.answerBy) : c.status === 1 ? "The reviewer has until " + when(c.reviewBy) : ""}</span></p>
      ${c.status >= 1 ? `<table class="ctab"><thead><tr><th>Question</th><th>You</th><th>Other side</th><th></th></tr></thead><tbody>${P.questions.map((q, i) => `<tr><td>${i + 1}. ${esc(q.text)}</td><td data-l="You">${yn((mySide ? fa : da)[i])}</td><td data-l="Other side">${yn((mySide ? da : fa)[i])}</td><td>${c.status === 2 && dis[i] ? "Reviewer: " + yn(fin[i]) : dis[i] ? `<span class="badge warn">Disputed</span>` : `<span class="badge ok">Agreed</span>`}</td></tr>`).join("")}</tbody></table>` : ""}
      ${c.status === 2 ? `<div class="res nodec"><div class="big">${esc(P.results[c.result])}</div></div>` : ""}
      ${c.status === 0 && !myIn ? `<div class="qs"></div><div class="row"><button class="btn" data-act="answer" type="button" disabled>Review and sign my answers</button></div>` : c.status === 0 ? `<p class="small mute">You have answered. Waiting for the other side.</p>` : ""}
      <div class="evhead"><div><b>Evidence</b><div class="small mute">Photos, receipts or a written account</div></div>${c.status < 2 ? `<button class="btn small ghost plus" data-act="evidence" type="button">Add evidence</button>` : ""}</div><div class="evlist"></div><div class="act"></div>`;
    $("#cs").appendChild(div);
    readEvidence(c.id).then(list => { if (list.length) div.querySelector(".evlist").innerHTML = list.map(e => `<p class="small">${esc(e.question === 255 ? "The whole case" : (e.question + 1) + ". " + (P.questions[e.question] ? P.questions[e.question].text.slice(0, 40) : ""))}: “${esc(e.note)}” <span class="mute">· ${e.passkey ? (e.passkey === BigInt(accountId) ? "you" : "passkey account #" + e.passkey) : short(e.by)} · <code>${e.hash.slice(0, 10)}…</code></span></p>`).join(""); }).catch(() => {});
    const evb = div.querySelector('[data-act="evidence"]');
    if (evb) evb.onclick = () => { const ebox = div.querySelector(".act"); ebox.innerHTML = evidenceForm(P, c.id, ""); bindEvidence(ebox, c.id, async e => {
      const s = await signAction({accountId, consumer: V4().cases, payloadHash: K.payload.evidence(c.id, mySide, e.question, e.hash, e.note), credentialId});
      const note = packBox(V4().cases, enc("attachEvidenceSigned", ["uint256", "bool", "uint8", "bytes32", "string", K.SIGAUTH], [c.id, mySide, e.question, e.hash, e.note, s]), "Evidence for case #" + c.id + ": " + e.note, mySide ? c.decider.wallet : c.filer.wallet);
      ebox.querySelector("#evout").insertAdjacentHTML("beforebegin", note); const cp = ebox.querySelector("#cplink"); if (cp) cp.onclick = ev => copy(cp.dataset.link, ev.target);
    }); };
    const box = div.querySelector(".act"), answers = Array(nQ).fill(null), btn = div.querySelector('[data-act="answer"]'), qs = div.querySelector(".qs");
    if (qs) { P.questions.forEach((q, i) => { const d = document.createElement("div"); d.className = "q"; d.innerHTML = `<div class="t">${i + 1}. ${esc(q.text)}</div>${q.hint ? `<div class="h">Evidence: ${esc(q.hint)}</div>` : ""}<div class="yn"><button type="button" data-v="1" aria-pressed="false">Yes</button><button type="button" data-v="0" aria-pressed="false">No</button></div>`;
        d.querySelectorAll("button").forEach(b => b.onclick = () => { answers[i] = b.dataset.v === "1"; d.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String((x.dataset.v === "1") === answers[i]))); btn.disabled = answers.some(x => x === null); }); qs.appendChild(d); }); }
    if (btn) btn.onclick = async () => {
      try {
        const mask = answers.reduce((m, v, i) => m + (v ? 1n << BigInt(i) : 0n), 0n);
        box.innerHTML = `<p class="small mute">Follow your device's prompt…</p>`;
        const s = await signAction({accountId, consumer: V4().cases, payloadHash: K.payload.submit(c.id, asFiler, mask), credentialId});
        box.innerHTML = packBox(V4().cases, enc("submitSigned", ["uint256", "bool", "uint64", K.SIGAUTH], [c.id, asFiler, mask, s]), `Answers for case #${c.id}: ` + answers.map((v, i) => (i + 1) + "=" + (v ? "yes" : "no")).join(", "), asFiler ? c.decider.wallet : c.filer.wallet);
        btn.hidden = true; const cp = box.querySelector("#cplink"); if (cp) cp.onclick = e => copy(cp.dataset.link, e.target);
      } catch (e) { box.innerHTML = `<p class="small err">${esc((e && e.message) || String(e))}</p>`; }
    };
  }

  // ---------- #relay/<pack>: send a signed action with a wallet ----------
  // A relay pack is only sent if it points at one of the three LGtie passkey contracts on this chain.
  const parsePack = pack => { let o; try { o = JSON.parse(new TextDecoder().decode(K.unb64u(pack))); } catch { return {damaged: true}; } const ok = o && o.v === 1 && isAddr(o.to) && /^0x[0-9a-f]+$/.test(o.data || "") && o.chainId === CFG.chainId && [V4().cases, V4().agreements, V4().passkeys].some(a => a && a.toLowerCase() === o.to.toLowerCase()); return ok ? {o} : {bad: true}; };
  async function relay(pack) {
    if (!deployed()) { notDeployed("Send a signed action"); return; }
    const pp = parsePack(pack), o = pp.o; if (pp.damaged) { main.innerHTML = `<h1>Send a signed action</h1><p class="err">This link is damaged.</p>`; return; }
    const ok = !!o;
    if (!ok) { main.innerHTML = `<h1>Send a signed action</h1><p class="err">This link does not point at an LGtie passkey contract, so it will not be sent.</p>`; return; }
    main.innerHTML = `<h1>Send a signed action</h1><p class="lede">A person approved the action below with their passkey. You only submit it and pay the small network fee. The contract accepts it only if the passkey signature is valid, and it can only do what was signed.</p>
      <div class="card"><p><b>${esc(String(o.summary || "A signed action").slice(0, 200))}</b></p><p class="small mute">To <code>${short(o.to)}</code> on X Layer. The description above comes from the link, so check the result on the case page afterwards.</p><div id="sim" class="small mute">Checking whether it would succeed…</div>
        <div class="row"><button class="btn" id="go" type="button" disabled>Submit with my wallet</button><span id="rm" class="small"></span></div><div id="done"></div></div>`;
    const sim = $("#sim"), go = $("#go");
    try { await W().rpc("eth_call", [{from: "0x000000000000000000000000000000000000dEaD", to: o.to, data: o.data}, "latest"]); sim.className = "small ok"; sim.textContent = "✓ This would succeed right now."; go.disabled = false; }
    catch (e) { sim.className = "small err"; sim.textContent = "This would fail right now: " + ((e && e.message) || "it was rejected") + ". It may already have been submitted, or it may have expired."; go.disabled = false; }
    go.onclick = async () => {
      const m = $("#rm"); go.disabled = true; m.className = "small mute"; m.textContent = "Confirm in your wallet…";
      try { const rc = await W().send(o.to, o.data); $("#done").innerHTML = `<div class="note ok-note">✓ Submitted. <a href="${CFG.explorer}/tx/${rc.transactionHash}" target="_blank" rel="noopener">${rc.transactionHash.slice(0, 12)}…</a></div>`; m.textContent = ""; }
      catch (e) { go.disabled = false; m.className = "small err"; m.textContent = (e && e.message) || String(e); }
    };
  }

  // ---------- evidence: a file or a written explanation. Only a fingerprint and a short note go on-chain; nothing is uploaded. ----------
  const hashBytes = async u8 => "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", u8))].map(b => b.toString(16).padStart(2, "0")).join("");
  const evidenceForm = (P, caseId, hint) => `<div class="evbox"><h4>Add evidence</h4>
    <p class="small mute">Nothing is uploaded. Your browser makes a fingerprint, and only that and your short note go on X Layer. Keep the file and send it to the other side and the reviewer yourself.${hint ? " " + hint : ""}</p>
    <div class="seg" role="group" aria-label="Kind of evidence"><button type="button" data-evsrc="file" aria-pressed="true">A photo or file</button><button type="button" data-evsrc="text" aria-pressed="false">Write an explanation</button></div>
    <div id="evfile"><label class="drop" id="evdrop"><input id="evf" type="file"><b id="evdn">Choose a photo or file</b><span class="small mute">It stays on your device</span></label></div>
    <div id="evtext" hidden><label class="field"><span>Your explanation</span><textarea id="evt" rows="5" maxlength="4000" placeholder="Explain what happened, in your own words. It stays in a file you download; only its fingerprint is recorded."></textarea></label></div>
    <label class="field"><span>What is it about?</span><select id="evq"><option value="255">The whole case</option>${P.questions.map((q, i) => `<option value="${i}">${i + 1}. ${esc(q.text.slice(0, 60))}</option>`).join("")}</select></label>
    <label class="field"><span>Short note everyone can see</span><input id="evn" type="text" maxlength="60" placeholder="For example: photo of the damaged casing" autocomplete="off"></label>
    <div class="row"><button class="btn" id="evgo" type="button">Record the fingerprint</button><button class="btn ghost" id="evcancel" type="button">Cancel</button></div><p id="evh" class="small mute"></p><div id="evout"></div></div>`;
  // submit({hash, question, note}) records it; the text of a written explanation is offered as a download afterwards.
  function bindEvidence(root, caseId, submit, after) {
    const q = id => root.querySelector(id), segs = root.querySelectorAll("[data-evsrc]"), mode = () => [...segs].find(x => x.getAttribute("aria-pressed") === "true").dataset.evsrc;
    segs.forEach(b => b.onclick = () => { segs.forEach(x => x.setAttribute("aria-pressed", String(x === b))); q("#evfile").hidden = b.dataset.evsrc === "text"; q("#evtext").hidden = b.dataset.evsrc !== "text"; });
    q("#evf").onchange = () => { const f = q("#evf").files[0]; q("#evdn").textContent = f ? f.name : "Choose a photo or file"; q("#evdrop").classList.toggle("has", !!f); };
    q("#evcancel").onclick = () => { root.innerHTML = ""; };
    q("#evgo").onclick = async () => {
      const h = q("#evh"); h.className = "small mute"; h.textContent = "";
      try {
        const text = mode() === "text", note = q("#evn").value.trim(), question = Number(q("#evq").value);
        if (note.length < 3) throw new Error("Add a short note so people know what this is.");
        if (new TextEncoder().encode(note).length > 60) throw new Error("The short note is too long (60 bytes at most).");
        let hash, body = null;
        if (text) { const t = q("#evt").value.trim(); if (t.length < 20) throw new Error("Write a few sentences first."); body = "LGTIE EVIDENCE STATEMENT\nCase: #" + caseId + "\nWritten: " + new Date().toISOString().slice(0, 10) + "\nNote: " + note + "\n\n" + t + "\n"; hash = await hashBytes(new TextEncoder().encode(body)); }
        else { const f = q("#evf").files[0]; if (!f) throw new Error("Choose a file first."); hash = await hashBytes(new Uint8Array(await f.arrayBuffer())); }
        h.textContent = "Fingerprint " + hash.slice(0, 14) + "… (the " + (text ? "text" : "file") + " never leaves your browser)";
        q("#evgo").disabled = true; await submit({hash, question, note});
        q("#evout").innerHTML = body ? `<div class="row"><a class="btn small ghost" download="lgtie-case-${caseId}-evidence.txt" href="data:text/plain;charset=utf-8,${encodeURIComponent(body)}">Download your written explanation</a><span class="small">Send this file to the other side and the reviewer. They can check it against the fingerprint.</span></div>` : "";
        if (after) after();
      } catch (e) { q("#evgo").disabled = false; h.className = "small err"; h.textContent = (e && e.message) || String(e); }
    };
  }

  // ---------- telling the reviewer ----------
  const reviewerInviteCard = (text, note) => `<div class="card invite" id="rvinv"><h3>Tell your reviewer</h3><p class="small mute">${note}</p><textarea id="rvtxt" rows="5" readonly>${esc(text)}</textarea><div class="row"><button class="btn small" id="rvcp" type="button">Copy message</button></div></div>`;
  const bindReviewerInvite = () => { const b = $("#rvcp"); if (b) b.onclick = () => copy($("#rvtxt").value, b); };
  const siteBase = () => location.href.split("#")[0];

  // ---------- #inbox: signed actions customers have posted for this wallet ----------
  let stopInbox = null;
  async function inbox() {
    if (!deployed()) { notDeployed("Inbox"); return; }
    if (stopInbox) { stopInbox(); stopInbox = null; }
    main.innerHTML = `<h1>Inbox</h1><p class="lede">When a customer approves something with their passkey, it lands here, addressed to your wallet. Open it, check it, and submit it. You pay the small network fee and the customer never needs a wallet. If you are a neutral reviewer, cases waiting for your decision are listed here too.</p>
      <div class="card"><ol class="ibsteps"><li><b>The customer signs</b> with their fingerprint or face.</li><li><b>It appears here</b>, addressed to your wallet. Nothing to copy or paste.</li><li><b>You submit it</b> and pay the small network fee.</li></ol><div class="row"><button class="btn" id="ibc" type="button">Connect my wallet</button></div><p id="ibs" class="small mute"></p></div><p class="small mute">Prefer a notice in Slack or Discord and no clicking? You can run an optional <a href="https://github.com/samuel025/Lgtie/tree/main/bridge" target="_blank" rel="noopener">bridge</a> of your own that tells your webhook and can submit for you. LGtie runs no server, so it is yours to run.</p><div id="ibl"></div>`;
    const start = async () => {
      const me = W().account(); if (!me) return; $("#ibc").hidden = true;
      let tasks = {wait: [], soon: []}; const items = new Map(), seenPacks = new Set(), render = () => {
        const all = [...items.values()].sort((a, b) => b.at - a.at), later = all.filter(i => i.state === "later"), ready = all.filter(i => i.state === "ready"), checking = all.filter(i => i.state === "checking"), old = all.filter(i => i.state === "old");
        const taskRow = c => { const P = policyOf(c.ruleSetId), late = Date.now() / 1000 > c.reviewBy; return `<div class="card"><p><b>Case #${c.id}${P ? ": " + esc(P.name) : ""}</b> <span class="badge">${c.v3 ? "wallet case" : "passkey case"}</span></p><p class="small mute">${late ? "The time to decide has passed." : "You have until " + when(c.reviewBy) + "."} Only the questions the two sides disagree on need your answer.</p><div class="row"><a class="btn" href="${c.v3 ? "#case/" + c.id : "#pk/case/" + c.id + "/decide"}">Decide this case</a></div></div>`; };
        $("#ibl").innerHTML = `${tasks.wait.length ? `<h2>Waiting for your decision (${tasks.wait.length})</h2>${tasks.wait.map(taskRow).join("")}` : ""}${tasks.soon.length ? `<details><summary class="small">Cases that may come to you (${tasks.soon.length})</summary>${tasks.soon.map(c => `<p class="small mute"><a href="${c.v3 ? "#case/" + c.id : "#pk/case/" + c.id}">Case #${c.id}</a>: the two sides are still answering.</p>`).join("")}</details>` : ""}<h2>Waiting for you (${ready.length})</h2>${ready.length ? ready.map(i => `<div class="card" data-k="${i.key}"><p><b>${esc(String(i.o.summary || "A signed action").slice(0, 200))}</b></p><p class="small mute">Sent ${ago(i.at)} · to <code>${short(i.o.to)}</code>. The description comes from the sender; check the result on the case page afterwards.</p><div class="row"><button class="btn" data-go="${i.key}" type="button">Submit with my wallet</button><a class="btn small ghost" href="#relay/${i.pack}">Open on its own page</a><span class="small" data-m></span></div></div>`).join("") : `<p class="mute">${checking.length ? "Checking…" : "Nothing waiting. This page keeps listening while it is open."}</p>`}
          ${later.length ? `<h3>Waiting for an earlier action (${later.length})</h3>${later.map(i => `<p class="small mute">${esc(String(i.o.summary || "A signed action").slice(0, 120))} · ${ago(i.at)}. The customer signed something earlier that has to be submitted first.</p>`).join("")}` : ""}
          ${old.length ? `<details><summary class="small">Done or expired (${old.length})</summary>${old.map(i => `<p class="small mute">${esc(String(i.o.summary || "A signed action").slice(0, 120))} · ${ago(i.at)}</p>`).join("")}</details>` : ""}`;
        document.querySelectorAll("[data-go]").forEach(b => b.onclick = async () => {
          const i = items.get(b.dataset.go), m = b.parentNode.querySelector("[data-m]"); b.disabled = true; m.className = "small mute"; m.textContent = "Confirm in your wallet…";
          try { const rc = await W().send(i.o.to, i.o.data); i.state = "old"; m.textContent = ""; [...items.values()].filter(x => x.state === "later" || x.state === "checking").forEach(check); render(); $("#ibs").className = "small ok"; $("#ibs").textContent = "✓ Submitted. " + rc.transactionHash.slice(0, 12) + "…"; }
          catch (e) { b.disabled = false; m.className = "small err"; m.textContent = (e && e.message) || String(e); }
        });
      }, check = async i => {
        try {
          if (Number.isInteger(i.o.n) && Number.isInteger(i.o.a)) { const chain = Number(await readNonce(i.o.a)); if (i.o.n < chain) { i.state = "old"; render(); return; } if (i.o.n > chain) { i.state = "later"; render(); return; } }
          await W().rpc("eth_call", [{from: me, to: i.o.to, data: i.o.data}, "latest"]); i.state = "ready";
        } catch { i.state = "old"; } render();
      };
      const N = window.TB_NOSTR, rel = N.relaysConfigured(), since = Math.floor(Date.now() / 1000) - 3 * 86400;
      stopInbox = N.listen(rel, N.filterFor(me, since), ev => {
        let msg; try { msg = JSON.parse(ev.content); } catch { return; } if (!msg || typeof msg.pack !== "string") return;
        const pp = parsePack(msg.pack); if (!pp.o || seenPacks.has(msg.pack)) return; seenPacks.add(msg.pack);
        const i = {key: "k" + items.size, pack: msg.pack, o: pp.o, at: ev.created_at, state: "checking"}; items.set(i.key, i); render(); check(i);
      }, s => { $("#ibs").className = "small mute"; $("#ibs").textContent = `Listening on ${s.open} of ${s.total} relays for ${short(me)}`; });
      const loadTasks = async () => {
        try {
          const lc = me.toLowerCase(), [a, b] = await Promise.all([scan(V4().cases, readCase).catch(() => []), (window.TB_CASES && window.TB_CASES.scanCases ? window.TB_CASES.scanCases(60).then(r => r.cases) : Promise.resolve([])).catch(() => [])]);
          const mineC = [...a.map(c => ({...c, v3: false})), ...b.map(c => ({...c, v3: true}))].filter(c => c.reviewer && c.reviewer.toLowerCase() === lc);
          tasks = {wait: mineC.filter(c => c.status === 1 && Date.now() / 1000 < c.reviewBy + 30 * 86400), soon: mineC.filter(c => c.status === 0)}; render();
        } catch (e) {}
      };
      render(); loadTasks();
    };
    $("#ibc").onclick = async () => { try { await W().connect(); await start(); } catch (e) { $("#ibs").className = "small err"; $("#ibs").textContent = (e && e.message) || String(e); } };
    if (W().account()) start();
  }
  const ago = t => { const s = Math.max(0, Math.floor(Date.now() / 1000) - t); return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " days ago"; };

  // ---------- the business and the reviewer (wallets) ----------
  const needWallet = async () => { if (!W().account()) await W().connect(); return W().account(); };
  const logTopic = (rc, addr) => { const l = rc.logs.find(l => l.address.toLowerCase() === addr.toLowerCase() && l.topics.length > 1); return l ? Number(BigInt(l.topics[1])) : 0; };
  function pkAgree(prefill) {
    if (!deployed()) { notDeployed("Invite a customer by passkey"); return; }
    main.innerHTML = `<h1>Invite a customer who has no wallet</h1><p class="lede">Paste the claim code your customer created at <code>#join</code>. We register their passkey (a small network fee, paid by you) and propose an agreement to them. They accept with their fingerprint or face, and you submit it.</p>
      <div class="card formcard">
        <label class="field"><span>Customer's claim code</span><input id="cc" type="text" placeholder="lgtie1.…" autocomplete="off"><em class="small mute">The customer creates it at <b>#join</b> and sends it to you. It contains nothing secret.</em></label>
        <label class="field"><span>Neutral reviewer's address</span><input id="rv" type="text" placeholder="0x… (not you)" autocomplete="off"><em class="small mute">The person both sides accept to decide only the questions they disagree on.</em></label>
        <div class="fgrid">
          <label class="field"><span>Rules</span><select id="rs"><option value="1">Warranty claims (published)</option></select></label>
          <label class="field"><span>Time to answer</span><select id="aw"><option value="1">1 day</option><option value="3">3 days</option><option value="7" selected>7 days</option></select></label>
          <label class="field"><span>Time for the reviewer</span><select id="rw"><option value="1">1 day</option><option value="3">3 days</option><option value="7" selected>7 days</option></select></label>
        </div>
        <label class="field"><span>Written terms (optional)</span><textarea id="terms" rows="3" placeholder="Only a fingerprint of this text goes on-chain"></textarea></label>
        <label class="field"><span>Reviewer's signed identity (recommended)</span><textarea id="rvp" rows="2" placeholder="Paste the reviewer's profile code (lgtie-reviewer1.…). They create it on their own reviewer page."></textarea><em class="small mute" id="rvpmsg"></em></label>
        <div class="row"><button class="btn" id="go" type="button">Register the customer and propose</button></div><p id="msg" class="small"></p></div>`;
    if (prefill) $("#cc").value = prefill;
    // The reviewer's identity line is added to the written terms, so it is part of what both sides fingerprint and accept.
    const rvLine = () => { const code = $("#rvp").value.trim(); if (!code) return {line: ""}; const r = window.TB_RID.parse(code); if (!r.ok) return {error: r.error}; if (r.profile.address !== $("#rv").value.trim().toLowerCase()) return {error: "This profile belongs to a different wallet than the reviewer address above."}; return {line: window.TB_RID.termsLine(r.profile)}; };
    const showLine = () => { const r = rvLine(), m = $("#rvpmsg"); m.className = "small " + (r.error ? "err" : "mute"); m.textContent = r.error ? r.error : r.line ? "Added to your terms, so both sides agree to it: " + r.line : ""; };
    $("#rvp").oninput = showLine; $("#rv").oninput = showLine;
    $("#go").onclick = async () => {
      const msg = $("#msg"), say = (t, cls) => { msg.className = "small " + (cls || "mute"); msg.textContent = t; };
      try {
        const claim = parseClaim($("#cc").value), rv = $("#rv").value.trim(); if (!isAddr(rv)) throw new Error("Enter the reviewer's wallet address."); const idl = rvLine(); if (idl.error) throw new Error(idl.error);
        await needWallet(); say("Checking whether this customer is already registered…");
        let id = Number(await readAccountByHandle(claim.handleHash));
        if (id) { const k = await readKey(id, 0); if (k.x !== claim.x || k.y !== claim.y) throw new Error("That passkey handle is already registered to a different key. Ask the customer to create a new passkey."); }
        else { say("Confirm 1 of 2 in your wallet: register the customer's passkey…"); const rc = await W().send(V4().passkeys, enc("create", ["bytes32", K.KEY], [claim.handleHash, [claim.x, claim.y, claim.rpIdHash]])); id = logTopic(rc, V4().passkeys); if (!id) id = Number(await readAccountByHandle(claim.handleHash)); }
        const terms = [$("#terms").value.trim(), idl.line].filter(Boolean).join("\n\n"), th = terms ? await hashText(terms) : "0x" + "0".repeat(64);
        say("Confirm 2 of 2 in your wallet: propose the agreement…");
        const rc2 = await W().send(V4().agreements, enc("propose", [K.PARTY, "uint256", "bytes32", "address", "uint32", "uint32"], [[ZERO, id], Number($("#rs").value), th, rv, Number($("#aw").value) * DAY, Number($("#rw").value) * DAY]));
        const aid = logTopic(rc2, V4().agreements); location.hash = "#pk/agreement/" + aid;
      } catch (e) { say((e && e.message) || String(e), "err"); }
    };
  }
  async function pkAgreement(id) {
    if (!deployed()) { notDeployed("Agreement"); return; }
    main.innerHTML = `<h1>Agreement #${esc(id)}</h1><p class="mute">Reading from X Layer…</p>`;
    let a; try { a = await readAgreement(id); } catch { main.innerHTML = `<h1>Agreement #${esc(id)}</h1><p class="err">That agreement does not exist, or X Layer could not be reached.</p>`; return; }
    const P = policyOf(a.ruleSetId), inForce = a.acceptedAt !== 0 && !a.cancelled, state = a.cancelled ? "Withdrawn" : inForce ? "In force since " + when(a.acceptedAt) : "Proposed, waiting for the customer";
    main.innerHTML = `<h1>Agreement #${id}</h1><p><span class="badge${inForce ? " ok" : ""}">${esc(state)}</span></p>
      <div class="card"><table style="font-size:15px;border-collapse:collapse"><tbody><tr><td>Proposed by</td><td><code>${a.proposer.wallet}</code></td></tr>
        <tr><td>Customer</td><td>${a.counterparty.passkey ? `passkey account #${a.counterparty.passkey}` : `<code>${a.counterparty.wallet}</code>`}</td></tr>
        <tr><td>Rules</td><td>${esc(P ? P.name : "rule set " + a.ruleSetId)}</td></tr><tr><td>Reviewer</td><td><code>${a.reviewer}</code>, agreed in advance<br><span data-rid="${a.reviewer}"></span></td></tr>
        <tr><td>Time limits</td><td>${a.answerWindow / DAY} day(s) to answer, then ${a.reviewWindow / DAY} day(s) for the reviewer</td></tr><tr><td>Terms fingerprint</td><td><code>${a.termsHash}</code></td></tr></tbody></table></div>
      ${!inForce && !a.cancelled ? `<div class="note">Waiting for the customer. Tell them to open <b>${esc(location.href.split("#")[0])}#mine</b> and accept with their passkey. Their acceptance then arrives in your <a href="#inbox">inbox</a> for you to submit.</div>` : ""}
      ${reviewerInviteCard(`You have been named the neutral reviewer for agreement #${id} (${P ? P.name : "rules"}) on LGtie. If the two sides disagree about any answer, the case will wait for you and you decide only the questions they disagree on, with written reasons. Open ${siteBase()}#inbox, connect your wallet, and any case waiting for you appears there. You pay a small network fee. Nothing is held in escrow.`, "The reviewer has no way of knowing unless you tell them. Send them this.")}
      <div class="row" id="acts"></div><div id="amsg" class="small"></div><div id="cases"></div>`;
    bindReviewerInvite();
    const acts = $("#acts"), me = W().account();
    const add = (label, cls, fn) => { const b = document.createElement("button"); b.className = "btn " + cls; b.type = "button"; b.textContent = label; b.onclick = async () => { try { await needWallet(); $("#amsg").className = "small mute"; $("#amsg").textContent = "Confirm in your wallet…"; await fn(); } catch (e) { $("#amsg").className = "small err"; $("#amsg").textContent = (e && e.message) || String(e); } }; acts.appendChild(b); };
    if (!inForce && !a.cancelled) add("Withdraw the proposal", "ghost", async () => { await W().send(V4().agreements, enc("cancel", ["uint256"], [Number(id)])); pkAgreement(id); });
    if (inForce) add("Open a dispute under this agreement", "", async () => { const rc = await W().send(V4().cases, enc("openFromAgreement", ["uint256", "bytes32"], [Number(id), "0x" + "0".repeat(64)])); location.hash = "#pk/case/" + logTopic(rc, V4().cases); });
    const cs = (await scan(V4().cases, readCase)).filter(c => c.agreementId === Number(id)); if (cs.length) $("#cases").innerHTML = `<h3>Cases</h3>` + cs.map(c => `<p><a href="#pk/case/${c.id}">Case #${c.id}</a> · ${esc(STATUS[c.status])}</p>`).join("");
  }
  async function pkAll() {
    if (!deployed()) { notDeployed("Passkey cases"); return; }
    main.innerHTML = `<h1>Passkey agreements and cases</h1><p class="lede">Everything opened with a customer's fingerprint or face. Cases between two wallets are on <a href="#case">the other case page</a>.</p><p class="mute" id="pkl">Reading from X Layer…</p>`;
    try {
      const [ags, cs] = await Promise.all([scan(V4().agreements, readAgreement), scan(V4().cases, readCase)]);
      $("#pkl").outerHTML = `<div class="card"><h3>Agreements</h3>${ags.length ? ags.map(a => { const P = policyOf(a.ruleSetId); return `<p><a href="#pk/agreement/${a.id}">Agreement #${a.id}</a> · ${esc(P ? P.name : "rule set " + a.ruleSetId)} · ${a.cancelled ? "Withdrawn" : a.acceptedAt ? "In force" : "Waiting for the customer"}</p>`; }).join("") : `<p class="mute">None yet.</p>`}<p class="small"><a href="#pk/agree">Invite a customer with a fingerprint</a></p></div>
        <div class="card"><h3>Cases</h3>${cs.length ? cs.map(c => { const P = policyOf(c.ruleSetId); return `<p><a href="#pk/case/${c.id}">Case #${c.id}</a> · ${esc(P ? P.name : "rule set " + c.ruleSetId)} · ${esc(STATUS[c.status])}</p>`; }).join("") : `<p class="mute">None yet. Once an agreement is in force, a customer can start a dispute from <a href="#mine">My cases</a>, or you can start one from the agreement page.</p>`}</div>`;
    } catch (e) { const l = $("#pkl"); if (l) l.textContent = "Could not read from X Layer right now. Try again in a moment."; }
  }
  async function pkCase(id, opts) {
    if (opts === true) opts = {review: true};
    if (!deployed()) { notDeployed("Case"); return; }
    main.innerHTML = `<h1>Case #${esc(id)}</h1><p class="mute">Reading from X Layer…</p>`;
    let c; try { c = await readCase(id); } catch { main.innerHTML = `<h1>Case #${esc(id)}</h1><p class="err">That case does not exist, or X Layer could not be reached.</p>`; return; }
    const P = policyOf(c.ruleSetId); if (!P) { main.innerHTML = `<h1>Case #${esc(id)}</h1><p>This case uses a rule set this page does not know.</p>`; return; }
    let ev = []; try { ev = await readEvidence(id); } catch (e) { ev = []; }
    const nQ = P.questions.length, fa = bits(c.filerAnswers, nQ), da = bits(c.deciderAnswers, nQ), dis = bits(c.disputed, nQ), fin = bits(c.finalAnswers, nQ), yn = v => v ? "Yes" : "No", live = c.status < 2;
    const who = p => p.passkey ? `passkey account #${p.passkey}` : `<code>${short(p.wallet)}</code>`;
    const RV = window.TB_REVIEW, cc = {reviewer: c.reviewer, filer: c.filer.wallet, filerOp: c.filerOp, decider: c.decider.wallet, deciderOp: c.deciderOp};
    const blind = RV.isReviewer(W().account(), cc) && namesFor2 !== Number(id), reasons = RV.reasonsOf(ev, cc);
    const evWho = e => String(e.by).toLowerCase() === c.reviewer.toLowerCase() ? "Reviewer" : e.passkey ? (blind ? (e.passkey === c.filer.passkey ? "Side A" : "Side B") : `passkey account #${e.passkey}`) : (blind ? RV.sideOf(e.by, cc) : `<code>${short(e.by)}</code>`);
    const qlabelV4 = q => q === 255 ? "The whole case" : (q + 1) + ". " + (P.questions[q] ? P.questions[q].text.slice(0, 60) : "?");
    main.innerHTML = `<h1>Case #${id}: ${esc(P.name)}</h1><p><span class="badge${c.status === 2 ? " ok" : ""}">${esc(STATUS[c.status])}</span> <span class="small mute">${blind ? "Side A opened the case · Side B is the other side" : "Opened by " + who(c.filer) + " · Other side " + who(c.decider)} · <a href="#pk/agreement/${c.agreementId}">Agreement #${c.agreementId}</a></span></p>
      <div class="card"><table class="ctab"><thead><tr><th>Question</th><th>${blind ? "Side A" : "Opened the case"}</th><th>${blind ? "Side B" : "Other side"}</th><th></th></tr></thead><tbody>${P.questions.map((q, i) => `<tr><td>${i + 1}. ${esc(q.text)}</td><td data-l="${blind ? "Side A" : "Opener"}">${c.filerIn ? yn(fa[i]) : "…"}</td><td data-l="${blind ? "Side B" : "Other side"}">${c.deciderIn ? yn(da[i]) : "…"}</td><td>${c.filerIn && c.deciderIn ? (dis[i] ? `<span class="badge warn">Disputed</span>` : `<span class="badge ok">Agreed</span>`) : ""}${c.status === 2 && dis[i] ? ` Reviewer: <b>${yn(fin[i])}</b>` : ""}</td></tr>`).join("")}</tbody></table></div>
      ${c.status === 2 ? `<div class="res static" role="status"><div class="big">${esc(P.results[c.result])}</div><div class="why">${esc(TB.run(P, fin).why || "")}</div>${reasons.length ? `<p class="small">Reviewer's reason: “${esc(reasons[reasons.length - 1].note)}”</p>` : ""}${RV.isReviewer(W().account(), cc) && RV.saved(CFG.chainId, V4().cases, id) ? `<div class="row">${RV.downloadLink(RV.saved(CFG.chainId, V4().cases, id), id)}<span class="small">Send this file to both sides. They can drop it on this page to check it matches the recorded fingerprint.</span></div>` : ""}</div>` : ""}
      <p class="small">Reviewer: <code>${short(c.reviewer)}</code> <span data-rid="${c.reviewer}"></span></p>
      ${c.status === 0 ? `<p class="small mute">Answers due by ${when(c.answerBy)}.</p>` : c.status === 1 ? `<p class="small mute">The reviewer has until ${when(c.reviewBy)}. Reviewer ${c.reviewerAcked ? "has taken part" : "has not yet confirmed taking part"}.</p>` : ""}
      ${blind ? `<div class="note"><b>You are the reviewer, so names are hidden to reduce bias.</b> Side A opened the case and Side B is the other side. Addresses are still public on the blockchain; this only keeps them off the page you decide from. <button class="btn small ghost" id="shownames" type="button">Show addresses</button></div>` : ""}
      ${reasons.length ? `<div class="card" id="rvreasons"><h3>Reviewer's reasons</h3>${reasons.map(r => `<p>“${esc(r.note)}”</p><p class="small mute">The full written statement is kept by the reviewer. Its fingerprint is <code>${r.hash.slice(0, 18)}…</code>; drop the file you were sent below to check it is identical.</p>`).join("")}</div>` : c.status === 2 ? `<div class="note" id="rvreasons">The reviewer recorded no written reasons for this decision.</div>` : ""}
      ${ev.length ? `<div class="card"><h3>Evidence</h3><p class="small mute">Only fingerprints are recorded. Nothing is uploaded: the files stay with the people who share them.</p><table class="ctab"><thead><tr><th>About</th><th>By</th><th>Note</th><th>Fingerprint</th></tr></thead><tbody>${ev.map(e => `<tr class="evrow" data-h="${e.hash}"><td>${esc(qlabelV4(e.question))}</td><td data-l="By">${evWho(e)}</td><td data-l="Note">${esc(e.note)}</td><td data-l="Fingerprint"><code>${e.hash.slice(0, 12)}…</code></td></tr>`).join("")}</tbody></table><div id="fchk"></div></div>` : ""}
      ${live && !blind && !RV.isReviewer(W().account(), cc) ? reviewerInviteCard(`You are the neutral reviewer for case #${id} (${P.name}) on LGtie. ${c.status === 1 ? "The two sides disagree on some answers and the case is waiting for you." : "The two sides are still answering. If they disagree, the case will wait for you."} Open ${siteBase()}#pk/case/${id}/decide, connect your wallet and decide only the questions they disagree on. You will write your reasons and confirm you have no conflict of interest. You pay a small network fee. Nothing is held in escrow.`, c.status === 1 ? "The case is waiting for the reviewer. They get no notification, so send them this." : "Send this so the reviewer is ready if the sides disagree.") : ""}
      <div class="card" id="wal"></div><div id="cmsg" class="small"></div>`;
    bindReviewerInvite();
    if ($("#shownames")) $("#shownames").onclick = () => { namesFor2 = Number(id); pkCase(id); };
    if ($("#fchk") && window.TB_CASES && window.TB_CASES.mountFileCheck) window.TB_CASES.mountFileCheck($("#fchk"), ev, q => q === 255 ? "the whole case" : "question " + (q + 1));
    const wal = $("#wal"), msg = $("#cmsg"), act = (fn, rerender) => async () => { try { await needWallet(); msg.className = "small mute"; msg.textContent = rerender === false ? "" : "Confirm in your wallet…"; await fn(); if (rerender !== false) await pkCase(id); } catch (e) { msg.className = "small err"; msg.textContent = (e && e.message) || String(e); } };
    wal.innerHTML = `<h3>Actions for a wallet</h3><p class="small mute">If you are the business, the reviewer or anyone closing an expired case, connect your wallet. A customer with a passkey acts at <a href="#mine">My cases</a>.</p><div class="row" id="wacts"></div><div id="ans"></div>`;
    const wacts = $("#wacts"), btn = (label, cls, fn, rerender) => { const b = document.createElement("button"); b.className = "btn small " + cls; b.type = "button"; b.textContent = label; b.onclick = act(fn, rerender); wacts.appendChild(b); };
    if (live) btn("Answer the questions", "ghost", async () => { $("#ans").innerHTML = answerForm(P); bindAnswer(c, P, id); }, false);
    if (c.status === 1) btn("Decide as the reviewer", "ghost", async () => { if (!blind && RV.isReviewer(W().account(), cc) && namesFor2 !== Number(id)) { await pkCase(id, {review: true}); return; } $("#ans").innerHTML = answerForm(P, dis, window.TB_REVIEW.fields()); window.TB_REVIEW.bind($("#ans")); bindReview(P, dis, id, ev, c); }, false);
    if (live) btn("Add evidence", "ghost plus", async () => { $("#ans").innerHTML = evidenceForm(P, id); bindEvidence($("#ans"), id, async e => { msg.className = "small mute"; msg.textContent = "Confirm in your wallet…"; await W().send(V4().cases, enc("attachEvidence", ["uint256", "uint8", "bytes32", "string"], [Number(id), e.question, e.hash, e.note])); msg.className = "small ok"; msg.textContent = "✓ Recorded on X Layer."; }, () => { const b = document.createElement("button"); b.className = "btn small"; b.type = "button"; b.textContent = "Show the updated case"; b.onclick = () => pkCase(id); $("#evout").appendChild(b); }); }, false);
    if (live) btn("Confirm I am taking part (reviewer)", "ghost", async () => { await W().send(V4().cases, enc("acknowledgeReviewer", ["uint256"], [Number(id)])); });
    if (opts && opts.review) setTimeout(() => { const b = [...wacts.children].find(x => /decide/i.test(x.textContent)); if (b) b.click(); }, 0);
    if ((c.status === 0 && Date.now() / 1000 > c.answerBy) || (c.status === 1 && Date.now() / 1000 > c.reviewBy)) btn("Close this case (the time has passed)", "", async () => { await W().send(V4().cases, enc("expire", ["uint256"], [Number(id)])); });
  }
  const answerForm = (P, only, extra) => `<div class="qs">${P.questions.map((q, i) => (only && !only[i]) ? "" : `<div class="q"><div class="t">${i + 1}. ${esc(q.text)}</div><div class="yn" data-i="${i}"><button type="button" data-v="1" aria-pressed="false">Yes</button><button type="button" data-v="0" aria-pressed="false">No</button></div></div>`).join("")}</div>${extra || ""}<div class="row"><button class="btn" id="send" type="button">${extra ? "Submit my decision" : "Send my answers"}</button></div>`;
  function collect(P, only) { const vals = {}; document.querySelectorAll("#ans .yn").forEach(g => { g.querySelectorAll("button").forEach(b => b.onclick = () => { vals[g.dataset.i] = b.dataset.v === "1"; g.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String((x.dataset.v === "1") === vals[g.dataset.i]))); }); }); return vals; }
  function bindAnswer(c, P, id) {
    const vals = collect(P); $("#send").onclick = async () => {
      const msg = $("#cmsg"); try {
        const me = W().account(), asFiler = c.filer.wallet.toLowerCase() === me || c.filerOp.toLowerCase() === me; if (!asFiler && !(c.decider.wallet.toLowerCase() === me || c.deciderOp.toLowerCase() === me)) throw new Error("Your wallet is not a wallet party in this case.");
        if (P.questions.some((_, i) => vals[i] === undefined)) throw new Error("Answer every question.");
        const mask = P.questions.reduce((m, _, i) => m + (vals[i] ? 1n << BigInt(i) : 0n), 0n); msg.textContent = "Confirm in your wallet…";
        await W().send(V4().cases, enc("submit", ["uint256", "bool", "uint64"], [Number(id), asFiler, mask])); pkCase(id);
      } catch (e) { msg.className = "small err"; msg.textContent = (e && e.message) || String(e); }
    };
  }
  function bindReview(P, dis, id, ev, c) {
    const vals = collect(P, dis); $("#send").onclick = async () => {
      const msg = $("#cmsg"); try {
        const RV = window.TB_REVIEW, rd = RV.read($("#ans")); if (!rd.ok) throw new Error(rd.error);
        if (P.questions.some((_, i) => dis[i] && vals[i] === undefined)) throw new Error("Answer every disputed question.");
        const me = W().account(), decisions = P.questions.map((q, i) => dis[i] ? {n: i + 1, text: q.text, yes: !!vals[i]} : null).filter(Boolean);
        const text = RV.build({caseId: id, reviewer: me, decisions, oneLine: rd.oneLine, full: rd.full, date: new Date().toISOString().slice(0, 10)}), hash = await RV.sha256Hex(text);
        RV.save(CFG.chainId, V4().cases, id, text);                              // keep the statement on this device so it can be downloaded afterwards
        if (!ev.some(e => String(e.by).toLowerCase() === me && e.hash.toLowerCase() === hash.toLowerCase())) { msg.className = "small mute"; msg.textContent = "Confirm 1 of 2 in your wallet: record your reasons…"; await W().send(V4().cases, enc("attachEvidence", ["uint256", "uint8", "bytes32", "string"], [Number(id), 255, hash, rd.oneLine])); }
        const mask = P.questions.reduce((m, _, i) => m + (dis[i] && vals[i] ? 1n << BigInt(i) : 0n), 0n); msg.className = "small mute"; msg.textContent = "Confirm 2 of 2 in your wallet: submit your decision…";
        await W().send(V4().cases, enc("review", ["uint256", "uint64"], [Number(id), mask])); pkCase(id);
      } catch (e) { console.error("review failed:", e && e.stack || e); msg.className = "small err"; msg.textContent = (e && e.message) || String(e); }
    };
  }

  window.TB_PASSKEYS = {inbox, all: pkAll, join, mine: mineView, relay, agree: pkAgree, agreement: pkAgreement, case: pkCase, parseClaim, createPasskey, signAction};
})();
