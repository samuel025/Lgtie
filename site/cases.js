// On-chain pages for TiebreakCaseV3 and AgreementRegistry: agreements before disputes, cases with reviewer consent and deadlines,
// evidence hashes (files are hashed in the browser and never uploaded), helpers, reviewer and business records. Reads are free;
// sending needs a wallet. Static: no server.
(function () {
  "use strict";
  const TB = window.TB, CFG = window.TB_CONFIG, $ = s => document.querySelector(s), main = document.querySelector("#main");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const w = n => BigInt(n).toString(16).padStart(64, "0"), addrW = a => a.toLowerCase().replace("0x", "").padStart(64, "0");
  const SEL = {open: "0x59190257", openAg: "0x04a6019c", setOp: "0x62cb8c71", approve: "0xf32ece36", propose: "0x19d368d1", submit: "0x99467e00", evidence: "0x2fe8957a", review: "0x9e1e0b54", expire: "0xbf81bf43", get: "0x9507d39a", replay: "0x275fabd4", count: "0x06661abd", evCount: "0x30713886", evAt: "0x6ce7ff99"};
  const ASEL = {propose: "0x8f54bc26", accept: "0x19b05f49", cancel: "0x40e58ee5", get: "0x9507d39a", count: "0x06661abd"};
  const OPENED = "0x0dc88bdd001519e93d0371eefdcd9fa5aaba317a4824e61b83cac74cc95297cb", AG_PROPOSED = "0x7b294b07f9d490eeca886656d5d650ad7120a560405c55f47a5de7b3280cb8f7";
  const ZERO = /^0x0+$/, ADDR = /^0x[0-9a-fA-F]{40}$/, short = a => a.slice(0, 6) + "…" + a.slice(-4), DAY = 86400, WHOLE = 255;
  const STATUS = ["Waiting for answers", "Waiting for the reviewer", "Decided", "No decision (expired)"];
  const rpc = (method, params) => window.TB_WALLET.rpc(method, params);
  const callAt = (to, data) => rpc("eth_call", [{to, data}, "latest"]);
  const call = data => callAt(CFG.caseContract, data), acall = data => callAt(CFG.agreements, data);
  const send = data => window.TB_WALLET.send(CFG.caseContract, data), asend = data => window.TB_WALLET.send(CFG.agreements, data);
  const hashText = async t => "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("");
  const hashFile = async f => "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()))].map(b => b.toString(16).padStart(2, "0")).join("");
  const policyOf = ruleSetId => { const k = Object.keys(CFG.published).find(k => CFG.published[k].ruleSetId === Number(ruleSetId)); return k ? {key: k, policy: TB.parse(TB.TEMPLATES[k]).policy} : null; };
  const deployed = () => !ZERO.test(CFG.caseContract) && !ZERO.test(CFG.agreements);
  const when = sec => new Date(Number(sec) * 1000).toLocaleString([], {dateStyle: "medium", timeStyle: "short"});
  const upgrading = title => { main.innerHTML = `<h1>${title}</h1><div class="note">The case and agreement contracts are being upgraded (a security fix, agreements and evidence). This page will work once the new contracts are deployed.</div>`; };
  const friendly = e => { const m = String((e && e.message) || e);
    const map = [[/reviewer not accepted/, "Both sides have to accept the reviewer first."], [/deadline passed/, "The deadline has passed."], [/not allowed/, "Your wallet isn't allowed to do that on this case."], [/only the side itself/, "Only the side itself can name its helper."],
      [/not a party/, "Only the two parties to the agreement can do that."], [/only the counterparty/, "Only the other party can accept this agreement."], [/agreement not in force/, "That agreement has not been accepted yet, or was withdrawn."], [/user rejected|denied/i, "You cancelled in the wallet."]];
    for (const [re, t] of map) if (re.test(m)) return t; return m; };
  const bitsToArr = (m, n) => Array.from({length: n}, (_, k) => ((BigInt(m) >> BigInt(k)) & 1n) === 1n);
  const dec = hex => { const x = hex.replace("0x", ""); return {W: i => x.slice(i * 64, i * 64 + 64), A: i => "0x" + x.slice(i * 64 + 24, i * 64 + 64), N: i => BigInt("0x" + x.slice(i * 64, i * 64 + 64)), x}; };
  const utf8 = hex => new TextDecoder().decode(Uint8Array.from(hex.match(/../g) || [], b => parseInt(b, 16)));

  function decodeCase(hex) { const {W, A, N} = dec(hex);
    return {ruleSetId: Number(N(0)), filer: A(1), decider: A(2), reviewer: A(3), filerOp: A(4), deciderOp: A(5), evidenceHash: "0x" + W(6), agreementId: Number(N(7)), openedAt: Number(N(8)), answerBy: Number(N(9)), reviewWindow: Number(N(10)), reviewBy: Number(N(11)),
      filerAnswers: N(12), deciderAnswers: N(13), filerIn: N(14) === 1n, deciderIn: N(15) === 1n, disputed: N(16), finalAnswers: N(17), result: Number(N(18)), filerOk: N(19) === 1n, deciderOk: N(20) === 1n, status: Number(N(21))}; }
  function decodeAgreement(hex) { const {W, A, N} = dec(hex);
    return {proposer: A(0), counterparty: A(1), ruleSetId: Number(N(2)), termsHash: "0x" + W(3), reviewer: A(4), answerWindow: Number(N(5)), reviewWindow: Number(N(6)), proposedAt: Number(N(7)), acceptedAt: Number(N(8)), cancelled: N(9) === 1n}; }
  // A struct with one dynamic string: [0] = offset of the tuple, then the tuple head, then the string.
  function decodeTupleString(hex, headWords, strWord) { const {x, W, A, N} = dec(hex), ts = Number(N(0)) / 32, off = Number(N(ts + strWord)), base = ts * 64 + off * 2, len = Number(BigInt("0x" + x.slice(base, base + 64)));
    return {W: i => W(ts + i), A: i => A(ts + i), N: i => N(ts + i), str: utf8(x.slice(base + 64, base + 64 + len * 2))}; }
  const decodeEvidence = hex => { const t = decodeTupleString(hex, 5, 4); return {by: t.A(0), question: Number(t.N(1)), at: Number(t.N(2)), hash: "0x" + t.W(3), note: t.str}; };
  const decodeRuleSet = hex => { const t = decodeTupleString(hex, 9, 8); return {publisher: t.A(0), circuitId: Number(t.N(2)), nQ: Number(t.N(3)), nOut: Number(t.N(4)), hash: "0x" + t.W(5), previousId: Number(t.N(6)), publishedAt: Number(t.N(7)), name: t.str}; };

  // ---------- evidence: drop a file you were sent and see whether it is the one recorded (hashed in the browser, never uploaded) ----------
  function mountFileCheck(box, ev, label) {
    if (!box) return; if (!ev.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="drop" id="dz"><p><b>Got a file from the other side? Check it here.</b></p><p class="small mute">Drop it here or <label class="flink">choose a file<input type="file" id="dzf" hidden></label>. It is fingerprinted in your browser and never uploaded.</p><div id="dzr" class="small" role="status" aria-live="polite"></div></div>`;
    const dz = box.querySelector("#dz"), out = box.querySelector("#dzr");
    const check = async f => {
      if (!f) return; out.className = "small mute"; out.textContent = "Checking…";
      const h = (await hashFile(f)).toLowerCase(), hit = ev.filter(e => e.hash.toLowerCase() === h);
      document.querySelectorAll(".evrow").forEach(r => r.classList.toggle("match", hit.some(e => e.hash.toLowerCase() === (r.dataset.h || "").toLowerCase())));
      out.className = "small";
      out.innerHTML = hit.length ? `<span class="badge ok">✓ Same file as recorded</span> <b>${esc(f.name)}</b> is identical to the evidence recorded for ${esc(label(hit[0].question))} (fingerprint <code>${h.slice(0, 14)}…</code>). That shows the file is unchanged since it was recorded, not that it is genuine.`
        : `<span class="badge warn">No match</span> <b>${esc(f.name)}</b> (fingerprint <code>${h.slice(0, 14)}…</code>) is not one of the ${ev.length} fingerprint${ev.length === 1 ? "" : "s"} recorded on this case. It may be a different or edited file.`;
    };
    box.querySelector("#dzf").onchange = e => check(e.target.files[0]);
    ["dragenter", "dragover"].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", e => check(e.dataTransfer && e.dataTransfer.files[0]));
  }
  // A ready-to-send invitation: the page link already identifies the case or agreement, and the other side's role is read from the chain when they connect.
  function inviteCard(id, text, note) {
    return `<div class="card invite" data-invite="${id}"><h3>Invite the other side</h3><p class="small mute">${note}</p><textarea id="invtxt" rows="4" readonly>${esc(text)}</textarea><div class="row"><button class="btn small" id="invcp" type="button">Copy invite</button></div></div>`;
  }
  function bindInvite() { const b = $("#invcp"); if (b) b.onclick = async () => { const t = $("#invtxt").value; try { await navigator.clipboard.writeText(t); b.textContent = "Copied"; setTimeout(() => b.textContent = "Copy invite", 1500); } catch { $("#invtxt").select(); } }; }

  // ---------- cases: open ----------
  async function list() {
    if (!deployed()) { upgrading("Settle a disagreement"); return; }
    const opts = (vals, def) => vals.map(([d, label]) => `<option value="${d}"${d === def ? " selected" : ""}>${label}</option>`).join(""), days = [[1, "1 day"], [3, "3 days"], [7, "7 days"], [14, "14 days"], [30, "30 days"]];
    main.innerHTML = `<h1>Settle a disagreement</h1><p class="lede">Both sides answer the same questions. Where they agree, the answer stands. Only the questions they disagree on go to a neutral reviewer, and the published rules give the result. A case nobody finishes in time ends with no decision. Best of all, <a href="#agree">agree on the rules before there is a dispute</a>.</p>
      <div class="card"><h3>Under an agreement</h3><p class="small">If you both accepted an agreement, open the case from the agreement page: the rules, the reviewer and the time limits are already fixed.</p><div class="row"><input id="agn" type="number" min="1" placeholder="Agreement number" style="width:180px"><button class="btn ghost" id="aggo" type="button">Open the agreement</button></div></div>
      <div class="card"><h3>Without an agreement</h3>
        <div class="row"><label>Rule set <select id="rs"><option value="1">Warranty claims (published)</option></select></label></div>
        <div class="wide"><label><span>Decider (the business or repair centre)</span><input id="dec" type="text" placeholder="0x…" autocomplete="off"></label></div>
        <div class="wide"><label><span>Proposed reviewer (the decider must accept)</span><input id="rev" type="text" placeholder="0x…" autocomplete="off"></label></div>
        <div class="row"><label>Time to answer <select id="aw">${opts(days, 7)}</select></label><label>Time for the reviewer <select id="rw">${opts(days, 7)}</select></label></div>
        <div class="wide"><label><span>Evidence note, optional</span><input id="evd" type="text" placeholder="e.g. the repair centre report reference"></label></div>
        <p class="small mute">Only a fingerprint of the evidence note goes on-chain. You are the filer, and your wallet accepts the reviewer by opening the case. The reviewer must be a different person from both sides.</p>
        <div class="row"><button class="btn" id="open" type="button">Open case</button><span id="msg" class="small"></span></div></div>
      <div class="card"><h3>Look up a case</h3><div class="row"><input id="cn" type="number" min="1" placeholder="Case number" style="width:150px"><button class="btn ghost" id="lk" type="button">Open</button></div><div id="recent" class="small mute"></div><p class="small"><a href="#reviewer">Reviewer records</a> · <a href="#agree">Agreements</a></p></div>`;
    $("#lk").onclick = () => { const n = Number($("#cn").value); if (n) location.hash = "#case/" + n; };
    $("#aggo").onclick = () => { const n = Number($("#agn").value); if (n) location.hash = "#agreement/" + n; };
    $("#open").onclick = async () => {
      const msg = $("#msg"), dec = $("#dec").value.trim(), rev = $("#rev").value.trim();
      if (!ADDR.test(dec) || !ADDR.test(rev)) { msg.innerHTML = `<span class="err">Enter the decider's and the reviewer's wallet addresses.</span>`; return; }
      try {
        msg.textContent = "Confirm in your wallet…"; await window.TB_WALLET.connect();
        const ev = $("#evd").value.trim(), hash = ev ? await hashText(ev) : "0x" + "0".repeat(64);
        const rc = await send(SEL.open + w($("#rs").value) + addrW(dec) + addrW(rev) + hash.slice(2) + w(Number($("#aw").value) * DAY) + w(Number($("#rw").value) * DAY));
        location.hash = "#case/" + Number(BigInt(rc.logs.find(l => l.address.toLowerCase() === CFG.caseContract.toLowerCase() && l.topics[0] === OPENED).topics[1]));
      } catch (e) { msg.innerHTML = `<span class="err">${esc(friendly(e))}</span>`; }
    };
    try { const n = Number(BigInt(await call(SEL.count))); $("#recent").textContent = n ? `${n} case${n === 1 ? "" : "s"} so far. Latest: ` : "No cases yet."; if (n) { const a = document.createElement("a"); a.href = "#case/" + n; a.textContent = "#" + n; $("#recent").appendChild(a); } } catch {}
  }

  // ---------- agreements ----------
  async function agreements() {
    if (!deployed()) { upgrading("Agreements"); return; }
    const days = [[1, "1 day"], [3, "3 days"], [7, "7 days"], [14, "14 days"], [30, "30 days"]], opts = def => days.map(([d, l]) => `<option value="${d}"${d === def ? " selected" : ""}>${l}</option>`).join("");
    main.innerHTML = `<h1>Agree on the rules before there is a dispute</h1><p class="lede">Two parties accept one published rule set, one neutral reviewer and the time limits, together with a fingerprint of their written terms. Once accepted it can never be changed or withdrawn, so neither side can swap the rules or the reviewer halfway through. If a disagreement comes, either side opens a case under the agreement.</p>
      <div class="card"><h3>Propose an agreement</h3>
        <div class="row"><label>Rules <select id="rs"><option value="1">Warranty claims (published)</option></select></label></div>
        <div class="wide"><label><span>The other party</span><input id="cp" type="text" placeholder="0x…" autocomplete="off"></label></div>
        <div class="wide"><label><span>Neutral reviewer</span><input id="rv" type="text" placeholder="0x… (not you and not the other party)" autocomplete="off"></label></div>
        <div class="row"><label>Time to answer after a dispute starts <select id="aw">${opts(7)}</select></label><label>Time for the reviewer <select id="rw">${opts(7)}</select></label></div>
        <div class="wide"><label><span>Your written terms (optional)</span><textarea id="terms" rows="4" placeholder="Paste the agreement text. Only its fingerprint goes on-chain; keep the text yourselves."></textarea></label></div>
        <p class="small mute">Your wallet proposes; the other party's wallet accepts. Nothing is held in escrow.</p>
        <div class="row"><button class="btn" id="prop" type="button">Propose the agreement</button><span id="msg" class="small"></span></div></div>
      <div class="card"><h3>Your customer has no wallet?</h3><p class="small">Invite them by passkey instead: they approve with their fingerprint or face, and you submit it. <a href="#pk/agree">Invite a customer by passkey</a>.</p></div>
      <div class="card"><h3>Look up an agreement</h3><div class="row"><input id="agn" type="number" min="1" placeholder="Agreement number" style="width:180px"><button class="btn ghost" id="aggo" type="button">Open</button></div><div id="recent" class="small mute"></div></div>`;
    $("#aggo").onclick = () => { const n = Number($("#agn").value); if (n) location.hash = "#agreement/" + n; };
    $("#prop").onclick = async () => {
      const msg = $("#msg"), cp = $("#cp").value.trim(), rv = $("#rv").value.trim();
      if (!ADDR.test(cp) || !ADDR.test(rv)) { msg.innerHTML = `<span class="err">Enter the other party's and the reviewer's wallet addresses.</span>`; return; }
      try {
        msg.textContent = "Confirm in your wallet…"; await window.TB_WALLET.connect();
        const terms = $("#terms").value.trim(), hash = terms ? await hashText(terms) : "0x" + "0".repeat(64);
        const rc = await asend(ASEL.propose + addrW(cp) + w($("#rs").value) + hash.slice(2) + addrW(rv) + w(Number($("#aw").value) * DAY) + w(Number($("#rw").value) * DAY));
        location.hash = "#agreement/" + Number(BigInt(rc.logs.find(l => l.address.toLowerCase() === CFG.agreements.toLowerCase() && l.topics[0] === AG_PROPOSED).topics[1]));
      } catch (e) { msg.innerHTML = `<span class="err">${esc(friendly(e))}</span>`; }
    };
    try { const n = Number(BigInt(await acall(ASEL.count))); $("#recent").textContent = n ? `${n} agreement${n === 1 ? "" : "s"} so far. Latest: ` : "No agreements yet."; if (n) { const a = document.createElement("a"); a.href = "#agreement/" + n; a.textContent = "#" + n; $("#recent").appendChild(a); } } catch {}
  }

  async function agreement(id) {
    if (!deployed()) { upgrading("Agreement"); return; }
    main.innerHTML = `<h1>Agreement #${esc(id)}</h1><p class="mute">Reading from X Layer…</p>`;
    let a; try { a = decodeAgreement(await acall(ASEL.get + w(id))); } catch { main.innerHTML = `<h1>Agreement #${esc(id)}</h1><p class="err">That agreement doesn't exist, or X Layer could not be reached.</p><p><a href="#agree">Back</a></p>`; return; }
    const K = policyOf(a.ruleSetId), me = window.TB_WALLET.account(), is = x => !!(me && x.toLowerCase() === me), isProp = is(a.proposer), isCp = is(a.counterparty);
    const inForce = a.acceptedAt !== 0 && !a.cancelled, state = a.cancelled ? "Withdrawn" : inForce ? "In force since " + when(a.acceptedAt) : "Proposed, waiting for the other party";
    main.innerHTML = `<h1>Agreement #${id}</h1><p><span class="badge${inForce ? " ok" : a.cancelled ? " warn" : ""}">${esc(state)}</span></p>
      <div class="card"><table style="font-size:15px;border-collapse:collapse"><tbody>
        <tr><td>Proposed by</td><td><code>${a.proposer}</code>${isProp ? " (you)" : ""}</td></tr><tr><td>Other party</td><td><code>${a.counterparty}</code>${isCp ? " (you)" : ""}</td></tr>
        <tr><td>Rules</td><td>${K ? `<a href="#check/${K.key}">${esc(K.policy.name)}</a>` : "Rule set " + a.ruleSetId} (rule set #${a.ruleSetId})</td></tr>
        <tr><td>Neutral reviewer</td><td><a href="#reviewer/${a.reviewer}">${short(a.reviewer)}</a>, agreed in advance</td></tr>
        <tr><td>Time limits</td><td>${a.answerWindow / DAY} day(s) to answer, then ${a.reviewWindow / DAY} day(s) for the reviewer</td></tr>
        <tr><td>Terms fingerprint</td><td><code>${a.termsHash}</code>${/^0x0+$/.test(a.termsHash) ? " (no terms text was recorded)" : ""}</td></tr></tbody></table></div>
      ${!inForce && !a.cancelled ? `<div class="note${isCp ? " ok-note" : ""}">${isCp ? "<b>You have been invited to accept this agreement.</b> Read the terms below, then use the button at the bottom." : !me ? `If you were invited to accept this, connect the wallet for <code>${short(a.counterparty)}</code> at the bottom of the page.` : ""}</div>` : ""}
      ${!inForce && !a.cancelled && !isCp ? inviteCard("a" + id, `I have proposed an agreement on LGtie for you to accept: ${location.href.split("#")[0]}#agreement/${id}\nOpen it, connect the wallet ${a.counterparty} and click "Accept this agreement". Rules: ${K ? K.policy.name : "rule set " + a.ruleSetId}. You have ${a.answerWindow / DAY} day(s) to answer after a dispute starts. Nothing is held in escrow and accepting costs only a small network fee.`, "Send this to the other party. They open the link, connect their wallet and accept.") : ""}
      <div class="card"><h3>Check the written terms</h3><p class="small">Paste the terms text to see whether it is exactly what was agreed.</p><textarea id="tt" rows="3" placeholder="Paste the agreement text"></textarea><div class="row"><span id="tm" class="small"></span></div></div>
      <div id="acts"></div>`;
    bindInvite();
    let t = 0; $("#tt").oninput = () => { clearTimeout(t); t = setTimeout(async () => { const v = $("#tt").value.trim(), m = $("#tm"); if (!v) { m.textContent = ""; return; } const h = await hashText(v); if (h === a.termsHash) { m.className = "small ok"; m.textContent = "✓ This text matches the agreed terms."; } else { m.className = "small err"; m.textContent = "This text does not match the agreed terms."; } }, 250); };
    const acts = $("#acts"), say = (h) => { acts.innerHTML = h; };
    if (!me) { say(`<div class="row"><button class="btn" id="cw" type="button">Connect wallet</button><span class="small mute">to accept, withdraw or open a case</span></div>`); $("#cw").onclick = async () => { try { await window.TB_WALLET.connect(); agreement(id); } catch (e) { $("#cw").insertAdjacentHTML("afterend", `<span class="err small"> ${esc(friendly(e))}</span>`); } }; return; }
    const buttons = [];
    if (!inForce && !a.cancelled && isCp) buttons.push(`<button class="btn" id="acc" type="button">Accept this agreement</button>`);
    if (!inForce && !a.cancelled && isProp) buttons.push(`<button class="btn ghost" id="wd" type="button">Withdraw the proposal</button>`);
    if (inForce && (isProp || isCp)) buttons.push(`<button class="btn" id="odp" type="button">Open a dispute under this agreement</button>`);
    say(`<div class="card"><div class="row">${buttons.join("") || `<span class="mute">Nothing for your wallet to do on this agreement.</span>`}<span id="am" class="small err"></span></div>${inForce ? `<p class="small mute">An accepted agreement can't be changed or withdrawn. To change anything, make a new agreement.</p>` : ""}</div>`);
    const run = async (fn, then) => { try { await fn(); then(); } catch (e) { $("#am").textContent = friendly(e); } };
    if ($("#acc")) $("#acc").onclick = () => run(() => asend(ASEL.accept + w(id)), () => agreement(id));
    if ($("#wd")) $("#wd").onclick = () => run(() => asend(ASEL.cancel + w(id)), () => agreement(id));
    if ($("#odp")) $("#odp").onclick = () => run(async () => { const rc = await send(SEL.openAg + w(id) + "0".repeat(64)); location.hash = "#case/" + Number(BigInt(rc.logs.find(l => l.address.toLowerCase() === CFG.caseContract.toLowerCase() && l.topics[0] === OPENED).topics[1])); }, () => {});
  }

  // ---------- case page ----------
  async function view(id) {
    if (!deployed()) { upgrading("Case #" + id); return; }
    main.innerHTML = `<h1>Case #${esc(id)}</h1><p class="mute">Reading from X Layer…</p>`;
    let c, now, ev = []; try {
      c = decodeCase(await call(SEL.get + w(id))); now = Number(BigInt((await rpc("eth_getBlockByNumber", ["latest", false])).timestamp));
      const n = Number(BigInt(await call(SEL.evCount + w(id)))); ev = await Promise.all(Array.from({length: n}, (_, i) => call(SEL.evAt + w(id) + w(i)).then(decodeEvidence)));
    } catch (e) { main.innerHTML = `<h1>Case #${esc(id)}</h1><p class="err">That case doesn't exist, or X Layer could not be reached.</p><p><a href="#case">Back</a></p>`; return; }
    const K = policyOf(c.ruleSetId); if (!K) { main.innerHTML = `<h1>Case #${esc(id)}</h1><p>This case uses rule set ${c.ruleSetId}, which this page does not know how to display.</p>`; return; }
    const P = K.policy, nQ = P.questions.length, me = window.TB_WALLET.account(), is = a => !!(me && a !== "0x0000000000000000000000000000000000000000" && a.toLowerCase() === me);
    const isFiler = is(c.filer), isDecider = is(c.decider), isReviewer = is(c.reviewer), asFiler = isFiler || is(c.filerOp), asDecider = isDecider || is(c.deciderOp), isParty = asFiler || asDecider;
    const fa = bitsToArr(c.filerAnswers, nQ), da = bitsToArr(c.deciderAnswers, nQ), dis = bitsToArr(c.disputed, nQ), fin = bitsToArr(c.finalAnswers, nQ), yn = v => v ? "Yes" : "No";
    const live = c.status === 0 || c.status === 1, deadline = c.status === 0 ? c.answerBy : c.status === 1 ? c.reviewBy : 0, late = live && now > deadline, agreed = c.filerOk && c.deciderOk;
    const rows = P.questions.map((q, i) => { const both = c.filerIn && c.deciderIn; let tag = ""; if (both) tag = dis[i] ? `<span class="badge warn">Disputed</span>` : `<span class="badge ok">Agreed</span>`;
      const n = ev.filter(e => e.question === i).length; return `<tr><td>${i + 1}. ${esc(q.text)}${n ? ` <span class="badge">${n} evidence</span>` : ""}</td><td>${c.filerIn ? yn(fa[i]) : "…"}</td><td>${c.deciderIn ? yn(da[i]) : "…"}</td><td>${tag}${c.status === 2 && dis[i] ? ` Reviewer: <b>${yn(fin[i])}</b>` : ""}</td></tr>`; }).join("");
    const ok = v => v ? "accepted ✓" : "not yet", helper = a => /^0x0+$/.test(a) ? "none" : short(a);
    const qlabel = q => q === WHOLE ? "The whole case" : (q + 1) + ". " + (P.questions[q] ? P.questions[q].text.slice(0, 60) : "?");
    main.innerHTML = `<h1>Case #${id}: ${esc(P.name)}</h1>
      <p><span class="badge${c.status === 3 ? " warn" : ""}">${STATUS[c.status]}</span> <span class="small mute">Filer ${short(c.filer)} · Decider ${short(c.decider)}${c.agreementId ? ` · <a href="#agreement/${c.agreementId}">Agreement #${c.agreementId}</a>` : " · no agreement"}${me ? " · You are " + short(me) : ""}</span></p>
      ${live ? `<p class="small ${late ? "err" : "mute"}">${c.status === 0 ? "Answers due by " : "The reviewer has until "}${when(deadline)}${late ? ". That time has passed." : "."}</p>` : ""}
      <div class="card" style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:15px"><thead><tr style="text-align:left"><th>Question</th><th>Filer</th><th>Decider</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="card"><h3>Reviewer</h3><p class="small"><a href="#reviewer/${c.reviewer}">${short(c.reviewer)}</a> (<a href="#reviewer/${c.reviewer}">record</a>): filer ${ok(c.filerOk)}, decider ${ok(c.deciderOk)}. ${c.agreementId ? "Agreed in advance under the agreement. " : ""}${live ? (agreed ? "Both sides accepted this reviewer." : "The reviewer can't decide anything until both sides accept.") : ""}</p><div id="rv"></div></div>
      <div class="card"><h3>Evidence</h3><p class="small mute">Only fingerprints are recorded here. Nothing is uploaded: the files stay with the people who share them, and the reviewer checks what they receive against the fingerprint. A fingerprint shows a file hasn't changed since; it does not show the file is genuine.</p>
        ${ev.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="text-align:left"><th>About</th><th>By</th><th>Note</th><th>Fingerprint</th></tr></thead><tbody>${ev.map(e => `<tr class="evrow" data-h="${e.hash}"><td>${esc(qlabel(e.question))}</td><td>${short(e.by)}</td><td>${esc(e.note)}</td><td><code>${e.hash.slice(0, 12)}…</code></td></tr>`).join("")}</tbody></table>` : `<p class="mute">No evidence recorded yet.</p>`}
        <div id="fchk"></div><div id="evform"></div></div>
      ${live && (isParty) ? inviteCard("c" + id, `Case #${id} on LGtie (${P.name}): ${location.href.split("#")[0]}#case/${id}\nOpen it, connect your wallet and answer the ${nQ} questions${deadline ? " before " + when(deadline) : ""}. Only the answers that differ go to the reviewer. Nothing is held in escrow.`, "Send this to the other side or the reviewer so they can open the case and connect their wallet.") : ""}
      <div id="helpers"></div><div id="act"></div><div id="final"></div>`;
    mountFileCheck($("#fchk"), ev, qlabel); bindInvite();
    // ----- reviewer controls (cases without an agreement, or any case where a side wants to propose another reviewer)
    if (live && !late) {
      const rv = $("#rv");
      if (!me) rv.innerHTML = `<button class="btn small" id="cw" type="button">Connect wallet</button> <span class="small mute">to answer, add evidence, or review</span>`;
      else if (isParty) {
        const needF = asFiler && !c.filerOk, needD = asDecider && !c.deciderOk, needs = needF ? true : needD ? false : null;
        rv.innerHTML = `${needs !== null ? `<div class="row"><button class="btn small" id="acc" type="button">Accept this reviewer</button></div>` : ""}${c.agreementId ? "" : `<div class="row"><input id="newrev" type="text" placeholder="Propose a different reviewer: 0x…" style="width:min(380px,100%)" autocomplete="off"><button class="btn small ghost" id="prop" type="button">Propose</button></div>`}<span id="rmsg" class="small err"></span>`;
        const forF = asFiler && (!asDecider || needF);
        if (needs !== null) $("#acc").onclick = async () => { try { await send(SEL.approve + w(id) + w(needs ? 1 : 0)); view(id); } catch (e) { $("#rmsg").textContent = friendly(e); } };
        if ($("#prop")) $("#prop").onclick = async () => { const a = $("#newrev").value.trim(); if (!ADDR.test(a)) { $("#rmsg").textContent = "Enter a wallet address."; return; } try { await send(SEL.propose + w(id) + w(forF ? 1 : 0) + addrW(a)); view(id); } catch (e) { $("#rmsg").textContent = friendly(e); } };
      } else rv.innerHTML = `<span class="small mute">Only the two sides can change the reviewer.</span>`;
    }
    // ----- evidence form: sides, their helpers and the reviewer, until the deadline
    if (live && !late && me && (isParty || isReviewer)) {
      $("#evform").innerHTML = `<h4>Add evidence</h4><p class="small mute">Pick a photo or file to fingerprint it. <b>It is not uploaded anywhere.</b> Your browser works out a fingerprint here, and only that fingerprint and the short note go on X Layer. Keep the file yourself and send it to the other side and the reviewer directly. Anyone can later check that a file they were sent matches the fingerprint.</p><div class="row"><label>About <select id="evq"><option value="${WHOLE}">The whole case</option>${P.questions.map((q, i) => `<option value="${i}">${i + 1}. ${esc(q.text.slice(0, 50))}</option>`).join("")}</select></label></div>
        <div class="row"><input id="evf" type="file"><span id="evh" class="small mute"></span></div><div class="wide"><label><span>Note</span><input id="evn" type="text" maxlength="60" placeholder="Short public label. Don't put names or personal details here."></label></div>
        <div class="row"><button class="btn small" id="evgo" type="button" disabled>Record the fingerprint on X Layer</button><span id="evm" class="small err"></span></div>`;
      let hash = null; $("#evf").onchange = async () => { const f = $("#evf").files[0]; if (!f) return; hash = await hashFile(f); $("#evh").textContent = "Fingerprint " + hash.slice(0, 14) + "… (the file never leaves your browser)"; $("#evgo").disabled = false; };
      $("#evgo").onclick = async () => { const bytes = new TextEncoder().encode($("#evn").value.slice(0, 60)), nh = [...bytes].map(b => b.toString(16).padStart(2, "0")).join(""); try { await send(SEL.evidence + w(id) + w($("#evq").value) + hash.slice(2) + w(128) + w(bytes.length) + nh.padEnd(Math.ceil(bytes.length / 32) * 64, "0")); view(id); } catch (e) { $("#evm").textContent = friendly(e); } };
    }
    // ----- helpers (optional): a side can let ONE other wallet act only for that side
    if (live && !late && me && (isFiler || isDecider)) {
      const forFiler = isFiler, cur = forFiler ? c.filerOp : c.deciderOp;
      $("#helpers").innerHTML = `<div class="card"><h4>Helper (optional)</h4><p class="small mute">You can let one other wallet, such as a staff member, act for you only. It can never act for the other side. Current helper: ${helper(cur)}.</p><div class="row"><input id="hop" type="text" placeholder="Helper wallet 0x…" style="width:min(380px,100%)" autocomplete="off"><button class="btn small ghost" id="hset" type="button">Set</button>${/^0x0+$/.test(cur) ? "" : `<button class="btn small ghost" id="hclr" type="button">Remove</button>`}<span id="hmsg" class="small err"></span></div></div>`;
      $("#hset").onclick = async () => { const a = $("#hop").value.trim(); if (!ADDR.test(a)) { $("#hmsg").textContent = "Enter a wallet address."; return; } try { await send(SEL.setOp + w(id) + w(forFiler ? 1 : 0) + addrW(a)); view(id); } catch (e) { $("#hmsg").textContent = friendly(e); } };
      if ($("#hclr")) $("#hclr").onclick = async () => { try { await send(SEL.setOp + w(id) + w(forFiler ? 1 : 0) + "0".repeat(64)); view(id); } catch (e) { $("#hmsg").textContent = friendly(e); } };
    }
    const cw = $("#cw"); if (cw) cw.onclick = async () => { try { await window.TB_WALLET.connect(); view(id); } catch (e) { cw.insertAdjacentHTML("afterend", `<span class="err small"> ${esc(friendly(e))}</span>`); } };
    $("#act").innerHTML = actions();
    function actions() {
      if (!live) return "";
      if (late) return `<div class="note">The deadline has passed. Anyone can close this case. It will end with no decision, and nobody wins by default.<div class="row"><button class="btn" id="closeit" type="button">Close this case</button><span id="cmsg" class="small err"></span></div></div>`;
      const parts = [];
      if (c.status === 0) {
        if (asFiler && !c.filerIn) parts.push(form("filer", "Your answers as the filer"));
        if (asDecider && !c.deciderIn) parts.push(form("decider", "Your answers as the decider"));
        if (!parts.length && me) parts.push(`<p class="mute">Nothing for your wallet to do on this case right now.</p>`);
      } else if (c.status === 1) {
        if (isReviewer && agreed) parts.push(form("review", "Your decision on the disputed questions only", dis));
        else if (isReviewer && !agreed) parts.push(`<p class="mute">Both sides have to accept you as the reviewer before you can decide.</p>`);
        else if (me) parts.push(`<p class="mute">Waiting for the reviewer to answer the disputed questions.</p>`);
      }
      return parts.join("");
    }
    function form(kind, title, only) {
      const items = P.questions.map((q, i) => (only && !only[i]) ? "" : `<div class="q"><div class="t">${i + 1}. ${esc(q.text)}</div>${q.hint ? `<div class="h">Evidence: ${esc(q.hint)}</div>` : ""}<div class="yn" data-i="${i}"><button type="button" data-v="1" aria-pressed="false">Yes</button><button type="button" data-v="0" aria-pressed="false">No</button></div></div>`).join("");
      return `<div class="card" data-form="${kind}"><h3>${title}</h3>${items}<div class="row"><button class="btn" data-send="${kind}" type="button">Send to X Layer</button><span class="small err" data-msg></span></div></div>`;
    }
    document.querySelectorAll("[data-form]").forEach(f => {
      const vals = {}; f.querySelectorAll(".yn").forEach(g => g.querySelectorAll("button").forEach(b => b.onclick = () => { vals[g.dataset.i] = b.dataset.v === "1"; g.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String((x.dataset.v === "1") === vals[g.dataset.i]))); }));
      f.querySelector("[data-send]").onclick = async () => {
        const kind = f.dataset.form, need = [...f.querySelectorAll(".yn")].map(g => Number(g.dataset.i)), msg = f.querySelector("[data-msg]");
        if (need.some(i => vals[i] === undefined)) { msg.textContent = "Answer every question shown."; return; }
        const bits = need.reduce((acc, i) => acc + (vals[i] ? 1n << BigInt(i) : 0n), 0n);
        try { msg.textContent = "Confirm in your wallet…"; msg.className = "small mute";
          await send(kind === "review" ? SEL.review + w(id) + w(bits) : SEL.submit + w(id) + w(kind === "filer" ? 1 : 0) + w(bits)); view(id);
        } catch (e) { msg.className = "small err"; msg.textContent = friendly(e); }
      };
    });
    const ci = $("#closeit"); if (ci) ci.onclick = async () => { try { if (!me) await window.TB_WALLET.connect(); await send(SEL.expire + w(id)); view(id); } catch (e) { $("#cmsg").textContent = friendly(e); } };
    if (c.status === 3) $("#final").innerHTML = `<div class="res nodec" role="status"><div class="big">No decision</div><div class="why">${c.filerIn && c.deciderIn ? "The reviewer did not decide in time." : "The answers were not all in on time."} Nobody wins by default. The two sides can open a new case.</div></div>`;
    if (c.status === 2) {
      const r = TB.run(P, fin);
      $("#final").innerHTML = `<div class="res" role="status"><div class="big">${esc(P.results[c.result])}</div><div class="why">${esc(r.why)}</div><div class="row"><span class="badge" id="rp">Re-running the published rules on X Layer…</span><button class="btn small ghost" id="cl" type="button">Copy link</button><a class="btn small ghost" href="#receipt/${id}">Receipt</a></div>
        <p class="small">Final answers: ${P.questions.map((q, i) => (i + 1) + "=" + (fin[i] ? "yes" : "no")).join(", ")}. Rule set ${c.ruleSetId}, circuit #${CFG.published[K.key].circuitId}. ${c.disputed ? "The reviewer decided " + bitsToArr(c.disputed, nQ).filter(Boolean).length + " disputed question(s); everything else was agreed." : "Both sides agreed on every question."}</p>
        <p class="small mute">Other contracts can read this verdict (result number ${c.result}) from the case contract, for example to release a payment.</p></div>`;
      $("#cl").onclick = async e => { try { await navigator.clipboard.writeText(location.href); e.target.textContent = "Copied"; } catch { prompt("Copy:", location.href); } };
      call(SEL.replay + w(id)).then(h => { const {N} = dec(h), re = Number(N(0)), same = N(2) === 1n, b = $("#rp");
        if (same && re === c.result && re === r.result) { b.className = "badge ok"; b.textContent = "✓ Re-run just now by the TapeOut processor: same result"; } else { b.className = "badge warn"; b.textContent = "The re-run gave a different result. Do not rely on this page."; } })
        .catch(() => { const b = $("#rp"); b.className = "badge warn"; b.textContent = "Could not re-run on X Layer right now"; });
    }
  }

  // ---------- a decided case as a one-page receipt (print or save as PDF), and a short summary for the home page ----------
  async function readCase(id) {
    const c = decodeCase(await call(SEL.get + w(id))), n = Number(BigInt(await call(SEL.evCount + w(id))));
    const ev = await Promise.all(Array.from({length: n}, (_, i) => call(SEL.evAt + w(id) + w(i)).then(decodeEvidence)));
    return {c, ev};
  }
  async function summary(id) {
    const {c} = await readCase(id), K = policyOf(c.ruleSetId); if (!K) throw new Error("unknown rule set");
    const P = K.policy, nQ = P.questions.length, dis = bitsToArr(c.disputed, nQ).filter(Boolean).length, fin = bitsToArr(c.finalAnswers, nQ);
    return {id, status: c.status, statusText: STATUS[c.status], name: P.name, nQ, nDisputed: dis, agreementId: c.agreementId, result: c.status === 2 ? P.results[c.result] : null, why: c.status === 2 ? TB.run(P, fin).why : ""};
  }
  async function receipt(id) {
    if (!deployed()) { upgrading("Receipt"); return; }
    main.innerHTML = `<h1>Receipt</h1><p class="mute">Reading from X Layer…</p>`;
    let c, ev; try { ({c, ev} = await readCase(id)); } catch { main.innerHTML = `<h1>Receipt</h1><p class="err">That case doesn't exist, or X Layer could not be reached.</p><p><a href="#case">Back</a></p>`; return; }
    const K = policyOf(c.ruleSetId); if (!K) { main.innerHTML = `<h1>Receipt</h1><p>This case uses a rule set this page does not know how to display.</p>`; return; }
    if (c.status !== 2) { main.innerHTML = `<h1>Receipt for case #${esc(id)}</h1><div class="note">This case is <b>${STATUS[c.status].toLowerCase()}</b>, so there is no result to print yet.</div><p><a href="#case/${esc(id)}">Back to the case</a></p>`; return; }
    const P = K.policy, nQ = P.questions.length, fa = bitsToArr(c.filerAnswers, nQ), da = bitsToArr(c.deciderAnswers, nQ), dis = bitsToArr(c.disputed, nQ), fin = bitsToArr(c.finalAnswers, nQ), yn = v => v ? "Yes" : "No";
    const r = TB.run(P, fin), cond = k => `question ${k.q + 1} is ${k.yes ? "yes" : "no"}`, fired = r.ruleIndex >= 0 ? `Rule ${r.ruleIndex + 1} decided it: ${P.rules[r.ruleIndex].conds.map(cond).join(" and ")}.` : "No rule matched, so the default result applied.";
    const rows = P.questions.map((q, i) => `<tr><td>${i + 1}. ${esc(q.text)}</td><td>${yn(fa[i])}</td><td>${yn(da[i])}</td><td><b>${yn(fin[i])}</b></td><td>${dis[i] ? "Reviewer" : "Both agreed"}</td></tr>`).join("");
    const ex = (kind, a) => `${CFG.explorer}/${kind}/${a}`, link = location.href.split("#")[0] + "#case/" + id;
    main.innerHTML = `<article class="receipt" id="rc">
      <div class="rhead"><span class="rbrand"><svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="7" fill="#111"/><path d="M6.5 6.5h5a5.5 5.5 0 010 11h-5z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><circle cx="19.2" cy="12" r="1.5" fill="none" stroke="#fff" stroke-width="1.5"/></svg>LGtie</span><span class="small mute">Result receipt · case #${esc(id)}</span></div>
      <p class="small mute rk">${esc(P.name)}</p><h1 class="rres">${esc(P.results[c.result])}</h1><p class="rwhy">${esc(r.why)}</p><p class="small mute">${esc(fired)}</p>
      <table class="rt"><thead><tr><th>Question</th><th>Filer</th><th>Decider</th><th>Final</th><th>Settled by</th></tr></thead><tbody>${rows}</tbody></table>
      <dl class="rd"><dt>Filer</dt><dd><code>${c.filer}</code></dd><dt>Decider</dt><dd><code>${c.decider}</code></dd><dt>Reviewer</dt><dd><code>${c.reviewer}</code></dd>
        <dt>Agreement</dt><dd>${c.agreementId ? "#" + c.agreementId + " (rules, reviewer and time limits fixed in advance)" : "none"}</dd><dt>Opened</dt><dd>${when(c.openedAt)}</dd>
        <dt>Rule set</dt><dd>#${c.ruleSetId} · circuit #${CFG.published[K.key].circuitId} on the TapeOut processor</dd></dl>
      ${ev.length ? `<h4>Evidence fingerprints</h4><table class="rt"><tbody>${ev.map(e => `<tr class="evrow" data-h="${e.hash}"><td>${esc(e.question === WHOLE ? "The whole case" : (e.question + 1) + ". " + (P.questions[e.question] ? P.questions[e.question].text.slice(0, 50) : "?"))}</td><td>${esc(e.note)}</td><td><code>${e.hash.slice(0, 18)}…</code></td></tr>`).join("")}</tbody></table><p class="small mute">The files are not stored by LGtie. Each fingerprint shows a file hasn't changed since it was recorded.</p>` : ""}
      <div id="fchk" class="noprint"></div>
      <div class="rver"><span class="badge" id="rp">Re-running the published rules on X Layer…</span><p class="small">Check it yourself: open <a href="${link}">${link}</a> or read case ${esc(id)} on the <a href="${ex("address", CFG.caseContract)}" target="_blank" rel="noopener">case contract</a>. The re-run is a free read of the rules published on X Layer.</p></div>
      <p class="small mute rfine">This receipt shows how published rules applied to the answers given. It does not prove the answers are true, and it is not legal advice. LGtie holds no funds and is an unaudited prototype.</p></article>
      <div class="row noprint"><button class="btn" id="prt" type="button">Print or save as PDF</button><a class="btn ghost" href="#case/${esc(id)}">Back to the case</a></div>`;
    $("#prt").onclick = () => window.print(); mountFileCheck($("#fchk"), ev, q => q === WHOLE ? "the whole case" : "question " + (q + 1));
    call(SEL.replay + w(id)).then(h => { const {N} = dec(h), re = Number(N(0)), same = N(2) === 1n, b = $("#rp");
      if (same && re === c.result && re === r.result) { b.className = "badge ok"; b.textContent = "✓ Re-run just now by the TapeOut processor: same result"; } else { b.className = "badge warn"; b.textContent = "The re-run gave a different result. Do not rely on this receipt."; } })
      .catch(() => { const b = $("#rp"); if (b) { b.className = "badge warn"; b.textContent = "Could not re-run on X Layer right now"; } });
  }

  // ---------- records read from the chain (activity, not correctness) ----------
  async function scanCases(limit) {
    const n = Number(BigInt(await call(SEL.count))), out = [], lo = Math.max(1, n - limit + 1);
    for (let i = n; i >= lo; i -= 10) { const ids = []; for (let k = i; k > i - 10 && k >= lo; k--) ids.push(k);
      (await Promise.all(ids.map(id => call(SEL.get + w(id)).then(h => ({id, ...decodeCase(h)}), () => null)))).forEach(c => c && out.push(c)); }
    return {total: n, cases: out, truncated: n > limit};
  }
  function classify(c) { if (c.status === 2) return c.disputed !== 0n ? "decided" : "notNeeded"; if (c.status === 3) return (c.filerIn && c.deciderIn) ? ((c.filerOk && c.deciderOk) ? "ghosted" : "neverAccepted") : "beforeReview"; return "pending"; }
  const LABEL = {decided: "Decided the disputed questions", ghosted: "Named by both sides; no decision in time (the reviewer's own consent is not recorded)", neverAccepted: "Not accepted by both sides before time ran out", pending: "Still open", notNeeded: "Not needed (both sides agreed)", beforeReview: "Case expired before it reached the reviewer"};
  const tally = cs => { const t = {decided: 0, ghosted: 0, neverAccepted: 0, pending: 0, notNeeded: 0, beforeReview: 0}; cs.forEach(c => t[classify(c)]++); return t; };

  async function reviewers() {
    if (!deployed()) { upgrading("Reviewers"); return; }
    main.innerHTML = `<h1>Reviewers</h1><p class="mute">Reading cases from X Layer…</p>`;
    let sc; try { sc = await scanCases(200); } catch { main.innerHTML = `<h1>Reviewers</h1><p class="err">X Layer could not be reached.</p>`; return; }
    const by = new Map(); sc.cases.forEach(c => { const k = c.reviewer.toLowerCase(); if (!by.has(k)) by.set(k, []); by.get(k).push(c); });
    const rows = [...by.entries()].map(([a, cs]) => { const t = tally(cs); return `<tr><td><a href="#reviewer/${a}">${short(a)}</a></td><td>${cs.length}</td><td>${t.decided}</td><td>${t.ghosted}</td><td>${t.neverAccepted}</td><td>${t.pending}</td></tr>`; }).join("");
    main.innerHTML = `<h1>Reviewers</h1><p class="lede">A public record of what each reviewer did on cases, read straight from X Layer. It shows who decided and who did not, not whether a decision was right. Nothing on-chain can tell that.</p>
      <div class="card" style="overflow:auto">${rows ? `<table style="width:100%;border-collapse:collapse;font-size:15px"><thead><tr style="text-align:left"><th>Reviewer</th><th>Cases</th><th>Decided</th><th>No decision in time</th><th>Never accepted</th><th>Open</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="mute">No cases yet.</p>`}</div>
      <p class="small mute">${sc.truncated ? `Showing the latest 200 of ${sc.total} cases. ` : `${sc.total} case${sc.total === 1 ? "" : "s"} read. `}A case counts for the reviewer currently named on it.</p>`;
  }
  async function reviewer(addr) {
    if (!deployed()) { upgrading("Reviewer record"); return; }
    if (!ADDR.test(addr)) { main.innerHTML = `<h1>Reviewer record</h1><p class="err">That is not a wallet address. <a href="#reviewer">See all reviewers</a>.</p>`; return; }
    main.innerHTML = `<h1>Reviewer ${short(addr)}</h1><p class="mute">Reading cases from X Layer…</p>`;
    let sc; try { sc = await scanCases(200); } catch { main.innerHTML = `<h1>Reviewer ${short(addr)}</h1><p class="err">X Layer could not be reached.</p>`; return; }
    const mine = sc.cases.filter(c => c.reviewer.toLowerCase() === addr.toLowerCase()).sort((a, b) => b.id - a.id), t = tally(mine);
    const rows = mine.map(c => { const k = classify(c), P = (policyOf(c.ruleSetId) || {}).policy; return `<tr><td><a href="#case/${c.id}">#${c.id}</a></td><td>${esc(P ? P.name : "Rule set " + c.ruleSetId)}</td><td>${LABEL[k]}</td><td>${c.status === 2 && P ? esc(P.results[c.result]) : ""}</td></tr>`; }).join("");
    main.innerHTML = `<h1>Reviewer ${short(addr)}</h1><p class="small mute"><code>${addr}</code> · <a href="#reviewer">All reviewers</a></p>
      <div class="stats"><span>${mine.length} case${mine.length === 1 ? "" : "s"}</span><span>${t.decided} decided</span><span>${t.ghosted} no decision in time</span><span>${t.neverAccepted} never accepted</span><span>${t.pending} open</span></div>
      <div class="card" style="overflow:auto">${rows ? `<table style="width:100%;border-collapse:collapse;font-size:15px"><thead><tr style="text-align:left"><th>Case</th><th>Rule set</th><th>What happened</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="mute">This address has not been named reviewer on any case yet.</p>`}</div>
      <div class="note">This is a record of activity. It cannot show whether a decision was right: only the people involved can judge that. A reviewer does not have to confirm anything on-chain before being named, so "no decision in time" can mean the reviewer was named without knowing. Both sides should still decide for themselves whether to accept a reviewer, and ask them first.</div>
      <p class="small mute">${sc.truncated ? `Based on the latest 200 of ${sc.total} cases.` : `Based on all ${sc.total} case${sc.total === 1 ? "" : "s"}.`}</p>`;
  }

  // A business's public record: the rule sets it published (and whether it replaced any) and how its cases went.
  async function business(addr) {
    if (!deployed()) { upgrading("Business record"); return; }
    if (!ADDR.test(addr)) { main.innerHTML = `<h1>Business record</h1><p class="err">That is not a wallet address.</p>`; return; }
    main.innerHTML = `<h1>Record of ${short(addr)}</h1><p class="mute">Reading from X Layer…</p>`;
    let sc, sets = []; try {
      sc = await scanCases(200);
      const n = Number(BigInt(await callAt(CFG.registry, ASEL.count))); const ids = Array.from({length: Math.min(n, 100)}, (_, i) => n - i);
      sets = (await Promise.all(ids.map(id => callAt(CFG.registry, ASEL.get + w(id)).then(h => ({id, ...decodeRuleSet(h)}), () => null)))).filter(Boolean);
    } catch { main.innerHTML = `<h1>Record of ${short(addr)}</h1><p class="err">X Layer could not be reached.</p>`; return; }
    const a = addr.toLowerCase(), mineSets = sets.filter(s => s.publisher.toLowerCase() === a).sort((x, y) => y.id - x.id);
    const asDecider = sc.cases.filter(c => c.decider.toLowerCase() === a), asFiler = sc.cases.filter(c => c.filer.toLowerCase() === a), all = [...new Set([...asDecider, ...asFiler])].sort((x, y) => y.id - x.id);
    const done = asDecider.filter(c => c.status === 2), disputed = done.filter(c => c.disputed !== 0n), expired = asDecider.filter(c => c.status === 3);
    const mix = {}; done.forEach(c => { const P = (policyOf(c.ruleSetId) || {}).policy, k = P ? P.results[c.result] : "result " + c.result; mix[k] = (mix[k] || 0) + 1; });
    const versions = mineSets.filter(s => s.previousId !== 0).length;
    main.innerHTML = `<h1>Record of ${short(addr)}</h1><p class="small mute"><code>${addr}</code></p>
      <div class="stats"><span>${mineSets.length} rule set${mineSets.length === 1 ? "" : "s"} published</span><span>${versions} replaced an earlier version</span><span>${asDecider.length} case${asDecider.length === 1 ? "" : "s"} as decider</span><span>${disputed.length} of ${done.length} decided needed a reviewer</span><span>${expired.length} ended with no decision</span></div>
      <div class="card"><h3>Rules this address published</h3>${mineSets.length ? `<table style="width:100%;border-collapse:collapse;font-size:15px"><thead><tr style="text-align:left"><th>Rule set</th><th>Published</th><th>Circuit</th><th>Replaces</th></tr></thead><tbody>${mineSets.map(s => `<tr><td>#${s.id} ${esc(s.name)}</td><td>${when(s.publishedAt)}</td><td>#${s.circuitId}</td><td>${s.previousId ? "#" + s.previousId : "first version"}</td></tr>`).join("")}</tbody></table>` : `<p class="mute">This address has not published a rule set.</p>`}<p class="small mute">Each published rule set is permanent. If a business changes its rules it has to publish a new version, and that shows here.</p></div>
      <div class="card"><h3>Cases</h3>${all.length ? `<table style="width:100%;border-collapse:collapse;font-size:15px"><thead><tr style="text-align:left"><th>Case</th><th>Role</th><th>Status</th><th>Result</th></tr></thead><tbody>${all.map(c => { const P = (policyOf(c.ruleSetId) || {}).policy; return `<tr><td><a href="#case/${c.id}">#${c.id}</a></td><td>${c.decider.toLowerCase() === a ? "decider" : "filer"}</td><td>${STATUS[c.status]}</td><td>${c.status === 2 && P ? esc(P.results[c.result]) : ""}</td></tr>`; }).join("")}</tbody></table>` : `<p class="mute">No cases involving this address yet.</p>`}
        ${Object.keys(mix).length ? `<p class="small">Results of decided cases as decider: ${Object.entries(mix).map(([k, v]) => esc(k) + " " + v).join(", ")}.</p>` : ""}</div>
      <div class="note">This is a record of activity read from the chain. It can show how often disputes happen and how they ended, not whether the business was right. Only the latest 200 cases are read.</div>`;
  }

  window.TB_CASES = {summary, receipt, list, view, reviewers, reviewer, agreements, agreement, business};
})();
