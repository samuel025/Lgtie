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

  // Reads one RuleSetRegistry entry (the dynamic name string is skipped): -> {publisher, processor, circuitId, nQ, nOut, hash, previousId, publishedAt}
  async function fetchRuleSet(id) {
    if (/^0x0+$/.test(CFG.registry)) return null;
    const x = (await rpc("eth_call", [{to: CFG.registry, data: "0x9507d39a" + w(id)}, "latest"])).replace("0x", ""), W = i => x.slice(i * 64, i * 64 + 64);
    return {publisher: "0x" + W(1).slice(24), processor: "0x" + W(2).slice(24), circuitId: Number(BigInt("0x" + W(3))), nQ: Number(BigInt("0x" + W(4))), nOut: Number(BigInt("0x" + W(5))), hash: "0x" + W(6), previousId: Number(BigInt("0x" + W(7))), publishedAt: Number(BigInt("0x" + W(8)))};
  }
  // ---------- policies ----------
  function loadPolicy(key) {
    if (TB.TEMPLATES[key]) { const r = TB.parse(TB.TEMPLATES[key]); return {key, policy: r.policy, text: TB.TEMPLATES[key]}; }
    if (key.startsWith("c=")) { try { const text = b64d(key.slice(2)), r = TB.parse(text); if (!r.errors.length) return {key, policy: r.policy, text, custom: true}; } catch {} }
    return null;
  }

  // ---------- views ----------
  // Flowing signal lines: a quiet wave illustration made of thin paths (monochrome).
  function waves() {
    const paths = [[0.5, 20, 0], [0.45, 26, 60], [0.5, 32, 120], [0.55, 24, 30], [0.5, 38, 90], [0.6, 22, 150], [0.55, 30, 10], [0.62, 18, 100]].map(([yf, amp, ph], i) => {
      const y0 = 30 + i * 21 + yf * 8, step = 100; let d = `M${-240 - ph} ${y0}Q${-190 - ph} ${y0 - amp} ${-140 - ph} ${y0}`;
      for (let x = -40 - ph; x < 1500; x += step) d += `T${x} ${y0}`;
      return `<path d="${d}" opacity="${(0.55 - i * 0.045).toFixed(2)}"/>`;
    }).join("");
    return `<div class="waves" aria-hidden="true"><svg viewBox="0 0 1200 210" preserveAspectRatio="none">${paths}</svg></div>`;
  }
  function home() {
    const I = k => ({
      check: '<rect x="6" y="4" width="20" height="24" rx="4"/><path d="M11 12l2 2 4-4M11 20l2 2 4-4M20 12h3M20 20h3"/>',
      build: '<rect x="4" y="5" width="14" height="22" rx="3"/><path d="M8 11h6M8 15h6M8 19h4"/><path d="M19 16h2M21 12.5h2.5a3.5 3.5 0 010 7H21z"/>',
      agree: '<circle cx="12" cy="16" r="7"/><circle cx="20" cy="16" r="7"/><path d="M13.5 16.5l2 2 3.5-4"/>',
      verify: '<circle cx="14" cy="14" r="8"/><path d="M20 20l7 7M11 11h2.5a3 3 0 010 6H11z"/>',
      review: '<path d="M16 5v21M9 26h14M5 10h22M5 10l-3 8h6zM27 10l-3 8h6z"/>'}[k]);
    const ic = k => `<svg class="ic" viewBox="0 0 32 32" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I(k)}</svg>`;
    main.innerHTML = `
    <section class="hero2"><div class="wrap">
      <span class="tag">Rules anyone can re-run</span>
      <h1>Know if you are covered before you file.</h1>
      <p class="sub">Businesses publish their policy once, as a checker anyone can use. You answer plain questions, see the result and the reason, and anyone can re-run it and get the same answer.</p>
      <div class="cta"><a class="btn" href="#check/warranty">Try the warranty check <span class="arr">→</span></a><a class="link" href="#build">Publish your own policy</a></div>
      <div class="viz" id="heroviz" aria-label="A live simulation of the circuit"></div>
    </div></section>
    ${waves()}
    <section class="facts"><div class="wrap">
      <div class="fact"><b><span data-count="39">0</span></b><span>NAND gates in the live warranty circuit, published as circuit #13</span></div>
      <div class="fact"><b><span data-count="128">0</span><small>/128</small></b><span>answer combinations checked against the rules on X Layer mainnet</span></div>
      <div class="fact"><b><span data-count="0">0</span></b><span>funds held by any LGtie contract</span></div>
    </div></section>
    <section class="sec"><div class="wrap">
      <h2>Pick where you start.</h2>
      <p class="lede">From a first check to a public record of how disputes ended.</p>
      <div class="cats">
        <a class="cat" href="#check/warranty">${ic("check")}<h3>Check a claim</h3><p>Answer yes or no, see the result and the exact reason. No account, no wallet.</p><span class="go">Open the checker <span class="arr">→</span></span></a>
        <a class="cat" href="#build">${ic("build")}<h3>Publish your policy</h3><p>Paste your rules and get a checker you can put on your support page.</p><span class="go">Build a checker <span class="arr">→</span></span></a>
        <a class="cat" href="#agree">${ic("agree")}<h3>Agree first</h3><p>Fix the rules, the reviewer and the time limits before any dispute starts.</p><span class="go">Make an agreement <span class="arr">→</span></span></a>
        <a class="cat" href="#verify">${ic("verify")}<h3>Check it yourself</h3><p>Re-run a published rule set on X Layer and see the same answer.</p><span class="go">Verify a circuit <span class="arr">→</span></span></a>
        <a class="cat" href="#reviewer">${ic("review")}<h3>See the record</h3><p>Who decided and who missed a deadline, read straight from the chain.</p><span class="go">Reviewer records <span class="arr">→</span></span></a>
      </div></div></section>
    <section class="sec"><div class="wrap">
      <h2>Dispute the facts, not the verdict.</h2>
      <p class="lede">Instead of arguing about an outcome, both sides answer the same questions. Only the answers that differ need a person.</p>
      <div class="steps">
        <div class="step"><span class="n">1</span><h3>Publish the rules</h3><p>The business writes its policy once. It is stored on X Layer and can't be changed.</p></div>
        <div class="step"><span class="n">2</span><h3>Both sides answer</h3><p>The same yes or no questions, each with the evidence to show.</p></div>
        <div class="step"><span class="n">3</span><h3>Only differences go to a reviewer</h3><p>A neutral person both sides accepted decides just the disputed questions.</p></div>
        <div class="step"><span class="n">4</span><h3>The circuit gives the result</h3><p>The published rules turn the final answers into a result and a reason.</p></div>
        <div class="step"><span class="n">5</span><h3>Anyone can re-run it</h3><p>One free read on X Layer returns the same result, with no account.</p></div>
      </div></div></section>
    <section class="sec"><div class="wrap">
      <h2>What it does not do.</h2>
      <div class="limits">
        <div><h3>It can't tell if an answer is true</h3><p>If someone gives a false answer, the result follows it. A reviewer decides disputed facts, and a reviewer can be wrong.</p></div>
        <div><h3>It holds no money</h3><p>The contracts record decisions only. A separate contract can read a verdict and pay out.</p></div>
        <div><h3>It is a prototype</h3><p>The contracts are unaudited, and no customers or revenue exist yet.</p></div>
      </div></div></section>
    <section class="finalcta"><div class="wrap">
      <h2>Try it in a minute.</h2><p>Answer seven questions and watch the result get confirmed by a circuit on X Layer.</p>
      <div class="cta"><a class="btn" href="#check/warranty">Open the warranty checker <span class="arr">→</span></a><a class="link" href="#about">How it works</a></div>
    </div></section>`;
    window.TB_HERO.mountHero(main.querySelector("#heroviz")); window.TB_HERO.countUps(main);
  }

  // Snippets for putting a checker on another website (static: a script tag that adds an iframe, or a plain iframe).
  function embedBox(key, rsm, P) {
    const dir = location.href.split("#")[0].replace(/[^/]*$/, ""), spec = key + (rsm ? "/rs=" + rsm[1] : ""), script = `<div></div>\n<script src="${dir}embed.js" data-checker="${spec}" async></script>`, frame = `<iframe src="${dir}index.html#embed/${spec}" title="${P.name}" style="width:100%;height:640px;border:0"></iframe>`;
    return `<details class="card" id="embedbox"><summary>Put this checker on your own website</summary><p class="small">Paste this where you want the checker to appear. It resizes itself and needs nothing else.</p><pre id="snip1">${esc(script)}</pre><div class="row"><button class="btn small ghost" id="cps1" type="button">Copy</button></div>
      <p class="small">Or use a plain frame:</p><pre id="snip2">${esc(frame)}</pre><div class="row"><button class="btn small ghost" id="cps2" type="button">Copy</button></div></details>`;
  }
  async function check(key, rest, embed) {
    const L = loadPolicy(key); if (!L) { main.innerHTML = `<h1>We could not open that checker</h1><p>The link may be incomplete. <a href="#check/warranty">Open the warranty example</a>.</p>`; return; }
    const P = L.policy, C = TB.compile(P), nQ = P.questions.length, rsm = /(?:^|[/&])rs=(\d+)/.exec(rest || ""), tail = (rsm ? "rs=" + rsm[1] + "&" : ""), pre = "#" + (embed ? "embed" : "check") + "/" + key + "/" + tail, fullPre = "#check/" + key + "/" + tail;
    let published = CFG.published[key], banner = "";
    if (!published && rsm && L.custom) {
      try {
        const rec = await fetchRuleSet(Number(rsm[1])), h = await sha256(TB.canonical(P));
        if (rec && rec.hash === h && rec.processor === CFG.processor.toLowerCase() && rec.nQ === nQ && rec.nOut === C.nOut) { published = {circuitId: rec.circuitId, ruleSetId: Number(rsm[1])}; banner = `<div class="note ok-note">✓ These rules match rule set #${rsm[1]} published on X Layer (circuit #${rec.circuitId}).</div>`; }
        else banner = `<div class="note">These rules do <b>not</b> match rule set #${rsm[1]} on X Layer, so the result below is only a preview. Ask the business for the original link.</div>`;
      } catch { banner = `<div class="note">Could not reach X Layer to confirm that these rules were published, so the result below is only a preview.</div>`; }
    }
    let ans = Array(nQ).fill(null);
    const a = /(?:^|[/&])a=(\d+)/.exec(rest || ""); if (a) { const m = Number(a[1]); ans = TB.decodeAnswers(m, nQ); }
    main.innerHTML = `<h1>${esc(P.name)}</h1><p class="lede">${esc(P.about || "")}</p>${banner}
      <div class="prog"><i id="bar"></i></div><div class="small mute" id="count"></div>
      ${embed ? "" : `<details class="card circ-card"><summary>Watch the circuit work</summary><p class="small mute">Each dot is a NAND gate. Dark is 1 and light is 0. Answer every question to light it up. This is a local simulation of the same ${C.gates.length} gates.</p><div id="circviz"></div></details>`}
      <div id="qs"></div><div id="resbox"></div>${embed ? `<p class="small mute embedfoot">Checked with <b>LGtie</b> · <a href="${esc(location.href.split("#")[0] + fullPre.replace(/&$/, "").replace(/\/$/, ""))}" target="_blank" rel="noopener">Open the full page</a></p>` : embedBox(key, rsm, P)}`;
    const qs = $("#qs");
    P.questions.forEach((q, i) => {
      const d = document.createElement("div"); d.className = "q"; d.innerHTML = `<div class="t">${i + 1}. ${esc(q.text)}</div>${q.hint ? `<div class="h">Evidence: ${esc(q.hint)}</div>` : ""}<div class="yn" role="group" aria-label="Answer to question ${i + 1}"><button type="button" data-v="1" aria-pressed="false">Yes</button><button type="button" data-v="0" aria-pressed="false">No</button></div>`;
      d.querySelectorAll("button").forEach(b => b.onclick = () => { ans[i] = b.dataset.v === "1"; paint(); });
      qs.appendChild(d);
    });
    const cv = embed ? null : window.TB_HERO.circuit($("#circviz"), C, {w: 520, h: 230, label: "Your answers running through the circuit"});
    let seq = 0;
    const report = () => { if (embed && window.parent !== window) window.parent.postMessage({lgtie: "height", h: Math.ceil(main.getBoundingClientRect().bottom + window.scrollY + 12)}, "*"); };
    if (embed && window.ResizeObserver) new ResizeObserver(report).observe(document.body);
    function paint() {
      qs.querySelectorAll(".q").forEach((d, i) => d.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(ans[i] !== null && (b.dataset.v === "1") === ans[i]))));
      setTimeout(report, 0);
      const done = ans.filter(x => x !== null).length; if (cv) cv.update(done === nQ ? ans : null); $("#bar").style.width = (100 * done / nQ) + "%"; $("#count").textContent = `${done} of ${nQ} answered`;
      const box = $("#resbox");
      if (done < nQ) { box.innerHTML = ""; return; }
      const r = TB.run(P, ans), m = TB.encodeAnswers(ans), link = location.href.split("#")[0] + fullPre + "a=" + m, mine = ++seq;
      const hexIn = inputBytes(m, nQ), rule = r.ruleIndex >= 0 ? "Rule " + (r.ruleIndex + 1) + ": " + P.rules[r.ruleIndex].conds.map(c => `question ${c.q + 1} = ${c.yes ? "yes" : "no"}`).join(" and ") : "No rule matched, so the default applies";
      box.innerHTML = `<div class="res" role="status"><div class="big">${esc(P.results[r.result])}</div><div class="why">${esc(r.why || "")}</div>
        <div class="row"><span class="badge" id="vbadge">Checking…</span><button class="btn small ghost" id="cp" type="button">Copy link to this result</button><button class="btn small ghost" id="rs" type="button">Start over</button></div>
        <details><summary>Check this result yourself</summary>
          <p class="small">${esc(rule)}. The same answers go into the published rules, and anyone can run them.</p>
          ${published ? `<p class="small">Published on X Layer as circuit <b>#${published.circuitId}</b> on processor <code>${CFG.processor}</code>. Anyone can run this command:</p><pre>cast call ${CFG.processor} "eval(uint256,bytes)(bytes)" ${published.circuitId} 0x${hexIn} --rpc-url ${CFG.rpc}</pre><p class="small">The first byte of the answer is the result number (${r.result} = ${esc(P.results[r.result])}).</p>`
            : `<p class="small">This checker has not been published on X Layer yet, so the result above is computed in your browser from the same rules. Once published, the page asks the TapeOut processor and shows a confirmation.</p>`}
          <p class="small">Circuit: ${C.gates.length} NAND gates, ${nQ} inputs, ${C.nOut} outputs.</p><pre>${C.hex}</pre></details></div>`;
      $("#cp").onclick = e => copy(link, e.target); $("#rs").onclick = () => { ans = Array(nQ).fill(null); history.replaceState(null, "", pre.replace(/[/&]$/, "")); paint(); window.scrollTo({top: 0, behavior: "smooth"}); };
      history.replaceState(null, "", pre + "a=" + m);
      const vb = $("#vbadge");
      if (!published) { vb.className = "badge warn"; vb.textContent = "Preview: computed in your browser"; return; }
      evalOnChain(published.circuitId, m, nQ, C.nOut).then(got => { if (mine !== seq) return; if (got === r.result) { vb.className = "badge ok"; vb.textContent = "✓ Confirmed by the TapeOut processor on X Layer"; } else { vb.className = "badge warn"; vb.textContent = "The chain gave a different result. Do not rely on this page."; } })
        .catch(() => { if (mine !== seq) return; vb.className = "badge warn"; vb.textContent = "Could not reach X Layer; showing the browser result"; });
    }
    paint(); report();
    const c1 = $("#cps1"); if (c1) { c1.onclick = e => copy($("#snip1").textContent, e.target); $("#cps2").onclick = e => copy($("#snip2").textContent, e.target); }
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

  // ---------- motion: frosted header on scroll, scroll reveal, page entrance (all transform and opacity) ----------
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches, hdr = document.querySelector("header");
  const onScroll = () => hdr.classList.toggle("scrolled", window.scrollY > 8); window.addEventListener("scroll", onScroll, {passive: true}); onScroll();
  const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), {threshold: .12, rootMargin: "0px 0px -6% 0px"}) : null;
  const REVEAL = ".hero2 .tag,.hero2 h1,.hero2 .sub,.hero2 .cta,.viz,.waves,.fact,.sec h2,.sec .lede,.cat,.step,.limits>div,.finalcta h2,.finalcta p,.finalcta .cta,.card,.q";
  let armed = false, armTimer = 0;
  function scan() {
    if (!armed || !io) return;
    main.querySelectorAll(REVEAL).forEach((el, i) => { if (el.dataset.r || el.parentElement === main) return; el.dataset.r = "1"; el.classList.add("rv"); el.style.setProperty("--d", Math.min(i, 9) * 0.06 + "s"); io.observe(el); });
  }
  if (!reduce) new MutationObserver(scan).observe(main, {childList: true, subtree: true});
  function armReveal(embed) { armed = !embed && !reduce; clearTimeout(armTimer); armTimer = setTimeout(() => { armed = false; }, 2500); scan(); }

  // ---------- router ----------
  function route() {
    window.TB_HERO.stop();
    const h = location.hash.replace(/^#/, ""), [view, key, ...rest] = h.split("/");
    document.body.classList.toggle("embed", view === "embed");
    main.classList.toggle("home", !view); main.classList.remove("enter");
    if (view !== "embed" && view && !reduce) { void main.offsetWidth; main.classList.add("enter"); setTimeout(() => main.classList.remove("enter"), 700); }
    armReveal(view === "embed");
    document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.k === view));
    window.scrollTo(0, 0);
    if (!view) return home();
    if (view === "check") return check(key || "warranty", rest.join("/"));
    if (view === "embed") return check(key || "warranty", rest.join("/"), true);
    if (view === "agree") return window.TB_CASES.agreements();
    if (view === "agreement") return key ? window.TB_CASES.agreement(key) : window.TB_CASES.agreements();
    if (view === "business") return key ? window.TB_CASES.business(key) : window.TB_CASES.list();
    if (view === "reviewer") return key ? window.TB_CASES.reviewer(key) : window.TB_CASES.reviewers();
    if (view === "case") return key ? window.TB_CASES.view(key) : window.TB_CASES.list();
    if (view === "build") return window.TB_BUILD.build();
    if (view === "verify") return verify();
    if (view === "about") return about();
    home();
  }
  window.addEventListener("hashchange", route);
  route();
})();
