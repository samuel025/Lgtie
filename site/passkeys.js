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
  async function signAction({accountId, consumer, payloadHash, credentialId}) {
    const nonce = await readNonce(accountId), head = await W().rpc("eth_getBlockByNumber", ["latest", false]), deadline = BigInt(Number(BigInt(head.timestamp)) + DAY);   // the chain's clock, not the browser's
    const ch = K.challenge({chainId: CFG.chainId, registry: V4().passkeys, consumer, accountId, nonce, deadline, payloadHash});
    const a = await navigator.credentials.get({publicKey: {challenge: ch, rpId: location.hostname, userVerification: "required", allowCredentials: credentialId ? [{type: "public-key", id: K.unb64u(credentialId)}] : []}});
    const assertion = K.assertionTuple(new Uint8Array(a.response.authenticatorData), new TextDecoder().decode(a.response.clientDataJSON), new Uint8Array(a.response.signature));
    const r = words(await call(V4().passkeys, enc("isControlledBy", ["uint256", "bytes32", K.ASSERTION], [accountId, K.hex(ch), assertion])));
    if (r[0] !== 1n) throw new Error("This passkey does not control that account, so nothing was signed for it.");
    return K.sigAuthTuple(nonce, deadline, Number(r[1]), assertion);
  }
  const packOf = (to, data, summary) => K.b64u(K.utf8(JSON.stringify({v: 1, to, data, summary, chainId: CFG.chainId})));
  function packBox(to, data, summary) {
    const pack = packOf(to, data, summary), link = location.href.split("#")[0] + "#relay/" + pack;
    return `<div class="note ok-note" id="packbox"><b>Signed.</b> ${esc(summary)}<br><span class="small">Send this link to the person who will submit it (the business, or anyone with a wallet). It only does what you just approved, and it expires in 24 hours.</span>
      <div class="row"><button class="btn small" id="cplink" type="button" data-link="${esc(link)}">Copy the link</button></div><details><summary class="small">Show the signed action</summary><pre id="packtxt">${esc(link)}</pre></details></div>`;
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
      <p class="small">Proposed by <code>${short(a.proposer.wallet)}</code>. The neutral reviewer is <code>${short(a.reviewer)}</code>. You have ${a.answerWindow / DAY} day(s) to answer after a dispute starts, then the reviewer has ${a.reviewWindow / DAY} day(s). Once you accept, nothing can change.</p>
      ${!inForce && !a.cancelled && a.counterparty.passkey === BigInt(accountId) ? `<div class="row"><button class="btn" data-act="accept" type="button">Accept with my passkey</button></div>` : ""}
      ${inForce ? `<div class="row"><button class="btn ghost" data-act="open" type="button">Start a dispute under this agreement</button></div>` : ""}<div class="act"></div>`;
    $("#ags").appendChild(div);
    const box = div.querySelector(".act"), run = async (fn) => { try { box.innerHTML = `<p class="small mute">Follow your device's prompt…</p>`; box.innerHTML = await fn(); const cp = box.querySelector("#cplink"); if (cp) cp.onclick = e => copy(cp.dataset.link, e.target); } catch (e) { box.innerHTML = `<p class="small err">${esc((e && e.message) || String(e))}</p>`; } };
    const accept = div.querySelector('[data-act="accept"]'), open = div.querySelector('[data-act="open"]');
    if (accept) accept.onclick = () => run(async () => {
      const digest = K.payload.termsDigest({proposerWallet: a.proposer.wallet, proposerPasskey: a.proposer.passkey, counterpartyWallet: a.counterparty.wallet, counterpartyPasskey: a.counterparty.passkey, ruleSetId: a.ruleSetId, termsHash: a.termsHash, reviewer: a.reviewer, answerWindow: a.answerWindow, reviewWindow: a.reviewWindow});
      const s = await signAction({accountId, consumer: V4().agreements, payloadHash: K.payload.accept(a.id, digest), credentialId});
      return packBox(V4().agreements, enc("acceptSigned", ["uint256", K.SIGAUTH], [a.id, s]), "Accept agreement #" + a.id);
    });
    if (open) open.onclick = () => run(async () => {
      const asProposer = a.proposer.passkey === BigInt(accountId), eh = "0x" + "0".repeat(64);
      const s = await signAction({accountId, consumer: V4().cases, payloadHash: K.payload.open(a.id, eh, asProposer), credentialId});
      return packBox(V4().cases, enc("openFromAgreementSigned", ["uint256", "bytes32", "bool", K.SIGAUTH], [a.id, eh, asProposer, s]), "Start a dispute under agreement #" + a.id);
    });
  }
  function caseCard(c, accountId, credentialId) {
    const P = policyOf(c.ruleSetId); if (!P) return;
    const mySide = c.filer.passkey === BigInt(accountId), asFiler = mySide, nQ = P.questions.length, myIn = mySide ? c.filerIn : c.deciderIn, div = document.createElement("div"); div.className = "card";
    const fa = bits(c.filerAnswers, nQ), da = bits(c.deciderAnswers, nQ), dis = bits(c.disputed, nQ), fin = bits(c.finalAnswers, nQ), yn = v => v ? "Yes" : "No";
    div.innerHTML = `<h3>Case #${c.id}: ${esc(P.name)}</h3><p><span class="badge${c.status === 2 ? " ok" : ""}">${esc(STATUS[c.status])}</span> <span class="small mute">${c.status === 0 ? "Answers due by " + when(c.answerBy) : c.status === 1 ? "The reviewer has until " + when(c.reviewBy) : ""}</span></p>
      ${c.status >= 1 ? `<table style="width:100%;border-collapse:collapse;font-size:14px"><tbody>${P.questions.map((q, i) => `<tr><td>${i + 1}. ${esc(q.text)}</td><td>${yn(fa[i])} / ${yn(da[i])}</td><td>${c.status === 2 && dis[i] ? "Reviewer: " + yn(fin[i]) : dis[i] ? "Disputed" : "Agreed"}</td></tr>`).join("")}</tbody></table>` : ""}
      ${c.status === 2 ? `<div class="res nodec"><div class="big">${esc(P.results[c.result])}</div></div>` : ""}
      ${c.status === 0 && !myIn ? `<div class="qs"></div><div class="row"><button class="btn" data-act="answer" type="button" disabled>Review and sign my answers</button></div>` : c.status === 0 ? `<p class="small mute">You have answered. Waiting for the other side.</p>` : ""}
      <div class="act"></div>`;
    $("#cs").appendChild(div);
    const box = div.querySelector(".act"), answers = Array(nQ).fill(null), btn = div.querySelector('[data-act="answer"]'), qs = div.querySelector(".qs");
    if (qs) { P.questions.forEach((q, i) => { const d = document.createElement("div"); d.className = "q"; d.innerHTML = `<div class="t">${i + 1}. ${esc(q.text)}</div>${q.hint ? `<div class="h">Evidence: ${esc(q.hint)}</div>` : ""}<div class="yn"><button type="button" data-v="1" aria-pressed="false">Yes</button><button type="button" data-v="0" aria-pressed="false">No</button></div>`;
        d.querySelectorAll("button").forEach(b => b.onclick = () => { answers[i] = b.dataset.v === "1"; d.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String((x.dataset.v === "1") === answers[i]))); btn.disabled = answers.some(x => x === null); }); qs.appendChild(d); }); }
    if (btn) btn.onclick = async () => {
      try {
        const mask = answers.reduce((m, v, i) => m + (v ? 1n << BigInt(i) : 0n), 0n);
        box.innerHTML = `<p class="small mute">Follow your device's prompt…</p>`;
        const s = await signAction({accountId, consumer: V4().cases, payloadHash: K.payload.submit(c.id, asFiler, mask), credentialId});
        box.innerHTML = packBox(V4().cases, enc("submitSigned", ["uint256", "bool", "uint64", K.SIGAUTH], [c.id, asFiler, mask, s]), `Answers for case #${c.id}: ` + answers.map((v, i) => (i + 1) + "=" + (v ? "yes" : "no")).join(", "));
        const cp = box.querySelector("#cplink"); if (cp) cp.onclick = e => copy(cp.dataset.link, e.target);
      } catch (e) { box.innerHTML = `<p class="small err">${esc((e && e.message) || String(e))}</p>`; }
    };
  }

  // ---------- #relay/<pack>: send a signed action with a wallet ----------
  async function relay(pack) {
    if (!deployed()) { notDeployed("Send a signed action"); return; }
    let o; try { o = JSON.parse(new TextDecoder().decode(K.unb64u(pack))); } catch { main.innerHTML = `<h1>Send a signed action</h1><p class="err">This link is damaged.</p>`; return; }
    const ok = o && o.v === 1 && isAddr(o.to) && /^0x[0-9a-f]+$/.test(o.data || "") && o.chainId === CFG.chainId && [V4().cases, V4().agreements, V4().passkeys].some(a => a && a.toLowerCase() === o.to.toLowerCase());
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

  // ---------- the business and the reviewer (wallets) ----------
  const needWallet = async () => { if (!W().account()) await W().connect(); return W().account(); };
  const logTopic = (rc, addr) => { const l = rc.logs.find(l => l.address.toLowerCase() === addr.toLowerCase() && l.topics.length > 1); return l ? Number(BigInt(l.topics[1])) : 0; };
  function pkAgree() {
    if (!deployed()) { notDeployed("Invite a customer by passkey"); return; }
    main.innerHTML = `<h1>Invite a customer who has no wallet</h1><p class="lede">Paste the claim code your customer created at <code>#join</code>. We register their passkey (a small network fee, paid by you) and propose an agreement to them. They accept with their fingerprint or face, and you submit it.</p>
      <div class="card"><div class="wide"><label><span>Customer's claim code</span><input id="cc" type="text" placeholder="lgtie1.…" autocomplete="off"></label></div>
        <div class="wide"><label><span>Neutral reviewer</span><input id="rv" type="text" placeholder="0x… (not you)" autocomplete="off"></label></div>
        <div class="row"><label>Rules <select id="rs"><option value="1">Warranty claims (published)</option></select></label><label>Time to answer <select id="aw"><option value="1">1 day</option><option value="3">3 days</option><option value="7" selected>7 days</option></select></label><label>Time for the reviewer <select id="rw"><option value="1">1 day</option><option value="3">3 days</option><option value="7" selected>7 days</option></select></label></div>
        <div class="wide"><label><span>Written terms (optional)</span><textarea id="terms" rows="3" placeholder="Only a fingerprint goes on-chain"></textarea></label></div>
        <div class="row"><button class="btn" id="go" type="button">Register the customer and propose</button><span id="msg" class="small"></span></div></div>`;
    $("#go").onclick = async () => {
      const msg = $("#msg"), say = (t, cls) => { msg.className = "small " + (cls || "mute"); msg.textContent = t; };
      try {
        const claim = parseClaim($("#cc").value), rv = $("#rv").value.trim(); if (!isAddr(rv)) throw new Error("Enter the reviewer's wallet address.");
        await needWallet(); say("Checking whether this customer is already registered…");
        let id = Number(await readAccountByHandle(claim.handleHash));
        if (id) { const k = await readKey(id, 0); if (k.x !== claim.x || k.y !== claim.y) throw new Error("That passkey handle is already registered to a different key. Ask the customer to create a new passkey."); }
        else { say("Confirm 1 of 2 in your wallet: register the customer's passkey…"); const rc = await W().send(V4().passkeys, enc("create", ["bytes32", K.KEY], [claim.handleHash, [claim.x, claim.y, claim.rpIdHash]])); id = logTopic(rc, V4().passkeys); if (!id) id = Number(await readAccountByHandle(claim.handleHash)); }
        const terms = $("#terms").value.trim(), th = terms ? await hashText(terms) : "0x" + "0".repeat(64);
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
        <tr><td>Rules</td><td>${esc(P ? P.name : "rule set " + a.ruleSetId)}</td></tr><tr><td>Reviewer</td><td><code>${a.reviewer}</code>, agreed in advance</td></tr>
        <tr><td>Time limits</td><td>${a.answerWindow / DAY} day(s) to answer, then ${a.reviewWindow / DAY} day(s) for the reviewer</td></tr><tr><td>Terms fingerprint</td><td><code>${a.termsHash}</code></td></tr></tbody></table></div>
      ${!inForce && !a.cancelled ? `<div class="note">Waiting for the customer. Tell them to open <b>${esc(location.href.split("#")[0])}#mine</b> and accept with their passkey. They will give you a link to submit.</div>` : ""}
      <div class="row" id="acts"></div><div id="amsg" class="small"></div><div id="cases"></div>`;
    const acts = $("#acts"), me = W().account();
    const add = (label, cls, fn) => { const b = document.createElement("button"); b.className = "btn " + cls; b.type = "button"; b.textContent = label; b.onclick = async () => { try { await needWallet(); $("#amsg").className = "small mute"; $("#amsg").textContent = "Confirm in your wallet…"; await fn(); } catch (e) { $("#amsg").className = "small err"; $("#amsg").textContent = (e && e.message) || String(e); } }; acts.appendChild(b); };
    if (!inForce && !a.cancelled) add("Withdraw the proposal", "ghost", async () => { await W().send(V4().agreements, enc("cancel", ["uint256"], [Number(id)])); pkAgreement(id); });
    if (inForce) add("Open a dispute under this agreement", "", async () => { const rc = await W().send(V4().cases, enc("openFromAgreement", ["uint256", "bytes32"], [Number(id), "0x" + "0".repeat(64)])); location.hash = "#pk/case/" + logTopic(rc, V4().cases); });
    const cs = (await scan(V4().cases, readCase)).filter(c => c.agreementId === Number(id)); if (cs.length) $("#cases").innerHTML = `<h3>Cases</h3>` + cs.map(c => `<p><a href="#pk/case/${c.id}">Case #${c.id}</a> · ${esc(STATUS[c.status])}</p>`).join("");
  }
  async function pkCase(id) {
    if (!deployed()) { notDeployed("Case"); return; }
    main.innerHTML = `<h1>Case #${esc(id)}</h1><p class="mute">Reading from X Layer…</p>`;
    let c; try { c = await readCase(id); } catch { main.innerHTML = `<h1>Case #${esc(id)}</h1><p class="err">That case does not exist, or X Layer could not be reached.</p>`; return; }
    const P = policyOf(c.ruleSetId); if (!P) { main.innerHTML = `<h1>Case #${esc(id)}</h1><p>This case uses a rule set this page does not know.</p>`; return; }
    const nQ = P.questions.length, fa = bits(c.filerAnswers, nQ), da = bits(c.deciderAnswers, nQ), dis = bits(c.disputed, nQ), fin = bits(c.finalAnswers, nQ), yn = v => v ? "Yes" : "No", live = c.status < 2;
    const who = p => p.passkey ? `passkey account #${p.passkey}` : `<code>${short(p.wallet)}</code>`;
    main.innerHTML = `<h1>Case #${id}: ${esc(P.name)}</h1><p><span class="badge${c.status === 2 ? " ok" : ""}">${esc(STATUS[c.status])}</span> <span class="small mute">Filer ${who(c.filer)} · Decider ${who(c.decider)} · <a href="#pk/agreement/${c.agreementId}">Agreement #${c.agreementId}</a></span></p>
      <div class="card" style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:15px"><thead><tr style="text-align:left"><th>Question</th><th>Filer</th><th>Decider</th><th></th></tr></thead><tbody>${P.questions.map((q, i) => `<tr><td>${i + 1}. ${esc(q.text)}</td><td>${c.filerIn ? yn(fa[i]) : "…"}</td><td>${c.deciderIn ? yn(da[i]) : "…"}</td><td>${c.filerIn && c.deciderIn ? (dis[i] ? `<span class="badge warn">Disputed</span>` : `<span class="badge ok">Agreed</span>`) : ""}${c.status === 2 && dis[i] ? ` Reviewer: <b>${yn(fin[i])}</b>` : ""}</td></tr>`).join("")}</tbody></table></div>
      ${c.status === 2 ? `<div class="res" role="status"><div class="big">${esc(P.results[c.result])}</div><div class="why">${esc(TB.run(P, fin).why || "")}</div></div>` : ""}
      ${c.status === 0 ? `<p class="small mute">Answers due by ${when(c.answerBy)}.</p>` : c.status === 1 ? `<p class="small mute">The reviewer has until ${when(c.reviewBy)}. Reviewer ${c.reviewerAcked ? "has taken part" : "has not yet confirmed taking part"}.</p>` : ""}
      <div class="card" id="wal"></div><div id="cmsg" class="small"></div>`;
    const wal = $("#wal"), msg = $("#cmsg"), act = (fn, rerender) => async () => { try { await needWallet(); msg.className = "small mute"; msg.textContent = rerender === false ? "" : "Confirm in your wallet…"; await fn(); if (rerender !== false) await pkCase(id); } catch (e) { msg.className = "small err"; msg.textContent = (e && e.message) || String(e); } };
    wal.innerHTML = `<h3>Actions for a wallet</h3><p class="small mute">If you are the business, the reviewer or anyone closing an expired case, connect your wallet. A customer with a passkey acts at <a href="#mine">My cases</a>.</p><div class="row" id="wacts"></div><div id="ans"></div>`;
    const wacts = $("#wacts"), btn = (label, cls, fn, rerender) => { const b = document.createElement("button"); b.className = "btn small " + cls; b.type = "button"; b.textContent = label; b.onclick = act(fn, rerender); wacts.appendChild(b); };
    if (live) btn("Answer as a wallet party…", "ghost", async () => { $("#ans").innerHTML = answerForm(P); bindAnswer(c, P, id); }, false);
    if (c.status === 1) btn("I am the reviewer: decide…", "ghost", async () => { $("#ans").innerHTML = answerForm(P, dis); bindReview(P, dis, id); }, false);
    if (live) btn("I am the reviewer: confirm I am taking part", "ghost", async () => { await W().send(V4().cases, enc("acknowledgeReviewer", ["uint256"], [Number(id)])); });
    if ((c.status === 0 && Date.now() / 1000 > c.answerBy) || (c.status === 1 && Date.now() / 1000 > c.reviewBy)) btn("Close this case (the time has passed)", "", async () => { await W().send(V4().cases, enc("expire", ["uint256"], [Number(id)])); });
  }
  const answerForm = (P, only) => `<div class="qs">${P.questions.map((q, i) => (only && !only[i]) ? "" : `<div class="q"><div class="t">${i + 1}. ${esc(q.text)}</div><div class="yn" data-i="${i}"><button type="button" data-v="1" aria-pressed="false">Yes</button><button type="button" data-v="0" aria-pressed="false">No</button></div></div>`).join("")}</div><div class="row"><button class="btn" id="send" type="button">Send my answers</button></div>`;
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
  function bindReview(P, dis, id) {
    const vals = collect(P, dis); $("#send").onclick = async () => {
      const msg = $("#cmsg"); try {
        if (P.questions.some((_, i) => dis[i] && vals[i] === undefined)) throw new Error("Answer every disputed question.");
        const mask = P.questions.reduce((m, _, i) => m + (dis[i] && vals[i] ? 1n << BigInt(i) : 0n), 0n); msg.textContent = "Confirm in your wallet…";
        await W().send(V4().cases, enc("review", ["uint256", "uint64"], [Number(id), mask])); pkCase(id);
      } catch (e) { msg.className = "small err"; msg.textContent = (e && e.message) || String(e); }
    };
  }

  window.TB_PASSKEYS = {join, mine: mineView, relay, agree: pkAgree, agreement: pkAgreement, case: pkCase, parseClaim, createPasskey, signAction};
})();
