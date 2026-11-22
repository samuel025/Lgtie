// On-chain case pages (TiebreakCaseV2): open a case, both sides accept a reviewer, answer, the reviewer decides only the disputed
// questions, deadlines with a public "close this case", and a replay. Needs a wallet to send; reads are free.
(function () {
  "use strict";
  const TB = window.TB, CFG = window.TB_CONFIG, $ = s => document.querySelector(s), main = document.querySelector("#main");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const w = n => BigInt(n).toString(16).padStart(64, "0"), addrW = a => a.toLowerCase().replace("0x", "").padStart(64, "0");
  const SEL = {open: "0x2da25165", approve: "0xf32ece36", propose: "0x19d368d1", submit: "0x99467e00", review: "0x9e1e0b54", expire: "0xbf81bf43", get: "0x9507d39a", replay: "0x275fabd4", count: "0x06661abd"};
  const OPENED = "0x5217ef0a53023fa797728dd41edbde7d2e403604cdcf9fea69addf9b372c770e", ZERO = /^0x0+$/, ADDR = /^0x[0-9a-fA-F]{40}$/;
  const short = a => a.slice(0, 6) + "…" + a.slice(-4), DAY = 86400;
  const STATUS = ["Waiting for answers", "Waiting for the reviewer", "Decided", "No decision (expired)"];
  const rpc = (method, params) => window.TB_WALLET.rpc(method, params);
  const call = data => rpc("eth_call", [{to: CFG.caseContract, data}, "latest"]);
  const sha256 = async t => "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("");
  const policyOf = ruleSetId => { const k = Object.keys(CFG.published).find(k => CFG.published[k].ruleSetId === Number(ruleSetId)); return k ? {key: k, policy: TB.parse(TB.TEMPLATES[k]).policy} : null; };
  const deployed = () => !ZERO.test(CFG.caseContract);
  const when = sec => new Date(Number(sec) * 1000).toLocaleString([], {dateStyle: "medium", timeStyle: "short"});

  function decodeCase(hex) {
    const x = hex.replace("0x", ""), W = i => x.slice(i * 64, i * 64 + 64), A = i => "0x" + W(i).slice(24), N = i => BigInt("0x" + W(i));
    return {ruleSetId: Number(N(0)), filer: A(1), decider: A(2), reviewer: A(3), operator: A(4), evidenceHash: "0x" + W(5), openedAt: Number(N(6)), answerBy: Number(N(7)), reviewWindow: Number(N(8)), reviewBy: Number(N(9)),
      filerAnswers: N(10), deciderAnswers: N(11), filerIn: N(12) === 1n, deciderIn: N(13) === 1n, disputed: N(14), finalAnswers: N(15), result: Number(N(16)), filerOk: N(17) === 1n, deciderOk: N(18) === 1n, status: Number(N(19))};
  }
  const bitsToArr = (m, n) => Array.from({length: n}, (_, k) => ((BigInt(m) >> BigInt(k)) & 1n) === 1n);
  const friendly = e => { const m = String((e && e.message) || e);
    if (/reviewer not accepted/.test(m)) return "Both sides have to accept the reviewer first."; if (/deadline passed/.test(m)) return "The deadline has passed."; if (/not allowed/.test(m)) return "Your wallet isn't allowed to do that on this case.";
    if (/user rejected|denied/i.test(m)) return "You cancelled in the wallet."; return m; };
  const send = data => window.TB_WALLET.send(CFG.caseContract, data);

  // ---------- pages ----------
  async function list() {
    if (!deployed()) { main.innerHTML = `<h1>Settle a disagreement</h1><div class="note">The case contract is being upgraded (reviewer acceptance and deadlines). Cases will be available again once the new contract is deployed.</div>`; return; }
    const opts = (vals, def) => vals.map(([d, label]) => `<option value="${d}"${d === def ? " selected" : ""}>${label}</option>`).join(""), days = [[1, "1 day"], [3, "3 days"], [7, "7 days"], [14, "14 days"], [30, "30 days"]];
    main.innerHTML = `<h1>Settle a disagreement</h1><p class="lede">Both sides answer the same questions. Where they agree, the answer stands. Only the questions they disagree on go to a neutral reviewer that both sides have accepted, and the published rules give the result. A case nobody finishes in time ends with no decision.</p>
      <div class="card"><h3>Open a case</h3>
        <div class="row"><label>Rule set <select id="rs"><option value="1">Warranty claims (published)</option></select></label></div>
        <div class="wide"><label><span>Decider (the business or repair centre)</span><input id="dec" type="text" placeholder="0x…" autocomplete="off"></label></div>
        <div class="wide"><label><span>Proposed reviewer (the decider must accept)</span><input id="rev" type="text" placeholder="0x…" autocomplete="off"></label></div>
        <div class="row"><label>Time to answer <select id="aw">${opts(days, 7)}</select></label><label>Time for the reviewer <select id="rw">${opts(days, 7)}</select></label></div>
        <div class="wide"><label><span>Evidence note, optional</span><input id="evd" type="text" placeholder="e.g. the repair centre report reference"></label></div>
        <p class="small mute">Only a fingerprint of the evidence note goes on-chain. You are the filer, and your wallet accepts the reviewer by opening the case. The reviewer must be a different person from both sides.</p>
        <div class="row"><button class="btn" id="open" type="button">Open case</button><span id="msg" class="small"></span></div></div>
      <div class="card"><h3>Look up a case</h3><div class="row"><input id="cn" type="number" min="1" placeholder="Case number" style="width:150px"><button class="btn ghost" id="lk" type="button">Open</button></div><div id="recent" class="small mute"></div><p class="small"><a href="#reviewer">See every reviewer's record</a></p></div>`;
    $("#lk").onclick = () => { const n = Number($("#cn").value); if (n) location.hash = "#case/" + n; };
    $("#open").onclick = async () => {
      const msg = $("#msg"), dec = $("#dec").value.trim(), rev = $("#rev").value.trim();
      if (!ADDR.test(dec) || !ADDR.test(rev)) { msg.innerHTML = `<span class="err">Enter the decider's and the reviewer's wallet addresses.</span>`; return; }
      try {
        msg.textContent = "Confirm in your wallet…"; const account = await window.TB_WALLET.connect();
        const ev = $("#evd").value.trim(), hash = ev ? await sha256(ev) : "0x" + "0".repeat(64);
        const rc = await send(SEL.open + w($("#rs").value) + addrW(account) + addrW(dec) + addrW(rev) + hash.slice(2) + w(Number($("#aw").value) * DAY) + w(Number($("#rw").value) * DAY));
        const lg = rc.logs.find(l => l.address.toLowerCase() === CFG.caseContract.toLowerCase() && l.topics[0] === OPENED);
        location.hash = "#case/" + Number(BigInt(lg.topics[1]));
      } catch (e) { msg.innerHTML = `<span class="err">${esc(friendly(e))}</span>`; }
    };
    try { const n = Number(BigInt(await call(SEL.count))); $("#recent").textContent = n ? `${n} case${n === 1 ? "" : "s"} so far. Latest: ` : "No cases yet."; if (n) { const a = document.createElement("a"); a.href = "#case/" + n; a.textContent = "#" + n; $("#recent").appendChild(a); } } catch {}
  }

  async function view(id) {
    if (!deployed()) { list(); return; }
    main.innerHTML = `<h1>Case #${esc(id)}</h1><p class="mute">Reading from X Layer…</p>`;
    let c, now; try { c = decodeCase(await call(SEL.get + w(id))); now = Number(BigInt((await rpc("eth_getBlockByNumber", ["latest", false])).timestamp)); } catch (e) { main.innerHTML = `<h1>Case #${esc(id)}</h1><p class="err">That case doesn't exist, or X Layer could not be reached.</p><p><a href="#case">Back</a></p>`; return; }
    const K = policyOf(c.ruleSetId); if (!K) { main.innerHTML = `<h1>Case #${esc(id)}</h1><p>This case uses rule set ${c.ruleSetId}, which this page does not know how to display.</p>`; return; }
    const P = K.policy, nQ = P.questions.length, me = window.TB_WALLET.account(), is = a => !!(me && a.toLowerCase() === me);
    const isFiler = is(c.filer), isDecider = is(c.decider), isReviewer = is(c.reviewer), isOp = is(c.operator);
    const fa = bitsToArr(c.filerAnswers, nQ), da = bitsToArr(c.deciderAnswers, nQ), dis = bitsToArr(c.disputed, nQ), fin = bitsToArr(c.finalAnswers, nQ), yn = v => v ? "Yes" : "No";
    const live = c.status === 0 || c.status === 1, deadline = c.status === 0 ? c.answerBy : c.status === 1 ? c.reviewBy : 0, late = live && now > deadline, agreed = c.filerOk && c.deciderOk;
    const rows = P.questions.map((q, i) => { const both = c.filerIn && c.deciderIn; let tag = ""; if (both) tag = dis[i] ? `<span class="badge warn">Disputed</span>` : `<span class="badge ok">Agreed</span>`;
      return `<tr><td>${i + 1}. ${esc(q.text)}</td><td>${c.filerIn ? yn(fa[i]) : "…"}</td><td>${c.deciderIn ? yn(da[i]) : "…"}</td><td>${tag}${c.status === 2 && dis[i] ? ` Reviewer: <b>${yn(fin[i])}</b>` : ""}</td></tr>`; }).join("");
    const ok = v => v ? "accepted ✓" : "not yet";
    main.innerHTML = `<h1>Case #${id}: ${esc(P.name)}</h1>
      <p><span class="badge${c.status === 3 ? " warn" : ""}">${STATUS[c.status]}</span> <span class="small mute">Filer ${short(c.filer)} · Decider ${short(c.decider)}${me ? " · You are " + short(me) : ""}</span></p>
      ${live ? `<p class="small ${late ? "err" : "mute"}">${c.status === 0 ? "Answers due by " : "The reviewer has until "}${when(deadline)}${late ? ". That time has passed." : "."}</p>` : ""}
      <div class="card" style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:15px"><thead><tr style="text-align:left"><th>Question</th><th>Filer</th><th>Decider</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="card"><h3>Reviewer</h3><p class="small"><a href="#reviewer/${c.reviewer}">${short(c.reviewer)}</a> (<a href="#reviewer/${c.reviewer}">record</a>): filer ${ok(c.filerOk)}, decider ${ok(c.deciderOk)}. ${live ? (agreed ? "Both sides accepted this reviewer." : "The reviewer can't decide anything until both sides accept.") : ""}</p><div id="rv"></div></div>
      <div id="act"></div><div id="final"></div>`;
    // reviewer controls
    if (live && !late) {
      const rv = $("#rv"), mine = [[isFiler || isOp, true, c.filerOk], [isDecider || isOp, false, c.deciderOk]].filter(x => x[0]);
      if (!me) rv.innerHTML = `<button class="btn small" id="cw" type="button">Connect wallet</button> <span class="small mute">to accept or change the reviewer, answer, or review</span>`;
      else if (mine.length) {
        const needs = mine.find(x => !x[2]);
        rv.innerHTML = `${needs ? `<div class="row"><button class="btn small" id="acc" type="button">Accept this reviewer</button></div>` : ""}<div class="row"><input id="newrev" type="text" placeholder="Propose a different reviewer: 0x…" style="width:min(380px,100%)" autocomplete="off"><button class="btn small ghost" id="prop" type="button">Propose</button><span id="rmsg" class="small err"></span></div>`;
        const asF = (needs || mine[0])[1];
        if (needs) $("#acc").onclick = async () => { try { await send(SEL.approve + w(id) + w(needs[1] ? 1 : 0)); view(id); } catch (e) { $("#rmsg").textContent = friendly(e); } };
        $("#prop").onclick = async () => { const a = $("#newrev").value.trim(); if (!ADDR.test(a)) { $("#rmsg").textContent = "Enter a wallet address."; return; } try { await send(SEL.propose + w(id) + w(asF ? 1 : 0) + addrW(a)); view(id); } catch (e) { $("#rmsg").textContent = friendly(e); } };
      } else rv.innerHTML = `<span class="small mute">Only the filer and the decider can change the reviewer.</span>`;
    }
    const cw = $("#cw"); if (cw) cw.onclick = async () => { try { await window.TB_WALLET.connect(); view(id); } catch (e) { cw.insertAdjacentHTML("afterend", `<span class="err small"> ${esc(friendly(e))}</span>`); } };
    $("#act").innerHTML = actions();
    function actions() {
      if (!live) return "";
      if (late) return `<div class="note">The deadline has passed. Anyone can close this case. It will end with no decision, and nobody wins by default.<div class="row"><button class="btn" id="closeit" type="button">Close this case</button><span id="cmsg" class="small err"></span></div></div>`;
      const parts = [];
      if (c.status === 0) {
        if ((isFiler || isOp) && !c.filerIn) parts.push(form("filer", "Your answers as the filer"));
        if ((isDecider || isOp) && !c.deciderIn) parts.push(form("decider", "Your answers as the decider"));
        if (!parts.length && me) parts.push(`<p class="mute">Nothing for your wallet to do on this case right now.</p>`);
      } else if (c.status === 1) {
        if ((isReviewer || isOp) && agreed) parts.push(form("review", "Your decision on the disputed questions only", dis));
        else if ((isReviewer || isOp) && !agreed) parts.push(`<p class="mute">Both sides have to accept you as the reviewer before you can decide.</p>`);
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
    if (c.status === 3) {
      $("#final").innerHTML = `<div class="res" role="status" style="border-color:var(--warn);background:var(--warn2)"><div class="big">No decision</div><div class="why">${c.filerIn && c.deciderIn ? "The reviewer did not decide in time." : "The answers were not all in on time."} Nobody wins by default. The two sides can open a new case.</div></div>`;
    }
    if (c.status === 2) {
      const r = TB.run(P, fin);
      $("#final").innerHTML = `<div class="res" role="status"><div class="big">${esc(P.results[c.result])}</div><div class="why">${esc(r.why)}</div><div class="row"><span class="badge" id="rp">Re-running the published rules on X Layer…</span><button class="btn small ghost" id="cl" type="button">Copy link</button></div>
        <p class="small">Final answers: ${P.questions.map((q, i) => (i + 1) + "=" + (fin[i] ? "yes" : "no")).join(", ")}. Rule set ${c.ruleSetId}, circuit #${CFG.published[K.key].circuitId}. ${c.disputed ? "The reviewer decided " + bitsToArr(c.disputed, nQ).filter(Boolean).length + " disputed question(s); everything else was agreed." : "Both sides agreed on every question."}</p>
        <p class="small mute">Other contracts can read this verdict (result number ${c.result}) from the case contract, for example to release a payment.</p></div>`;
      $("#cl").onclick = async e => { try { await navigator.clipboard.writeText(location.href); e.target.textContent = "Copied"; } catch { prompt("Copy:", location.href); } };
      call(SEL.replay + w(id)).then(h => { const x = h.replace("0x", ""), re = Number(BigInt("0x" + x.slice(0, 64))), st = Number(BigInt("0x" + x.slice(64, 128))), same = BigInt("0x" + x.slice(128, 192)) === 1n, b = $("#rp");
        if (same && re === c.result && re === r.result) { b.className = "badge ok"; b.textContent = "✓ Re-run just now by the TapeOut processor: same result"; } else { b.className = "badge warn"; b.textContent = "The re-run gave a different result. Do not rely on this page."; } })
        .catch(() => { const b = $("#rp"); b.className = "badge warn"; b.textContent = "Could not re-run on X Layer right now"; });
    }
  }

  // ---------- reviewer record (read-only, from the chain) ----------
  // Scans the most recent cases and tallies what each reviewer address did. It shows activity, not correctness: nothing on-chain can say whether a decision was right.
  async function scanCases(limit) {
    const n = Number(BigInt(await call(SEL.count))), out = [], lo = Math.max(1, n - limit + 1);
    for (let i = n; i >= lo; i -= 10) {
      const ids = []; for (let k = i; k > i - 10 && k >= lo; k--) ids.push(k);
      const got = await Promise.all(ids.map(id => call(SEL.get + w(id)).then(h => ({id, ...decodeCase(h)}), () => null)));
      got.forEach(c => c && out.push(c));
    }
    return {total: n, cases: out, truncated: n > limit};
  }
  function classify(c) { // what this case means for its reviewer
    if (c.status === 2) return c.disputed !== 0n ? "decided" : "notNeeded";
    if (c.status === 3) return (c.filerIn && c.deciderIn) ? ((c.filerOk && c.deciderOk) ? "ghosted" : "neverAccepted") : "beforeReview";
    return "pending";
  }
  const LABEL = {decided: "Decided the disputed questions", ghosted: "Accepted, but did not decide in time", neverAccepted: "Not accepted by both sides before time ran out", pending: "Still open", notNeeded: "Not needed (both sides agreed)", beforeReview: "Case expired before it reached the reviewer"};
  const tally = cs => { const t = {decided: 0, ghosted: 0, neverAccepted: 0, pending: 0, notNeeded: 0, beforeReview: 0}; cs.forEach(c => t[classify(c)]++); return t; };

  async function reviewers() {
    if (!deployed()) { list(); return; }
    main.innerHTML = `<h1>Reviewers</h1><p class="mute">Reading cases from X Layer…</p>`;
    let sc; try { sc = await scanCases(200); } catch { main.innerHTML = `<h1>Reviewers</h1><p class="err">X Layer could not be reached.</p>`; return; }
    const by = new Map(); sc.cases.forEach(c => { const k = c.reviewer.toLowerCase(); if (!by.has(k)) by.set(k, []); by.get(k).push(c); });
    const rows = [...by.entries()].map(([a, cs]) => { const t = tally(cs); return `<tr><td><a href="#reviewer/${a}">${short(a)}</a></td><td>${cs.length}</td><td>${t.decided}</td><td>${t.ghosted}</td><td>${t.neverAccepted}</td><td>${t.pending}</td></tr>`; }).join("");
    main.innerHTML = `<h1>Reviewers</h1><p class="lede">A public record of what each reviewer did on cases, read straight from X Layer. It shows who decided and who did not, not whether a decision was right. Nothing on-chain can tell that.</p>
      <div class="card" style="overflow:auto">${rows ? `<table style="width:100%;border-collapse:collapse;font-size:15px"><thead><tr style="text-align:left"><th>Reviewer</th><th>Cases</th><th>Decided</th><th>Missed deadline</th><th>Never accepted</th><th>Open</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="mute">No cases yet.</p>`}</div>
      <p class="small mute">${sc.truncated ? `Showing the latest 200 of ${sc.total} cases. ` : `${sc.total} case${sc.total === 1 ? "" : "s"} read. `}A case counts for the reviewer currently named on it.</p>`;
  }

  async function reviewer(addr) {
    if (!deployed()) { list(); return; }
    if (!ADDR.test(addr)) { main.innerHTML = `<h1>Reviewer record</h1><p class="err">That is not a wallet address. <a href="#reviewer">See all reviewers</a>.</p>`; return; }
    main.innerHTML = `<h1>Reviewer ${short(addr)}</h1><p class="mute">Reading cases from X Layer…</p>`;
    let sc; try { sc = await scanCases(200); } catch { main.innerHTML = `<h1>Reviewer ${short(addr)}</h1><p class="err">X Layer could not be reached.</p>`; return; }
    const mine = sc.cases.filter(c => c.reviewer.toLowerCase() === addr.toLowerCase()).sort((a, b) => b.id - a.id), t = tally(mine);
    const rows = mine.map(c => { const k = classify(c), P = (policyOf(c.ruleSetId) || {}).policy; return `<tr><td><a href="#case/${c.id}">#${c.id}</a></td><td>${esc(P ? P.name : "Rule set " + c.ruleSetId)}</td><td>${LABEL[k]}</td><td>${c.status === 2 && P ? esc(P.results[c.result]) : ""}</td></tr>`; }).join("");
    main.innerHTML = `<h1>Reviewer ${short(addr)}</h1><p class="small mute"><code>${addr}</code> · <a href="#reviewer">All reviewers</a></p>
      <div class="stats"><span>${mine.length} case${mine.length === 1 ? "" : "s"}</span><span>${t.decided} decided</span><span>${t.ghosted} missed the deadline</span><span>${t.neverAccepted} never accepted</span><span>${t.pending} open</span></div>
      <div class="card" style="overflow:auto">${rows ? `<table style="width:100%;border-collapse:collapse;font-size:15px"><thead><tr style="text-align:left"><th>Case</th><th>Rule set</th><th>What happened</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="mute">This address has not been named reviewer on any case yet.</p>`}</div>
      <div class="note">This is a record of activity. It cannot show whether a decision was right: only the people involved can judge that. Both sides should still decide for themselves whether to accept a reviewer.</div>
      <p class="small mute">${sc.truncated ? `Based on the latest 200 of ${sc.total} cases.` : `Based on all ${sc.total} case${sc.total === 1 ? "" : "s"}.`}</p>`;
  }

  window.TB_CASES = {list, view, reviewers, reviewer};
})();
