// #auto: a PREVIEW of automatic questions (docs/AUTO-QUESTIONS.md). Nothing here is enforced or published: the contracts that would enforce it do not exist yet.
// It runs the reference code in autoq.js so a rule author can see which questions the chain would answer and which would still go to a reviewer.
(function () {
  "use strict";
  const main = document.querySelector("#main"), $ = s => document.querySelector(s), A = window.TB_AUTOQ, TB = window.TB, DAY = 86400;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));

  function page(key) {
    if (/^[0-9]+$/.test(String(key || ""))) return onchain(Number(key));
    const lib = TB.LIBRARY, k = lib.some(t => t.key === key) ? key : "freelance";
    const qs = TB.parse(TB.templateText(k, true)).policy.questions, nQ = qs.length, NOW = 1_800_000_000;
    main.innerHTML = `<h1>Automatic questions <span class="badge">preview</span></h1>
      <p class="lede">Some questions do not need anyone's word: whether evidence was attached in time, or whether an on-chain value meets a threshold. A question marked <b>answered by the chain</b> is worked out by code. Neither side can answer or dispute it, and a reviewer cannot change it.</p>
      <div class="note"><b>Preview only.</b> Nothing here is published or enforced yet, and no case uses it. It shows how it would behave once the contracts for it exist. It cannot check whether evidence is true, only when it was attached or what a chain says.</div>
      <div class="card"><label>Rules <select id="ap-t">${lib.map(t => `<option value="${esc(t.key)}"${t.key === k ? " selected" : ""}>${esc(t.key)}</option>`).join("")}</select></label>
      <div class="tablewrap"><table class="rg" id="ap-q"><thead><tr><th>#</th><th>Question</th><th>Who answers</th><th>Details</th><th>Filer says</th><th>Decider says</th></tr></thead><tbody>
      ${qs.map((q, i) => `<tr data-i="${i}"><td>Q${i + 1}</td><td>${esc(q.text)}</td><td><select class="ap-k" aria-label="Who answers Q${i + 1}"><option value="">The two sides</option><option value="evidenceBy">The chain: evidence attached in time</option><option value="openedBefore">The chain: case opened by a date</option><option value="readAtLeast">The chain: an on-chain value</option></select></td>
        <td class="ap-d small"></td><td><input type="checkbox" class="ap-f" aria-label="Filer answers yes to Q${i + 1}"></td><td><input type="checkbox" class="ap-c" aria-label="Decider answers yes to Q${i + 1}"></td></tr>`).join("")}</tbody></table></div></div>
      <div id="ap-out" class="card"></div>`;
    document.querySelector("#ap-t").onchange = e => { location.hash = "#auto/" + e.target.value; };
    const rows = [...document.querySelectorAll("#ap-q tbody tr")];
    const detail = (tr, kind) => { const d = tr.querySelector(".ap-d");
      d.innerHTML = kind === "evidenceBy" ? `Filer attaches evidence for this question within <input class="ap-days" type="number" min="1" max="90" value="14" style="width:4em"> days of opening. Attached after <input class="ap-got" type="number" min="0" max="200" placeholder="never" style="width:5em"> days`
        : kind === "openedBefore" ? `Case opened <input class="ap-open" type="number" min="-60" max="60" value="0" style="width:4em"> days from the deadline (negative is before)`
        : kind === "readAtLeast" ? `Value must be at least <input class="ap-thr" type="number" min="0" value="1000" style="width:6em">. The source reads <input class="ap-val" type="number" min="0" value="2000" style="width:6em"> <label><input type="checkbox" class="ap-fail"> source fails</label>` : "";
      d.querySelectorAll("input").forEach(x => x.oninput = x.onchange = run); };
    function run() {
      const specs = [], evidence = [], reads = {}; let filer = 0n, decider = 0n;
      rows.forEach((tr, i) => {
        const kind = tr.querySelector(".ap-k").value, v = s => tr.querySelector(s);
        if (v(".ap-f").checked) filer |= 1n << BigInt(i); if (v(".ap-c").checked) decider |= 1n << BigInt(i);
        if (kind === "evidenceBy") { specs.push({kind, q: i, role: 0, question: i, withinSeconds: (+v(".ap-days").value || 14) * DAY}); if (v(".ap-got").value !== "") evidence.push({role: 0, question: i, at: NOW + (+v(".ap-got").value) * DAY}); }
        if (kind === "openedBefore") specs.push({kind, q: i, deadline: NOW - (+v(".ap-open").value) * DAY});
        if (kind === "readAtLeast") { specs.push({kind, q: i, target: "0x" + "00".repeat(20), data: "0x70a08231", cmp: "gte", threshold: String(Math.max(0, Math.floor(+v(".ap-thr").value || 0)))}); reads[i] = v(".ap-fail").checked ? {ok: false} : {ok: true, value: BigInt(Math.max(0, Math.floor(+v(".ap-val").value || 0)))}; }
      });
      const out = document.querySelector("#ap-out"), bad = A.validate(specs, nQ);
      if (bad.length) { out.innerHTML = `<p class="err">${bad.map(esc).join("<br>")}</p>`; return; }
      const c = A.combine(filer, decider, specs, {openedAt: NOW, acceptedAt: NOW - 5 * DAY, specSetAt: NOW - 9 * DAY, evidence, reads}, nQ), yn = b => b ? "Yes" : "No";
      const bit = (x, i) => ((x >> BigInt(i)) & 1n) === 1n;
      out.innerHTML = `<h3>What would happen</h3><table class="rg"><thead><tr><th>#</th><th>Result for this question</th></tr></thead><tbody>${qs.map((q, i) => {
        const isAuto = bit(c.autoMask, i), dis = bit(c.disputed, i), why = (c.details.find(d => d.q === i) || {}).why;
        return `<tr><td>Q${i + 1}</td><td>${isAuto ? `<b>${yn(bit(c.autoBits, i))}</b>, answered by the chain` : dis ? `<b>Disputed</b>: goes to the reviewer` : `<b>${yn(bit(c.fixed, i))}</b>, the two sides agree`}${why ? ` <span class="small mute">(${esc(why)})</span>` : ""}</td></tr>`; }).join("")}</tbody></table>
        <p>${c.needsReview ? "A reviewer is needed, for the disputed questions only." : "No reviewer is needed: nothing is in dispute."}</p>`;
    }
    rows.forEach(tr => tr.querySelector(".ap-k").onchange = e => { detail(tr, e.target.value); run(); });
    rows.forEach(tr => tr.querySelectorAll(".ap-f,.ap-c").forEach(x => x.onchange = run));
    run();
  }

  // ---------- #auto/<rule set number>: the real page. Read what the chain has, and let the publisher write it once. ----------
  const K = window.TB_PK, CFG = window.TB_CONFIG, W = () => window.TB_WALLET, ZERO = "0x" + "0".repeat(40);
  const SPEC_T = {tuple: ["uint8", "uint8", "uint8", "uint8", "uint32", "uint64", "address", "uint8", "uint256", "bytes"]};
  const enc = (name, types = [], vals = []) => K.hex(K.call(name, types, vals)), call = (to, data) => W().rpc("eth_call", [{to, data}, "latest"]);
  const word = (x, i) => BigInt("0x" + x.slice(i * 64, i * 64 + 64)), addrW = (x, i) => "0x" + x.slice(i * 64 + 24, i * 64 + 64);
  const short = a => a.slice(0, 6) + "…" + a.slice(-4), when = sec => new Date(Number(sec) * 1000).toLocaleString([], {dateStyle: "medium", timeStyle: "short"});
  const hours = sec => sec % 86400 === 0 ? sec / 86400 + " day" + (sec / 86400 === 1 ? "" : "s") : sec % 3600 === 0 ? sec / 3600 + " hour" + (sec / 3600 === 1 ? "" : "s") : sec + " seconds";
  async function readRuleSet(id) {
    const x = (await call(CFG.registry, enc("get", ["uint256"], [id]))).replace(/^0x/, "");
    const nameAt = 1 + Number(word(x, 9)) / 32, len = Number(word(x, nameAt)), name = new TextDecoder().decode(Uint8Array.from(x.slice((nameAt + 1) * 64, (nameAt + 1) * 64 + len * 2).match(/../g) || [], b => parseInt(b, 16)));
    return {publisher: addrW(x, 1), nQuestions: Number(word(x, 4)), name};
  }
  async function readSpecs(id) {
    const x = (await call(CFG.v6.facts, enc("get", ["uint256"], [id]))).replace(/^0x/, ""), listAt = Number(word(x, 0)) / 32, writtenAt = Number(word(x, 1)), n = Number(word(x, listAt)), base = listAt + 1, list = [];
    for (let i = 0; i < n; i++) {
      const t = base + Number(word(x, base + i)) / 32, dAt = t + Number(word(x, t + 9)) / 32, dLen = Number(word(x, dAt));
      list.push({kind: Number(word(x, t)), q: Number(word(x, t + 1)), role: Number(word(x, t + 2)), question: Number(word(x, t + 3)), withinSeconds: Number(word(x, t + 4)), deadline: Number(word(x, t + 5)), target: addrW(x, t + 6), cmp: Number(word(x, t + 7)), threshold: word(x, t + 8).toString(), data: "0x" + x.slice((dAt + 1) * 64, (dAt + 1) * 64 + dLen * 2)});
    }
    return {list, writtenAt};
  }
  /// One plain sentence per automatic question. `qs` are the question texts (or generic labels).
  const describe = (s, qs) => {
    const q = n => (n === 255 ? "the whole case" : "question " + (n + 1));
    if (s.kind === 1) return `The ${s.role === 0 ? "side that opens the case" : "other side"} must attach evidence for ${q(s.question)} within ${hours(s.withinSeconds)} of the case opening. If they do, the answer is Yes; if not, No.`;
    if (s.kind === 2) return `Yes if the case is opened by ${when(s.deadline)}, otherwise No.`;
    return `Yes if the value read from contract ${s.target} (call ${String(s.data).slice(0, 10)}…) is ${s.cmp === 1 ? "at least" : "equal to"} ${s.threshold}, otherwise No. If that contract cannot be read when the case opens, the two sides answer this question themselves.`;
  };
  async function onchain(id) {
    const V = CFG.v6;
    if (!V || !V.facts) { main.innerHTML = `<h1>Automatic questions</h1><div class="note">The contracts for automatic questions are not deployed yet.</div>`; return; }
    main.innerHTML = `<h1>Automatic questions</h1><p class="mute">Reading from X Layer…</p>`;
    let rs, sp; try { [rs, sp] = await Promise.all([readRuleSet(id), readSpecs(id)]); } catch { main.innerHTML = `<h1>Automatic questions</h1><p class="err">That rule set does not exist, or X Layer could not be reached.</p>`; return; }
    const pub = Object.keys(CFG.published || {}).find(k => CFG.published[k].ruleSetId === id), known = pub ? TB.parse(TB.TEMPLATES[pub]).policy.questions.map(q => q.text) : null;
    const qs = Array.from({length: rs.nQuestions}, (_, i) => known && known[i] ? known[i] : "Question " + (i + 1)), me = (W().account() || "").toLowerCase(), isPub = me === rs.publisher.toLowerCase();
    const head = `<h1>Automatic questions <span class="small mute">· rule set #${id}</span></h1><p class="lede"><b>${esc(rs.name)}</b>, published by <a href="#business/${rs.publisher}">${short(rs.publisher)}</a>. A question the chain answers is worked out by the contract. Neither side can answer or dispute it, and a reviewer cannot change it. Whether evidence is <i>true</i> is never decided this way: only when it was attached, or what a contract says.</p>`;
    if (sp.list.length) {
      main.innerHTML = head + `<div class="card"><h3>Answered by the chain</h3>${sp.list.map(s => `<p><b>${s.q + 1}. ${esc(qs[s.q])}</b><br><span class="small">${esc(describe(s, qs))}</span></p>`).join("")}<p class="small mute">Written ${when(sp.writtenAt)}. It cannot be changed. It applies only to agreements accepted after that time, so agreements signed earlier are not affected. The other questions are answered by the two sides as usual.</p></div>
        <p class="small"><a href="#rules/${id}">Rules history</a></p>`;
      return;
    }
    if (!isPub) {
      main.innerHTML = head + `<div class="card"><p>No question of this rule set is answered by the chain: the two sides answer them all.</p><p class="small mute">Only the publisher, <code>${rs.publisher}</code>, can change that, once, from this page.</p>${me ? "" : `<div class="row"><button class="btn small ghost" id="ac-conn" type="button">Connect my wallet</button></div>`}</div><p class="small"><a href="#rules/${id}">Rules history</a></p>`;
      if ($("#ac-conn")) $("#ac-conn").onclick = async () => { try { await W().connect(); } catch (e) {} onchain(id); };
      return;
    }
    main.innerHTML = head + `<div class="note"><b>You published this rule set.</b> You can choose questions the chain answers. <b>You can do this once, and it cannot be changed afterwards.</b> It applies only to agreements accepted after you write it.</div>
      <div class="card"><div class="tablewrap"><table class="rg" id="ac-q"><thead><tr><th>#</th><th>Question</th><th>Who answers</th><th>Details</th></tr></thead><tbody>${qs.map((q, i) => `<tr data-i="${i}"><td>Q${i + 1}</td><td>${esc(q)}</td><td><select class="ac-k" aria-label="Who answers Q${i + 1}"><option value="">The two sides</option><option value="1">The chain: evidence attached in time</option><option value="2">The chain: case opened by a date</option><option value="3">The chain: a value on another contract</option></select></td><td class="ac-d small"></td></tr>`).join("")}</tbody></table></div>
      <div class="row"><button class="btn" id="ac-review" type="button">Review what will be written</button></div><div id="ac-out"></div></div>`;
    const rows = [...document.querySelectorAll("#ac-q tbody tr")], opts = qs.map((q, i) => `<option value="${i}">Question ${i + 1}</option>`).join("") + `<option value="255">The whole case</option>`;
    rows.forEach(tr => tr.querySelector(".ac-k").onchange = e => { const k = e.target.value, d = tr.querySelector(".ac-d");
      d.innerHTML = k === "1" ? `<label>Who attaches it <select class="ac-role"><option value="0">The side that opens the case</option><option value="1">The other side</option></select></label> <label>Evidence about <select class="ac-evq">${opts}</select></label> <label>within <input class="ac-hrs" type="number" min="1" max="2160" value="336" style="width:5em"> hours of the case opening</label>`
        : k === "2" ? `<label>Opened by <input class="ac-date" type="datetime-local"></label> <span class="mute">(your local time)</span>`
        : k === "3" ? `<label>Contract <input class="ac-tgt" placeholder="0x…" style="width:22em"></label> <label>Call (selector and arguments) <input class="ac-data" placeholder="0x70a08231…" style="width:22em"></label> <label>Value is <select class="ac-cmp"><option value="1">at least</option><option value="2">equal to</option></select> <input class="ac-thr" type="number" min="0" value="1" style="width:9em"></label><div class="mute">Use a contract neither side controls. It is read once, when the case opens, with a fixed gas limit.</div>` : ""; });
    $("#ac-review").onclick = () => {
      const specs = [], out = $("#ac-out");
      for (const tr of rows) { const i = Number(tr.dataset.i), k = Number(tr.querySelector(".ac-k").value || 0), v = sel => (tr.querySelector(sel) || {}).value;
        if (k === 1) specs.push({kind: "evidenceBy", q: i, role: Number(v(".ac-role")), question: Number(v(".ac-evq")), withinSeconds: Math.round(Number(v(".ac-hrs")) * 3600)});
        if (k === 2) { const t = Math.floor(new Date(v(".ac-date")).getTime() / 1000); specs.push({kind: "openedBefore", q: i, deadline: Number.isFinite(t) ? t : 0}); }
        if (k === 3) specs.push({kind: "readAtLeast", q: i, target: String(v(".ac-tgt") || "").trim(), data: String(v(".ac-data") || "").trim(), cmp: v(".ac-cmp") === "2" ? "eq" : "gte", threshold: String(v(".ac-thr") || "0")}); }
      if (!specs.length) { out.innerHTML = `<p class="err">Choose at least one question for the chain to answer, or leave this page: nothing has been written.</p>`; return; }
      if (specs.length > 8) { out.innerHTML = `<p class="err">At most 8 questions can be answered by the chain.</p>`; return; }
      const bad = A.validate(specs, rs.nQuestions); if (bad.length) { out.innerHTML = `<p class="err">${bad.map(esc).join("<br>")}</p>`; return; }
      const list = specs.map(s => ({kind: s.kind === "evidenceBy" ? 1 : s.kind === "openedBefore" ? 2 : 3, q: s.q, role: s.role || 0, question: s.question || 0, withinSeconds: s.withinSeconds || 0, deadline: s.deadline || 0, target: s.target || ZERO, cmp: s.cmp === "gte" ? 1 : s.cmp === "eq" ? 2 : 0, threshold: s.threshold || "0", data: s.data || "0x"}));
      out.innerHTML = `<h3>This is what will be written</h3>${list.map(s => `<p><b>${s.q + 1}. ${esc(qs[s.q])}</b><br><span class="small">${esc(describe(s, qs))}</span></p>`).join("")}
        <div class="note">Written once, on X Layer, from your wallet. <b>It cannot be changed or removed.</b> It applies only to agreements accepted after it is written. If you made a mistake, publish the rules again as a new version and set it there.</div>
        <label class="small"><input type="checkbox" id="ac-ok"> I have read this and understand it cannot be changed.</label>
        <div class="row"><button class="btn" id="ac-go" type="button" disabled>Write on X Layer with my wallet</button></div><div id="ac-msg" class="small"></div>`;
      $("#ac-ok").onchange = e => { $("#ac-go").disabled = !e.target.checked; };
      $("#ac-go").onclick = async () => { const msg = $("#ac-msg"); $("#ac-go").disabled = true; msg.className = "small mute"; msg.textContent = "Confirm in your wallet…";
        try { const rc = await W().send(V.facts, enc("set", ["uint256", {array: SPEC_T}], [id, list.map(s => [s.kind, s.q, s.role, s.question, s.withinSeconds, s.deadline, s.target, s.cmp, s.threshold, s.data])]));
          await onchain(id); main.insertAdjacentHTML("afterbegin", `<div class="note ok-note">✓ Written. <a href="${CFG.explorer}/tx/${rc.transactionHash}" target="_blank" rel="noopener">${rc.transactionHash.slice(0, 12)}…</a></div>`);
        } catch (e) { msg.className = "small err"; msg.textContent = /user rejected|denied/i.test(String((e && e.message) || e)) ? "You cancelled in the wallet. Nothing was written." : (e && e.message) || String(e); $("#ac-go").disabled = false; } };
    };
  }
  window.TB_AUTOPREVIEW = {page};
})();
