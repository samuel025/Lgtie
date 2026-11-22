// On-chain case pages: open a case, answer as filer or decider, reviewer decides disputed questions, replay. Needs a wallet to send; reads are free.
(function () {
  "use strict";
  const TB = window.TB, CFG = window.TB_CONFIG, $ = s => document.querySelector(s), main = document.querySelector("#main");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const w = n => BigInt(n).toString(16).padStart(64, "0"), addrW = a => a.toLowerCase().replace("0x", "").padStart(64, "0");
  const SEL = {open: "0x4e7a6bd2", submit: "0x99467e00", review: "0x9e1e0b54", get: "0x9507d39a", replay: "0x275fabd4", count: "0x06661abd"};
  const OPENED = "0x41d0d6d6d7020744f16055467df41cfd177a1df89958530fe8d56d4d6615cc89", ZERO = /^0x0+$/, ADDR = /^0x[0-9a-fA-F]{40}$/;
  const short = a => a.slice(0, 6) + "…" + a.slice(-4);
  const rpc = async (method, params) => { const r = await (await fetch(CFG.rpc, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params})})).json(); if (r.error) throw new Error(r.error.message || "RPC error"); return r.result; };
  const call = data => rpc("eth_call", [{to: CFG.caseContract, data}, "latest"]);
  const sha256 = async t => "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("");
  const policyOf = ruleSetId => { const k = Object.keys(CFG.published).find(k => CFG.published[k].ruleSetId === Number(ruleSetId)); return k ? {key: k, policy: TB.parse(TB.TEMPLATES[k]).policy} : null; };
  const deployed = () => !ZERO.test(CFG.caseContract);

  function decodeCase(hex) {
    const x = hex.replace("0x", ""), W = i => x.slice(i * 64, i * 64 + 64), A = i => "0x" + W(i).slice(24), N = i => BigInt("0x" + W(i));
    return {ruleSetId: Number(N(0)), filer: A(1), decider: A(2), reviewer: A(3), operator: A(4), evidenceHash: "0x" + W(5), openedAt: Number(N(6)), filerAnswers: N(7), deciderAnswers: N(8), filerIn: N(9) === 1n, deciderIn: N(10) === 1n, disputed: N(11), finalAnswers: N(12), result: Number(N(13)), status: Number(N(14))};
  }
  const bitsToArr = (m, n) => Array.from({length: n}, (_, k) => ((BigInt(m) >> BigInt(k)) & 1n) === 1n);
  const arrToBits = a => a.reduce((acc, v, k) => acc + (v ? 1n << BigInt(k) : 0n), 0n);

  // ---------- wallet ----------
  let account = null;
  const eth = () => window.ethereum;
  async function connect() {
    if (!eth()) throw new Error("No wallet found. Install a wallet such as OKX Wallet, then reload.");
    const accs = await eth().request({method: "eth_requestAccounts"}); account = accs[0].toLowerCase();
    const id = await eth().request({method: "eth_chainId"});
    if (parseInt(id, 16) !== CFG.chainId) {
      try { await eth().request({method: "wallet_switchEthereumChain", params: [{chainId: "0x" + CFG.chainId.toString(16)}]}); }
      catch (e) { if (e && e.code === 4902) await eth().request({method: "wallet_addEthereumChain", params: [{chainId: "0x" + CFG.chainId.toString(16), chainName: "X Layer", nativeCurrency: {name: "OKB", symbol: "OKB", decimals: 18}, rpcUrls: [CFG.rpc], blockExplorerUrls: [CFG.explorer]}]}); else throw e; }
    }
    return account;
  }
  async function send(data) {
    if (!account) await connect();
    const hash = await eth().request({method: "eth_sendTransaction", params: [{from: account, to: CFG.caseContract, data}]});
    for (let i = 0; i < 90; i++) { const rc = await rpc("eth_getTransactionReceipt", [hash]); if (rc) { if (rc.status !== "0x1") throw new Error("The transaction was rejected by the contract."); return rc; } await new Promise(r => setTimeout(r, 1000)); }
    throw new Error("Timed out waiting for the transaction. It may still go through: " + hash);
  }
  const friendly = e => { const m = String((e && e.message) || e); if (/not allowed/.test(m)) return "Your wallet isn't allowed to do that on this case."; if (/user rejected|denied/i.test(m)) return "You cancelled in the wallet."; return m; };

  // ---------- pages ----------
  async function list() {
    if (!deployed()) { main.innerHTML = `<h1>Disputes</h1><p>The case contract is not deployed yet.</p>`; return; }
    main.innerHTML = `<h1>Settle a disagreement</h1><p class="lede">Both sides answer the same questions. Where they agree, the answer stands. Only the questions they disagree on go to a neutral reviewer, and the published rules give the result.</p>
      <div class="card"><h3>Open a case</h3>
        <div class="row"><label>Rule set <select id="rs"><option value="1">Warranty claims (published)</option></select></label></div>
        <div class="wide"><label><span>Decider (the business or repair centre)</span><input id="dec" type="text" placeholder="0x…" autocomplete="off"></label></div>
        <div class="wide"><label><span>Reviewer (a neutral person)</span><input id="rev" type="text" placeholder="0x…" autocomplete="off"></label></div>
        <div class="wide"><label><span>Evidence note, optional</span><input id="evd" type="text" placeholder="e.g. the repair centre report reference"></label></div>
        <p class="small mute">Only a fingerprint of the evidence note goes on-chain. You are the filer. The reviewer must be a different person from both sides.</p>
        <div class="row"><button class="btn" id="open" type="button">Open case</button><span id="msg" class="small"></span></div></div>
      <div class="card"><h3>Look up a case</h3><div class="row"><input id="cn" type="number" min="1" placeholder="Case number" style="width:150px"><button class="btn ghost" id="lk" type="button">Open</button></div><div id="recent" class="small mute"></div></div>`;
    $("#lk").onclick = () => { const n = Number($("#cn").value); if (n) location.hash = "#case/" + n; };
    $("#open").onclick = async () => {
      const msg = $("#msg"), dec = $("#dec").value.trim(), rev = $("#rev").value.trim();
      if (!ADDR.test(dec) || !ADDR.test(rev)) { msg.innerHTML = `<span class="err">Enter the decider's and the reviewer's wallet addresses.</span>`; return; }
      try {
        msg.textContent = "Confirm in your wallet…"; await connect();
        const ev = $("#evd").value.trim(), hash = ev ? await sha256(ev) : "0x" + "0".repeat(64);
        const rc = await send(SEL.open + w($("#rs").value) + addrW(account) + addrW(dec) + addrW(rev) + hash.slice(2));
        const lg = rc.logs.find(l => l.address.toLowerCase() === CFG.caseContract.toLowerCase() && l.topics[0] === OPENED);
        location.hash = "#case/" + Number(BigInt(lg.topics[1]));
      } catch (e) { msg.innerHTML = `<span class="err">${esc(friendly(e))}</span>`; }
    };
    try { const n = Number(BigInt(await call(SEL.count))); $("#recent").textContent = n ? `${n} case${n === 1 ? "" : "s"} so far. Latest: ` : "No cases yet."; if (n) { const a = document.createElement("a"); a.href = "#case/" + n; a.textContent = "#" + n; $("#recent").appendChild(a); } } catch {}
  }

  async function view(id) {
    if (!deployed()) { list(); return; }
    main.innerHTML = `<h1>Case #${esc(id)}</h1><p class="mute">Reading from X Layer…</p>`;
    let c; try { c = decodeCase(await call(SEL.get + w(id))); } catch (e) { main.innerHTML = `<h1>Case #${esc(id)}</h1><p class="err">That case doesn't exist, or X Layer could not be reached.</p><p><a href="#case">Back</a></p>`; return; }
    const K = policyOf(c.ruleSetId); if (!K) { main.innerHTML = `<h1>Case #${esc(id)}</h1><p>This case uses rule set ${c.ruleSetId}, which this page does not know how to display.</p>`; return; }
    const P = K.policy, nQ = P.questions.length, status = ["Waiting for answers", "Waiting for the reviewer", "Decided"][c.status];
    const me = account, role = a => (a && me && a.toLowerCase() === me) ? true : false;
    const isFiler = role(c.filer), isDecider = role(c.decider), isReviewer = role(c.reviewer), isOp = role(c.operator);
    const fa = bitsToArr(c.filerAnswers, nQ), da = bitsToArr(c.deciderAnswers, nQ), dis = bitsToArr(c.disputed, nQ), fin = bitsToArr(c.finalAnswers, nQ);
    const yn = v => v ? "Yes" : "No";
    const rows = P.questions.map((q, i) => {
      const both = c.filerIn && c.deciderIn; let tag = "";
      if (both) tag = dis[i] ? `<span class="badge warn">Disputed</span>` : `<span class="badge ok">Agreed</span>`;
      return `<tr><td>${i + 1}. ${esc(q.text)}</td><td>${c.filerIn ? yn(fa[i]) : "…"}</td><td>${c.deciderIn ? yn(da[i]) : "…"}</td><td>${tag}${c.status === 2 && dis[i] ? ` Reviewer: <b>${yn(fin[i])}</b>` : ""}</td></tr>`;
    }).join("");
    main.innerHTML = `<h1>Case #${id}: ${esc(P.name)}</h1>
      <p><span class="badge">${status}</span> <span class="small mute">Filer ${short(c.filer)} · Decider ${short(c.decider)} · Reviewer ${short(c.reviewer)}${me ? " · You are " + short(me) : ""}</span></p>
      <div class="card" style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:15px"><thead><tr style="text-align:left"><th>Question</th><th>Filer</th><th>Decider</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div id="act"></div><div id="final"></div>`;
    $("#act").innerHTML = actions();
    function actions() {
      if (c.status === 2) return "";
      const wallet = me ? "" : `<div class="row"><button class="btn" id="cw" type="button">Connect wallet</button><span class="small mute">to answer or review</span></div>`;
      const parts = [];
      if (c.status === 0) {
        if ((isFiler || isOp) && !c.filerIn) parts.push(form("filer", "Your answers as the filer", Array(nQ).fill(true)));
        if ((isDecider || isOp) && !c.deciderIn) parts.push(form("decider", "Your answers as the decider", Array(nQ).fill(true)));
        if (!parts.length && me) parts.push(`<p class="mute">Nothing for your wallet to do on this case right now.</p>`);
      } else if (c.status === 1) {
        if (isReviewer || isOp) parts.push(form("review", "Your decision on the disputed questions only", null, dis));
        else if (me) parts.push(`<p class="mute">Waiting for the reviewer to answer the disputed questions.</p>`);
      }
      return wallet + parts.join("");
    }
    function form(kind, title, init, only) {
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
          await send(kind === "review" ? SEL.review + w(id) + w(bits) : SEL.submit + w(id) + w(kind === "filer" ? 1 : 0) + w(bits));
          view(id);
        } catch (e) { msg.className = "small err"; msg.textContent = friendly(e); }
      };
    });
    const cw = $("#cw"); if (cw) cw.onclick = async () => { try { await connect(); view(id); } catch (e) { cw.insertAdjacentHTML("afterend", `<span class="err small"> ${esc(friendly(e))}</span>`); } };
    if (c.status === 2) {
      const r = TB.run(P, fin);
      $("#final").innerHTML = `<div class="res" role="status"><div class="big">${esc(P.results[c.result])}</div><div class="why">${esc(r.why)}</div><div class="row"><span class="badge" id="rp">Re-running the published rules on X Layer…</span><button class="btn small ghost" id="cl" type="button">Copy link</button></div>
        <p class="small">Final answers: ${P.questions.map((q, i) => (i + 1) + "=" + (fin[i] ? "yes" : "no")).join(", ")}. Rule set ${c.ruleSetId}, circuit #${CFG.published[K.key].circuitId}. ${c.disputed ? "The reviewer decided " + bitsToArr(c.disputed, nQ).filter(Boolean).length + " disputed question(s); everything else was agreed." : "Both sides agreed on every question."}</p></div>`;
      $("#cl").onclick = async e => { try { await navigator.clipboard.writeText(location.href); e.target.textContent = "Copied"; } catch { prompt("Copy:", location.href); } };
      call(SEL.replay + w(id)).then(h => { const x = h.replace("0x", ""), re = Number(BigInt("0x" + x.slice(0, 64))), st = Number(BigInt("0x" + x.slice(64, 128))), ok = BigInt("0x" + x.slice(128, 192)) === 1n, b = $("#rp");
        if (ok && re === c.result && re === r.result) { b.className = "badge ok"; b.textContent = "✓ Re-run just now by the TapeOut processor: same result"; } else { b.className = "badge warn"; b.textContent = "The re-run gave a different result. Do not rely on this page."; } })
        .catch(() => { const b = $("#rp"); b.className = "badge warn"; b.textContent = "Could not re-run on X Layer right now"; });
    }
  }

  window.TB_CASES = {list, view};
})();
