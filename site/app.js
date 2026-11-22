(function () {
  "use strict";
  const TB = window.TB, CFG = window.TB_CONFIG, $ = s => document.querySelector(s), main = $("#main");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const b64e = s => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));
  const copy = async (t, btn) => { try { await navigator.clipboard.writeText(t); const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => btn.textContent = o, 1400); } catch { prompt("Copy this:", t); } };
  const sha256 = async t => "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("");

  // ---------- chain reads (free; no wallet) ----------
  const w = n => BigInt(n).toString(16).padStart(64, "0");
  const rpc = async (method, params) => { const r = await (await fetch(CFG.rpc, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params})})).json(); if (r.error) throw new Error(r.error.message || "RPC error"); return r.result; };
  const inputBytes = (m, nQ) => { let h = ""; for (let j = 0; j < Math.ceil(nQ / 8); j++) h += (Math.floor(m / 2 ** (8 * j)) % 256).toString(16).padStart(2, "0"); return h; };
  async function evalOnChain(circuitId, m, nQ, nOut) {
    const bytes = inputBytes(m, nQ), len = bytes.length / 2;
    const out = (await rpc("eth_call", [{to: CFG.processor, data: "0x934d06ea" + w(circuitId) + w(64) + w(len) + bytes.padEnd(Math.ceil(len / 32) * 64, "0")}, "latest"])).replace("0x", "");
    const off = Number(BigInt("0x" + out.slice(0, 64))) * 2, n = Number(BigInt("0x" + out.slice(off, off + 64))), data = out.slice(off + 64, off + 64 + n * 2);
    return (parseInt(data.slice(0, 2) || "0", 16)) & (2 ** nOut - 1);
  }
  const circuitInfo = async id => { const h = (await rpc("eth_call", [{to: CFG.processor, data: "0x084d60f1" + w(id)}, "latest"])).replace("0x", ""); return {nIn: Number(BigInt("0x" + h.slice(0, 64))), nOut: Number(BigInt("0x" + h.slice(64, 128)))}; };
  const circuitOwner = async id => "0x" + (await rpc("eth_call", [{to: CFG.processor, data: "0x6352211e" + w(id)}, "latest"])).slice(-40);

  // ---------- policies ----------
  function loadPolicy(key) {
    if (TB.TEMPLATES[key]) { const r = TB.parse(TB.TEMPLATES[key]); return {key, policy: r.policy, text: TB.TEMPLATES[key]}; }
    if (key.startsWith("c=")) { try { const text = b64d(key.slice(2)), r = TB.parse(text); if (!r.errors.length) return {key, policy: r.policy, text, custom: true}; } catch {} }
    return null;
  }

  // ---------- views ----------
  function home() {
    main.innerHTML = `
    <h1>Know if you are covered before you file.</h1>
    <p class="lede">Businesses publish their policy once, as a checker anyone can use. You answer plain questions, see the result and the reason, and anyone can re-run it and get the same answer.</p>
    <div class="row"><a class="btn" href="#check/warranty">Try the warranty check</a><a class="btn ghost" href="#build">Publish your own policy</a></div>
    <div class="grid">
      <div class="card"><h3>For customers</h3><p>No account and no wallet. Answer yes or no, get a clear result and the exact reason, and share the link.</p></div>
      <div class="card"><h3>For businesses</h3><p>Paste your policy as simple rules. We turn it into a checker you can put on your support page, so there is less arguing about what the rules say.</p></div>
      <div class="card"><h3>For anyone in doubt</h3><p>A "check it yourself" button re-runs the published rules. The rules can't be changed after the fact.</p></div>
    </div>
    <h2>Try another example</h2>
    <div class="grid"><div class="card"><h3>Warranty claims</h3><p class="mute">Is a repair covered?</p><a class="btn small" href="#check/warranty">Open</a></div>
    <div class="card"><h3>Bug bounty severity</h3><p class="mute">How serious is a reported vulnerability?</p><a class="btn small" href="#check/bounty">Open</a></div></div>`;
  }

  async function check(key, rest) {
    const L = loadPolicy(key); if (!L) { main.innerHTML = `<h1>We could not open that checker</h1><p>The link may be incomplete. <a href="#check/warranty">Open the warranty example</a>.</p>`; return; }
    const P = L.policy, C = TB.compile(P), nQ = P.questions.length, published = CFG.published[key];
    let ans = Array(nQ).fill(null);
    const a = /(?:^|[/&])a=(\d+)/.exec(rest || ""); if (a) { const m = Number(a[1]); ans = TB.decodeAnswers(m, nQ); }
    main.innerHTML = `<h1>${esc(P.name)}</h1><p class="lede">${esc(P.about || "")}</p>
      <div class="prog"><i id="bar"></i></div><div class="small mute" id="count"></div>
      <div id="qs"></div><div id="resbox"></div>`;
    const qs = $("#qs");
    P.questions.forEach((q, i) => {
      const d = document.createElement("div"); d.className = "q"; d.innerHTML = `<div class="t">${i + 1}. ${esc(q.text)}</div>${q.hint ? `<div class="h">Evidence: ${esc(q.hint)}</div>` : ""}<div class="yn" role="group" aria-label="Answer to question ${i + 1}"><button type="button" data-v="1" aria-pressed="false">Yes</button><button type="button" data-v="0" aria-pressed="false">No</button></div>`;
      d.querySelectorAll("button").forEach(b => b.onclick = () => { ans[i] = b.dataset.v === "1"; paint(); });
      qs.appendChild(d);
    });
    let seq = 0;
    function paint() {
      qs.querySelectorAll(".q").forEach((d, i) => d.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(ans[i] !== null && (b.dataset.v === "1") === ans[i]))));
      const done = ans.filter(x => x !== null).length; $("#bar").style.width = (100 * done / nQ) + "%"; $("#count").textContent = `${done} of ${nQ} answered`;
      const box = $("#resbox");
      if (done < nQ) { box.innerHTML = ""; return; }
      const r = TB.run(P, ans), m = TB.encodeAnswers(ans), link = location.href.split("#")[0] + "#check/" + key + "/a=" + m, mine = ++seq;
      const hexIn = inputBytes(m, nQ), rule = r.ruleIndex >= 0 ? "Rule " + (r.ruleIndex + 1) + ": " + P.rules[r.ruleIndex].conds.map(c => `question ${c.q + 1} = ${c.yes ? "yes" : "no"}`).join(" and ") : "No rule matched, so the default applies";
      box.innerHTML = `<div class="res" role="status"><div class="big">${esc(P.results[r.result])}</div><div class="why">${esc(r.why || "")}</div>
        <div class="row"><span class="badge" id="vbadge">Checking…</span><button class="btn small ghost" id="cp" type="button">Copy link to this result</button><button class="btn small ghost" id="rs" type="button">Start over</button></div>
        <details><summary>Check this result yourself</summary>
          <p class="small">${esc(rule)}. The same answers go into the published rules, and anyone can run them.</p>
          ${published ? `<p class="small">Published on X Layer as circuit <b>#${published.circuitId}</b> on processor <code>${CFG.processor}</code>. Anyone can run this command:</p><pre>cast call ${CFG.processor} "eval(uint256,bytes)(bytes)" ${published.circuitId} 0x${hexIn} --rpc-url ${CFG.rpc}</pre><p class="small">The first byte of the answer is the result number (${r.result} = ${esc(P.results[r.result])}).</p>`
            : `<p class="small">This checker has not been published on X Layer yet, so the result above is computed in your browser from the same rules. Once published, the page asks the TapeOut processor and shows a confirmation.</p>`}
          <p class="small">Circuit: ${C.gates.length} NAND gates, ${nQ} inputs, ${C.nOut} outputs.</p><pre>${C.hex}</pre></details></div>`;
      $("#cp").onclick = e => copy(link, e.target); $("#rs").onclick = () => { ans = Array(nQ).fill(null); history.replaceState(null, "", "#check/" + key); paint(); window.scrollTo({top: 0, behavior: "smooth"}); };
      history.replaceState(null, "", "#check/" + key + "/a=" + m);
      const vb = $("#vbadge");
      if (!published) { vb.className = "badge warn"; vb.textContent = "Preview: computed in your browser"; return; }
      evalOnChain(published.circuitId, m, nQ, C.nOut).then(got => { if (mine !== seq) return; if (got === r.result) { vb.className = "badge ok"; vb.textContent = "✓ Confirmed by the TapeOut processor on X Layer"; } else { vb.className = "badge warn"; vb.textContent = "The chain gave a different result. Do not rely on this page."; } })
        .catch(() => { if (mine !== seq) return; vb.className = "badge warn"; vb.textContent = "Could not reach X Layer; showing the browser result"; });
    }
    paint();
  }

  async function build(rest) {
    let text = TB.TEMPLATES.warranty;
    main.innerHTML = `<h1>Publish your policy as a checker</h1>
      <p class="lede">Write your rules in plain lines. Rules are checked from top to bottom, and the first one that matches decides. We turn the rules into a circuit and prove it gives the same answers as your text.</p>
      <div class="row"><span class="mute small">Start from an example:</span><button class="btn small ghost" data-t="warranty" type="button">Warranty claims</button><button class="btn small ghost" data-t="bounty" type="button">Bug bounty severity</button></div>
      <textarea id="src" class="mono" spellcheck="false" aria-label="Your policy rules"></textarea>
      <div id="out"></div>
      <details><summary>How to write the rules</summary><pre>name: Name of your checker
about: One line shown to the person answering
question: Is it within the warranty period? | Evidence to ask for (optional)
result: Not covered          (results are listed in order)
result: Covered
rule: Q1=no -> Not covered : The reason shown to the person
rule: Q2=no & Q3=yes -> Not covered : Several conditions joined with &
default: Covered : Shown when no rule matched</pre></details>`;
    const src = $("#src"); src.value = text;
    document.querySelectorAll("[data-t]").forEach(b => b.onclick = () => { src.value = TB.TEMPLATES[b.dataset.t]; render(); });
    let t = 0; src.oninput = () => { clearTimeout(t); t = setTimeout(render, 250); };
    async function render() {
      const out = $("#out"), r = TB.parse(src.value);
      if (r.errors.length) { out.innerHTML = `<div class="card"><b>Fix these first</b>${r.errors.map(e => `<div class="err">${e.line ? "Line " + e.line + ": " : ""}${esc(e.message)}</div>`).join("")}</div>`; return; }
      const P = r.policy, C = TB.compile(P), v = TB.verify(P, C), canon = TB.canonical(P), h = await sha256(canon), nQ = P.questions.length;
      const link = location.href.split("#")[0] + "#check/c=" + b64e(canon), nandNeeded = C.gates.length;
      out.innerHTML = `<div class="card"><h3>${esc(P.name)}</h3>
        <div class="stats"><span>${nQ} questions</span><span>${P.results.length} results</span><span>${P.rules.length} rules</span><span>${C.gates.length} circuit gates</span></div>
        <p class="${v.ok ? "ok" : "err"}"><b>${v.ok ? "✓ The circuit gives the same answer as your rules" : "✗ The circuit does not match your rules"}</b> on ${v.exhaustive ? "all " + v.checked : v.checked + " sampled"} answer combinations.</p>
        <div class="row"><a class="btn" href="${link}">Try your checker</a><button class="btn ghost" id="cplink" type="button">Copy shareable link</button></div></div>
        <div class="card"><h3>Publishing it on X Layer</h3>
          <p class="small">Publishing records the circuit permanently, so the rules can't be changed afterwards. A change means publishing a new version. It needs <b>${nandNeeded} NAND tokens</b> (the faucet gives 40 once per wallet) and a 0.0013 OKB fee, which is a fraction of a cent to a few cents.</p>
          <p class="small"><b>Definitions hash</b> (fingerprint of the rules text above, published with the circuit): <code>${h}</code></p>
          <details><summary>Circuit netlist (${nQ} inputs, ${C.nOut} outputs)</summary><pre id="hexbox">${C.hex}</pre><div class="row"><button class="btn small ghost" id="cphex" type="button">Copy netlist</button><button class="btn small ghost" id="dl" type="button">Download rules and circuit</button></div></details>
          <p class="note">In this version, publishing is done with the scripts in the project's <code>scripts/</code> folder. One-click publishing from this page is not built yet.</p></div>`;
      $("#cplink").onclick = e => copy(link, e.target); $("#cphex").onclick = e => copy(C.hex, e.target);
      $("#dl").onclick = () => { const blob = new Blob([JSON.stringify({rules: canon, definitionsHashSha256: h, nQuestions: nQ, nResultBits: C.nOut, netlist: C.hex, gates: C.gates.length}, null, 2)], {type: "application/json"}); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = (P.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "rules") + ".json"; a.click(); };
    }
    render();
  }

  function verify() {
    main.innerHTML = `<h1>Verify a published circuit</h1><p class="lede">Look up any circuit on the TapeOut processor and run it yourself. This asks X Layer directly, so you do not have to trust this page.</p>
      <div class="card"><div class="row"><label>Circuit number <input id="cid" type="number" min="1" style="width:120px"></label><label>Answers, one digit per question, question 1 first <input id="bits" type="text" placeholder="1111111" style="width:220px" autocomplete="off"></label><button class="btn" id="go" type="button">Run it</button></div><div id="vout"></div></div>
      <p class="small mute">Processor: <code>${CFG.processor}</code></p>`;
    $("#go").onclick = async () => {
      const id = Number($("#cid").value), bits = $("#bits").value.trim(), out = $("#vout"); if (!id || !/^[01]+$/.test(bits)) { out.innerHTML = `<p class="err">Enter a circuit number and answers made of 0 and 1.</p>`; return; }
      out.innerHTML = `<p class="mute">Asking X Layer…</p>`;
      try {
        const info = await circuitInfo(id), owner = await circuitOwner(id);
        if (bits.length !== info.nIn) { out.innerHTML = `<p class="err">Circuit #${id} has ${info.nIn} inputs, but you gave ${bits.length} answers.</p>`; return; }
        const m = [...bits].reduce((acc, ch, k) => acc + (ch === "1" ? 2 ** k : 0), 0), res = await evalOnChain(id, m, info.nIn, info.nOut);
        out.innerHTML = `<p><b>Result number: ${res}</b> (circuit #${id} has ${info.nIn} inputs and ${info.nOut} outputs; owner <code>${owner}</code>)</p><p class="small">Open the checker that matches this circuit to see what result number ${res} means.</p>`;
      } catch (e) { out.innerHTML = `<p class="err">Could not read that circuit: ${esc(e.message)}</p>`; }
    };
  }

  function about() {
    main.innerHTML = `<h1>How it works</h1>
    <div class="card"><h3>In plain words</h3><ol><li>A business writes its policy as simple rules: yes/no questions and a list of results.</li><li>The rules become a small circuit stored on X Layer through TapeOut. Once stored it can't be changed, so the business can't quietly change the rules after a claim.</li><li>A customer answers the questions and sees the result and the reason.</li><li>If the customer and the business answer a question differently, only that question goes to a neutral reviewer.</li><li>Anyone can run the same answers through the same circuit and get the same result, for free.</li></ol></div>
    <h2>What it does not do</h2>
    <div class="note">It does not check that the answers are true. If someone gives a false answer, the result will follow the false answer. The reviewer decides disputed facts, and a reviewer can be wrong. The circuit shows the rules were applied consistently, nothing more.</div>
    <div class="note">A person is not a wallet. Where an operator submits answers for someone without a wallet, that is recorded, and you are trusting the operator to pass them on unchanged.</div>
    <h2>Status</h2><p>Prototype built for the X Layer TapeOut Accelerate hackathon. The contracts are unaudited and hold no funds. This page currently computes checkers in your browser and confirms against the chain once a checker has been published.</p>`;
  }

  // ---------- router ----------
  function route() {
    const h = location.hash.replace(/^#/, ""), [view, key, ...rest] = h.split("/");
    document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.k === view));
    window.scrollTo(0, 0);
    if (!view) return home();
    if (view === "check") return check(key || "warranty", rest.join("/"));
    if (view === "build") return build();
    if (view === "verify") return verify();
    if (view === "about") return about();
    home();
  }
  window.addEventListener("hashchange", route);
  route();
})();
