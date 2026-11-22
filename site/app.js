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
  // The tie: two threads (two sides) run in from the edges and knot into one line (one result). Drawn once, in ink and vermilion.
  function tie() {
    return `<svg class="tie" viewBox="0 0 1280 800" preserveAspectRatio="none" aria-hidden="true">
      <path class="t1" d="M-20 150C380 120 560 140 660 470"/>
      <path class="t2" d="M-20 790C380 830 560 800 660 490"/></svg>`;
  }
  const art = (kind) => `<div class="art ${kind}"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i></div>`;
  function home() {
    const feat = (flip, kind, tag, h, items, ui) => `<div class="row2${flip ? " flip" : ""}">
      <div class="txt"><span class="tag">${tag}</span><h3>${h}</h3><div class="acc">${items.map((it, i) => `<details name="${tag}"${i === 0 ? " open" : ""}><summary>${it[0]}</summary><p>${it[1]}</p></details>`).join("")}</div></div>
      <div class="panel pnl">${art(kind)}<div class="ui">${ui}</div></div></div>`;
    main.innerHTML = `
    <section class="hero3"><div class="wrap hgrid">${tie()}
      <div class="hcopy">
        <span class="tag"><i class="dot"></i>Two sides, one set of questions</span>
        <h1>Know if you are covered before you file.</h1>
        <p class="sub">Businesses publish their policy once, as a checker anyone can use. You answer plain questions, see the result and the reason, and anyone can re-run it and get the same answer.</p>
        <div class="cta"><a class="btn" href="#check/warranty">Try the warranty check <span class="arr">→</span></a><a class="btn ghost" href="#build">Publish your policy</a></div>
        <p class="small mute fine">No account. No wallet. Nothing is held for anyone.</p>
      </div>
      <div class="panel stage">${art("ember")}<div class="viz" id="heroviz" aria-label="A live simulation of the circuit"></div></div>
    </div></section>
    <div class="runs wrap"><span class="lbl">Built with</span><span>X Layer</span><span>TapeOut circuits</span><span>Solidity</span><span>One static file</span></div>
    <div class="wrap"><div class="stats3 facts">
      <div class="stat fact"><b><span data-count="39">0</span></b><span>NAND gates in the live warranty circuit (#13)</span></div>
      <div class="stat fact"><b><span data-count="128">0</span></b><span>of 128 answer combinations checked on mainnet</span></div>
      <div class="quote fact">A rules engine with a dispute process, not a truth oracle. If someone lies, the result follows the lie, so a reviewer both sides accepted decides the disputed facts.<div class="by"><span class="av"><svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.5"><path d="M6.5 6.5h5a5.5 5.5 0 010 11h-5z"/><circle cx="19" cy="12" r="1.5"/></svg></span><span>How LGtie describes itself<br>Prototype, unaudited, holds no funds</span></div></div>
    </div></div>
    <section class="sec"><div class="wrap">
      <div class="sechead"><h2>Dispute the facts, not the verdict.</h2><p class="lede">Instead of arguing about an outcome, both sides answer the same questions. Only the answers that differ need a person.</p></div>
      ${feat(false, "sand", "Check a claim", "Know the answer before you file", [
        ["Answers in plain yes or no", "Each question says what evidence to show. No account and no wallet are needed."],
        ["A result and the exact reason", "The checker names the rule that decided it, so nothing is a black box."],
        ["The same result for everyone", "A free read on X Layer re-runs the published rules and returns the same answer."]],
        `<div class="bub">Was it bought from an authorised seller?</div><div class="bub me">No</div><div class="bub">Got it. That needs a person to look at it.</div><div class="bub res2"><div class="t">Needs review</div><small>It was not bought from an authorised seller, so a person has to look at it.</small></div>`)}
      ${feat(true, "ink", "Agree first", "Fix the terms before any dispute", [
        ["The rules, locked in", "An agreement names the published rule set. Once both sides accept, it can't change."],
        ["A reviewer both sides accept", "Disputed questions go to a neutral person each side has approved."],
        ["Deadlines that settle themselves", "If nobody decides in time, the case ends as no decision. Nobody wins by default."]],
        `<div class="mini"><div class="ln"><span class="k">Rule set</span><span>Warranty claims</span></div><div class="ln"><span class="k">Reviewer</span><span>Accepted by both</span></div><div class="ln"><span class="k">Time to decide</span><span>7 days</span></div><div class="ln"><span class="k">Status</span><span class="chip">Accepted</span></div></div>`)}
      ${feat(false, "ember", "Verify", "Check it yourself, free", [
        ["Re-run any published rule set", "Paste a circuit id and the answers. The chain returns the result."],
        ["Reviewer records are public", "See who decided, how often, and who missed a deadline."],
        ["No money moves", "The contracts record decisions only. A separate contract can read a verdict and pay out."]],
        `<div class="mini"><div class="ln"><span class="k">Circuit</span><span>#13 on X Layer</span></div><div class="ln"><span class="k">Answers</span><span><code>1111101</code></span></div><div class="ln"><span class="k">Result</span><span>Covered</span></div><div class="ln"><span class="k">Cost</span><span class="chip">Free read</span></div></div>`)}
    </div></section>
    <section class="sec"><div class="wrap">
      <div class="sechead"><h2>Get started in minutes</h2></div>
      <div class="steps3"><div class="lst">
        <div class="s3"><span class="n">1.</span><p>Write your policy as questions and rules</p></div>
        <div class="s3"><span class="n">2.</span><p>Prove the circuit matches, then publish it on X Layer</p></div>
        <div class="s3"><span class="n">3.</span><p>Share the link or paste one snippet into your support page</p></div>
        <div><a class="btn" href="#build">Build a checker <span class="arr">→</span></a></div>
      </div>
      <div class="snippet panel">${art("sand")}<div class="win"><pre><code>&lt;script src="embed.js"
  data-checker="warranty"&gt;
&lt;/script&gt;</code></pre><div class="ok2"><span class="chip">Live</span> Checker appears on your page</div></div></div></div>
    </div></section>
    <div class="wrap"><section class="panel make">${art("sun")}<div><h2>Publish your own checker</h2><p class="lede">Paste your rules, check the circuit against them, and get a link customers can use.</p><div class="cta"><a class="btn" href="#build">Open the builder <span class="arr">→</span></a></div></div></section></div>
    <section class="sec"><div class="wrap">
      <div class="sechead"><h2>What it does not do.</h2></div>
      <div class="trio">
        <div><h3>It can't tell if an answer is true</h3><p>If someone gives a false answer, the result follows it. A reviewer decides disputed facts, and a reviewer can be wrong.</p></div>
        <div><h3>It holds no money</h3><p>The contracts record decisions only. A separate contract can read a verdict and pay out.</p></div>
        <div><h3>It is a prototype</h3><p>The contracts are unaudited, and no customers or revenue exist yet.</p></div>
      </div></div></section>
    <section class="sec"><div class="wrap faq">
      <h2 style="text-align:center">Frequently asked questions</h2>
      <div class="acc">
        <details><summary>Do I need a wallet to use a checker?</summary><p>No. Checking a claim needs no account and no wallet. Wallets are only for publishing and for cases.</p></details>
        <details><summary>What does the circuit add over a normal website?</summary><p>The rules are published as data on X Layer, so nobody can quietly change them, and anyone can re-run them for free.</p></details>
        <details><summary>Who decides a disputed answer?</summary><p>A reviewer both sides accepted in advance, with a deadline. If no decision comes in time, the case ends as no decision.</p></details>
        <details><summary>Is it safe to rely on?</summary><p>It is a hackathon prototype. The contracts are unaudited and hold no funds. Treat results as a clear explanation of the rules, not legal advice.</p></details>
      </div></div></section>
    <div class="wrap"><section class="panel finish">${art("ember")}<div><h2>Try it in a minute.</h2><div class="cta"><a class="btn" href="#check/warranty">Open the warranty checker <span class="arr">→</span></a></div></div></section></div>`;
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
  const REVEAL = ".hcopy>*,.stage,.stat,.quote,.sechead,.row2,.s3,.snippet,.make,.trio>div,.faq,.finish,.card,.q";
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
