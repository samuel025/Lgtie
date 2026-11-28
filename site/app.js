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

  // ---------- formal check of a published circuit (see verify.js) ----------
  const LANG = () => (window.TB_I18N && window.TB_I18N.lang) || "en";
  const netlistOf = async id => { const x = (await rpc("eth_call", [{to: CFG.processor, data: "0x3fc4be56" + w(id)}, "latest"])).replace("0x", ""), off = Number(BigInt("0x" + x.slice(0, 64))) * 2, len = Number(BigInt("0x" + x.slice(off, off + 64))); return "0x" + x.slice(off + 64, off + 64 + len * 2); };
  async function formalOnChain(P, id) {
    const [info, hex] = await Promise.all([circuitInfo(id), netlistOf(id)]), V = window.TB_VERIFY, nQ = P.questions.length, nOut = V.outBits(P.results.length);
    if (info.nIn !== nQ || info.nOut !== nOut) return {mismatch: V.describeMismatch(info, {nQ, nOut}, LANG())};
    const res = V.check(P, hex), src = `X Layer circuit #${id} on processor ${CFG.processor}`;
    const rep = V.report(P, res, {compiler: TB.COMPILER_VERSION, policyHash: await sha256(TB.canonical(P)), netlistHash: await V.netlistFingerprint(hex), source: src});
    return {res, rep, hex};
  }
  const downloadJson = (obj, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], {type: "application/json"})); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
  function showFormal(el, P, out) {
    if (out.mismatch) { el.innerHTML = `<p class="err">${esc(out.mismatch)}</p>`; return; }
    const d = window.TB_VERIFY.describe(out.res, P, LANG());
    el.innerHTML = `<p class="${d.level === "ok" ? "ok" : d.level === "err" ? "err" : "mute"}"><b>${esc(d.headline)}</b></p><p class="small">${esc(d.detail)}</p>
      <p class="small mute">Rules fingerprint <code>${esc(out.rep.policy.rulesFingerprintSha256)}</code><br>Circuit fingerprint <code>${esc(out.rep.circuit.netlistFingerprintSha256)}</code> (${out.res.nGates} gates)</p>
      <div class="row"><button class="btn small ghost" type="button" data-dlrep="1">Download the verification report</button></div>`;
    el.querySelector("[data-dlrep]").onclick = () => downloadJson(out.rep, "lgtie-verification-report.json");
  }
  // A "verify against the chain" box: reads the published netlist from X Layer and checks it against the rules on this page.
  function formalBox(el, P, circuitId) {
    el.innerHTML = `<h4 class="fvh">Formal check of the published circuit</h4><p class="small">Read the circuit from X Layer and prove, for every possible set of answers, that it gives the same result as these rules. This checks what was actually published, not a copy made in your browser.</p>
      <div class="row"><button class="btn small" type="button" data-fv="1">Verify against the chain</button></div><div class="fvout" aria-live="polite"></div>`;
    el.querySelector("[data-fv]").onclick = async e => {
      const out = el.querySelector(".fvout"); e.target.disabled = true; out.innerHTML = `<p class="mute">Reading the circuit from X Layer…</p>`;
      try { showFormal(out, P, await formalOnChain(P, circuitId)); } catch (err) { out.innerHTML = `<p class="err">Could not read that circuit: ${esc(err.message)}</p>`; }
      e.target.disabled = false;
    };
  }
  const circuitOwner = async id => "0x" + (await rpc("eth_call", [{to: CFG.processor, data: "0x6352211e" + w(id)}, "latest"])).slice(-40);

  // Reads one RuleSetRegistry entry (the dynamic name string is skipped): -> {publisher, processor, circuitId, nQ, nOut, hash, previousId, publishedAt}
  async function fetchRuleSet(id) {
    if (/^0x0+$/.test(CFG.registry)) return null;
    const x = (await rpc("eth_call", [{to: CFG.registry, data: "0x9507d39a" + w(id)}, "latest"])).replace("0x", ""), W = i => x.slice(i * 64, i * 64 + 64);
    return {publisher: "0x" + W(1).slice(24), processor: "0x" + W(2).slice(24), circuitId: Number(BigInt("0x" + W(3))), nQ: Number(BigInt("0x" + W(4))), nOut: Number(BigInt("0x" + W(5))), hash: "0x" + W(6), previousId: Number(BigInt("0x" + W(7))), publishedAt: Number(BigInt("0x" + W(8)))};
  }
  // ---------- policies ----------
  function loadPolicy(key) {
    if (TB.TEMPLATES[key]) { const text = TB.templateText ? TB.templateText(key, true) : TB.TEMPLATES[key], r = TB.parse(text); return {key, policy: r.policy, text}; }   // a published template stays in English: its fingerprint is on-chain
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
        <span class="tag"><i class="dot"></i>Fair claims and disputes</span>
        <h1>Settle disputes fairly, with rules everyone can see first.</h1>
        <p class="sub">A business publishes its rules before anything goes wrong. You both answer the same yes or no questions. Only the answers you disagree on go to a neutral person, and anyone can check the result.</p>
        <div class="cta"><a class="btn" href="#check/warranty">Try a claim check <span class="arr">→</span></a><a class="btn ghost" href="#case/1">See a real case</a></div>
        <div class="quick" aria-label="Quick links"><b>Jump to</b><a href="#templates">Templates</a><a href="#build">Build a checker</a><a href="#agree">Make an agreement</a><a href="#pk/agree">Invite a customer</a><a href="#mine">My cases</a><a href="#join">Get a passkey</a><a href="#reviewer">See who decided cases</a><a href="#verify">Re-check a result</a></div>
        <p class="small mute fine">Checking a claim needs no account and no wallet. LGtie never holds anyone's money.</p>
      </div>
      <div class="panel stage">${art("ember")}<div class="viz" id="heroviz" aria-label="A live simulation of the circuit"></div></div>
    </div></section>
    <div class="runs wrap"><span class="lbl">Built with</span><span>X Layer</span><span>TapeOut circuits</span><span>Solidity</span><span>One static file</span></div>
    <section class="startsec"><div class="wrap"><div class="sechead"><h2>Where do you want to start?</h2><p class="lede">Pick the one that sounds like you.</p></div>
      ${window.TB_GFX.paths([["customer", "I have a claim or a complaint", "Find out whether you are covered, and keep a clear record of how it was decided.", "#check/warranty", "Check a claim"], ["business", "I run a business", "Publish clear rules, invite customers, and settle disagreements fairly.", "#for-business", "See what you can do"], ["reviewer", "I was asked to review a case", "A neutral person decides only the questions the two sides disagree on.", "#about", "How reviewing works"]])}</div></section>
    <section class="flowsec"><div class="wrap"><div class="sechead"><h2>From rules to result</h2><p class="lede">One idea: settle only what the two sides disagree on.</p></div>${window.TB_GFX.flow()}</div></section>
    <div class="wrap"><div class="stats3 facts">
      <div class="stat fact"><b><span data-count="7">0</span></b><span>yes or no questions decide a warranty claim</span></div>
      <div class="stat fact"><b><span data-count="128">0</span></b><span>of 128 possible situations checked against the written rules, all matching</span></div>
      <div class="quote fact">LGtie checks that the rules are applied the same way every time. It cannot tell whether someone is telling the truth, so a neutral person settles the facts the two sides disagree on.<div class="by"><span class="av"><svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.5"><path d="M6.5 6.5h5a5.5 5.5 0 010 11h-5z"/><circle cx="19" cy="12" r="1.5"/></svg></span><span>How LGtie describes itself<br>Early prototype, unaudited, holds no money</span></div></div>
    </div></div>
    <section class="sec"><div class="wrap">
      <div class="sechead"><h2>Not a mock-up.</h2><p class="lede">We ran a complete case on the live network: an agreement, answers from both sides, a decision and a free re-check. All three roles were wallets we controlled, so treat it as a demonstration, not a customer.</p></div>
      <div class="card realcase" id="realcase" style="margin-top:28px"><p class="mute small">Reading the case from X Layer…</p></div>
    </div></section>
    <section class="sec"><div class="wrap">
      <div class="sechead"><h2>Dispute the facts, not the verdict.</h2><p class="lede">Instead of arguing about an outcome, both sides answer the same questions. Only the answers that differ need a person.</p></div>
      ${feat(false, "sand", "When you disagree", "Only the disputed answers go to a person", [
        ["Both sides answer the same questions", "Each side answers on its own, before a deadline, under the rules you both agreed to."],
        ["Agreed answers stand", "Where the two sides give the same answer, nobody needs to decide anything."],
        ["A neutral person settles only the differences", "Someone you both accepted answers just the questions you disagree on. The agreed rules then give the result."]],
        `<div class="mini"><div class="ln"><span class="k">1. Registered?</span><span>Yes · No → <b>Reviewer: Yes</b></span></div><div class="ln"><span class="k">2. In warranty?</span><span>Yes · Yes → agreed</span></div><div class="ln"><span class="k">3. Authorised seller?</span><span>Yes · Yes → agreed</span></div><div class="ln"><span class="k">Result</span><span class="chip">Covered</span></div></div>`)}
      ${feat(true, "ink", "Agree first", "Fix the terms before any dispute", [
        ["The rules, locked in", "The agreement points to the public rules. Once both sides accept, it can't change."],
        ["A neutral person you both accept", "Disputed questions go to someone each side approved in advance."],
        ["Deadlines that settle themselves", "If nobody decides in time, the case ends as no decision. Nobody wins by default."]],
        `<div class="mini"><div class="ln"><span class="k">Rule set</span><span>Warranty claims</span></div><div class="ln"><span class="k">Reviewer</span><span>Accepted by both</span></div><div class="ln"><span class="k">Time to decide</span><span>7 days</span></div><div class="ln"><span class="k">Status</span><span class="chip">Accepted</span></div></div>`)}
      ${feat(false, "ember", "Verify", "Check it yourself, free", [
        ["Anyone can re-run it", "Enter the answers and the public network gives the same result, for free."],
        ["Reviewer records are public", "See who decided, how often, and who missed a deadline."],
        ["No money is held", "LGtie only records decisions. Another system could read a decision and pay out."]],
        `<div class="mini"><div class="ln"><span class="k">Circuit</span><span>#13 on X Layer</span></div><div class="ln"><span class="k">Answers</span><span><code>1111101</code></span></div><div class="ln"><span class="k">Result</span><span>Covered</span></div><div class="ln"><span class="k">Cost</span><span class="chip">Free read</span></div></div>`)}
      ${feat(true, "sand", "No wallet needed", "Customers approve with their fingerprint or face", [
        ["A passkey instead of a wallet", "The same fingerprint or face scan that unlocks their phone. No app, no seed phrase and no crypto to buy."],
        ["Anyone can send it", "The customer signs; the business, or anyone with a wallet, submits it and pays the tiny fee. The signature covers the exact answers, so nobody can change them."],
        ["Built for high stakes, still early", "The contracts are live on X Layer but unaudited, and recovery for a lost device is still being built. Nothing is held in escrow."]],
        `<div class="mini"><div class="ln"><span class="k">Customer</span><span>A passkey account</span></div><div class="ln"><span class="k">Action</span><span>Answers for a case</span></div><div class="ln"><span class="k">Signed with</span><span>Fingerprint</span></div><div class="ln"><span class="k">Sent by</span><span class="chip">Acme, pays the fee</span></div></div>`)}
      <div class="cta" style="justify-content:flex-start;margin-top:28px"><a class="btn" href="embed-demo.html">Try it on a fictional support page <span class="arr">→</span></a><a class="btn ghost" href="#join">Create a passkey</a></div>
    </div></section>
    <section class="sec"><div class="wrap">
      <div class="sechead"><h2>Get started in minutes</h2></div>
      <div class="steps3"><div class="lst">
        <div class="s3"><span class="n">1.</span><p>Write your policy as questions and rules</p></div>
        <div class="s3"><span class="n">2.</span><p>Check it, then publish it on the public network</p></div>
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
      ${window.TB_GFX.notCards()}
    </div></section>
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
    realCase();
  }
  // The home page's real-case card: read live from X Layer, with the honest note that the team played every role.
  async function realCase() {
    const box = main.querySelector("#realcase"), sc = (window.TB_CONFIG || {}).showcase; if (!box) return;
    if (!sc || !sc.caseId || /^0x0+$/.test(window.TB_CONFIG.caseContract || "")) { box.parentElement.parentElement.remove(); return; }
    try {
      const s = await window.TB_CASES.summary(sc.caseId); if (!main.contains(box)) return;
      const agreed = s.nQ - s.nDisputed, line = s.nDisputed ? `${agreed} of ${s.nQ} answers were agreed, and the reviewer decided the other ${s.nDisputed}.` : `Both sides agreed on all ${s.nQ} answers.`;
      box.innerHTML = `<div class="rcgrid"><div><span class="tag">Case #${sc.caseId} · ${esc(s.statusText)}</span><h3 class="rcres">${s.result ? esc(s.result) : "Not decided yet"}</h3>${s.why ? `<p>${esc(s.why)}</p>` : ""}<p class="small mute">${esc(s.name)}. ${s.status === 2 ? esc(line) : ""} Read from X Layer just now.</p></div>
        <div class="rcbtn"><a class="btn" href="#case/${sc.caseId}">Open the case</a>${s.status === 2 ? `<a class="btn ghost" href="#receipt/${sc.caseId}">See the receipt</a>` : ""}${sc.agreementId ? `<a class="btn ghost" href="#agreement/${sc.agreementId}">See the agreement</a>` : ""}</div></div>`;
    } catch { if (main.contains(box)) box.innerHTML = `<p class="small mute">Could not read the case from X Layer right now. <a href="#case/${sc.caseId}">Open it directly</a>.</p>`; }
  }

  // Snippets for putting a checker on another website (static: a script tag that adds an iframe, or a plain iframe).
  function embedBox(key, rsm, P) {
    const dir = location.href.split("#")[0].replace(/[^/]*$/, ""), spec = key + (rsm ? "/rs=" + rsm[1] : ""), script = `<div></div>\n<script src="${dir}embed.js" data-checker="${spec}" async></script>`, frame = `<iframe src="${dir}index.html#embed/${spec}" title="${P.name}" style="width:100%;height:640px;border:0"></iframe>`;
    return `<details class="card" id="embedbox"><summary>Put this checker on your own website</summary><p class="small">Paste this where you want the checker to appear. It resizes itself and needs nothing else.</p><pre id="snip1">${esc(script)}</pre><div class="row"><button class="btn small ghost" id="cps1" type="button">Copy</button></div>
      <p class="small">Or use a plain frame:</p><pre id="snip2">${esc(frame)}</pre><div class="row"><button class="btn small ghost" id="cps2" type="button">Copy</button></div></details>`;
  }
  // A plain-text summary of one checker run, to paste under a bug report or into a support claim. Built in the browser; nothing is sent anywhere.
  async function claimPack({P, C, ans, r, rule, published, link, hexIn}) {
    const hash = await sha256(TB.canonical(P)), yn = v => v ? "Yes" : "No", where = published ? `rule set #${published.ruleSetId}, circuit #${published.circuitId} on X Layer (processor ${CFG.processor})` : "not published on X Layer yet (result computed in the browser)";
    const lines = ["LGTIE CLAIM PACK", "", "Checker: " + P.name, "Rules: " + where, "Result: " + P.results[r.result], "Reason: " + (r.why || "(none given)"), "Decided by: " + rule, "", "Answers"];
    P.questions.forEach((q, i) => { lines.push(` ${i + 1}. ${q.text}  ${yn(ans[i])}`); if (q.hint) lines.push(`    Evidence to attach: ${q.hint}`); });
    lines.push("", "Re-run these answers: " + link);
    if (published) lines.push("Check on-chain (free):", `  cast call ${CFG.processor} "eval(uint256,bytes)(bytes)" ${published.circuitId} 0x${hexIn} --rpc-url ${CFG.rpc}`);
    lines.push("Rules fingerprint (SHA-256 of the rules text): " + hash, "Made on " + new Date().toISOString().slice(0, 10), "", "This shows how the published rules apply to the answers given. It does not prove the answers are true, and it is not legal advice.");
    return lines.join("\n");
  }
  async function check(key, rest, embed) {
    const L = loadPolicy(key); if (!L) { main.innerHTML = `<h1>We could not open that checker</h1><p>The link may be incomplete. <a href="#check/warranty">Open the warranty example</a>.</p>`; return; }
    const P = L.policy, C = TB.compile(P), nQ = P.questions.length, rsm = /(?:^|[/&])rs=(\d+)/.exec(rest || ""), tail = (rsm ? "rs=" + rsm[1] + "&" : ""), pre = "#" + (embed ? "embed" : "check") + "/" + key + "/" + tail, fullPre = "#check/" + key + "/" + tail;
    let published = CFG.published[key], banner = "";
    if (!published && rsm && L.custom) {
      try {
        const rec = await fetchRuleSet(Number(rsm[1])), h = await sha256(TB.canonical(P));
        if (rec && rec.hash === h && rec.processor === CFG.processor.toLowerCase() && rec.nQ === nQ && rec.nOut === C.nOut) { published = {circuitId: rec.circuitId, ruleSetId: Number(rsm[1])}; banner = `<div class="note ok-note">✓ These rules match rules #${rsm[1]} published on X Layer. <a href="#rules/${rsm[1]}">Version history</a></div>`; }
        else banner = `<div class="note">These rules do <b>not</b> match rules #${rsm[1]} on X Layer, so the result below is only a preview. Ask the business for the original link.</div>`;
      } catch { banner = `<div class="note">Could not reach X Layer to confirm that these rules were published, so the result below is only a preview.</div>`; }
    }
    let ans = Array(nQ).fill(null);
    const a = /(?:^|[/&])a=(\d+)/.exec(rest || ""); if (a) { const m = Number(a[1]); ans = TB.decodeAnswers(m, nQ); }
    main.innerHTML = `<h1>${esc(P.name)}</h1><p class="lede">${esc(P.about || "")}</p>${banner}
      <div class="prog"><i id="bar"></i></div><div class="small mute" id="count"></div>
      ${embed ? "" : `<details class="card circ-card"><summary>See how the rules decide</summary><p class="small mute">Each dot is one small step in the checker. Dark means yes and light means no. Answer every question to watch the answer flow through. This runs on your device, using the same ${C.gates.length} steps that are stored on the public network.</p><div id="circviz"></div></details>`}
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
          ${published ? `<p class="small">Published on X Layer as circuit <b>#${published.circuitId}</b> on processor <code>${CFG.processor}</code>. <a href="#rules/${published.ruleSetId}">Version history</a>. Anyone can run this command:</p><pre>cast call ${CFG.processor} "eval(uint256,bytes)(bytes)" ${published.circuitId} 0x${hexIn} --rpc-url ${CFG.rpc}</pre><p class="small">The first byte of the answer is the result number (${r.result} = ${esc(P.results[r.result])}).</p>`
            : `<p class="small">This checker has not been published on X Layer yet, so the result above is computed in your browser from the same rules. Once published, the page asks the TapeOut processor and shows a confirmation.</p>`}
          <p class="small">Circuit: ${C.gates.length} NAND gates, ${nQ} inputs, ${C.nOut} outputs.</p><pre>${C.hex}</pre>${published && window.TB_VERIFY ? `<div class="fv" id="fv"></div>` : ""}</details>
        ${embed ? "" : `<details id="packbox"><summary>Claim pack to attach to your report or claim</summary><p class="small">Plain text you can paste into an email, a support ticket or a bug report. It lists your answers, the rule that decided the result, and a link anyone can use to re-run it.</p><pre id="packtxt">Preparing…</pre><div class="row"><button class="btn small ghost" id="cpk" type="button">Copy claim pack</button></div></details>`}</div>`;
      if (published && window.TB_VERIFY && $("#fv")) formalBox($("#fv"), P, published.circuitId);
      $("#cp").onclick = e => copy(link, e.target); $("#rs").onclick = () => { ans = Array(nQ).fill(null); history.replaceState(null, "", pre.replace(/[/&]$/, "")); paint(); window.scrollTo({top: 0, behavior: "smooth"}); };
      history.replaceState(null, "", pre + "a=" + m);
      if (!embed && $("#packtxt")) {
        claimPack({P, C, ans, r, rule, published, link, hexIn}).then(t => { if (mine === seq && $("#packtxt")) $("#packtxt").textContent = t; });
        $("#cpk").onclick = e => copy($("#packtxt").textContent, e.target);
      }
      const vb = $("#vbadge");
      if (!published) { vb.className = "badge warn"; vb.textContent = "Preview: computed in your browser"; return; }
      evalOnChain(published.circuitId, m, nQ, C.nOut).then(got => { if (mine !== seq) return; if (got === r.result) { vb.className = "badge ok"; vb.textContent = "✓ Confirmed on the public network (X Layer)"; } else { vb.className = "badge warn"; vb.textContent = "The chain gave a different result. Do not rely on this page."; } })
        .catch(() => { if (mine !== seq) return; vb.className = "badge warn"; vb.textContent = "Could not reach X Layer; showing the browser result"; });
    }
    paint(); report();
    const c1 = $("#cps1"); if (c1) { c1.onclick = e => copy($("#snip1").textContent, e.target); $("#cps2").onclick = e => copy($("#snip2").textContent, e.target); }
  }

  function verify() {
    main.innerHTML = `<h1>Verify a published circuit</h1><p class="lede">Look up any circuit on the TapeOut processor and run it yourself. This asks X Layer directly, so you do not have to trust this page.</p>
      <div class="card"><div class="row"><label>Circuit number <input id="cid" type="number" min="1" style="width:120px"></label><label>Answers, one digit per question, question 1 first <input id="bits" type="text" placeholder="1111111" style="width:220px" autocomplete="off"></label><button class="btn" id="go" type="button">Run it</button></div><div id="vout"></div></div>
      <div class="card"><h3>Check a circuit against its rules</h3><p class="small">Pick the rules (or paste your own) and a circuit number. This reads the circuit's netlist from X Layer and proves, for every possible set of answers, that it gives the same result as the rules. You do not have to trust this page's compiler: the check builds the rules and the circuit separately and compares them.</p>
        <div class="row"><label>Rules <select id="frs"><option value="warranty">Warranty claims (published rules)</option><option value="bounty">Bug bounty example</option><option value="custom">Paste my own rules</option></select></label><label>Circuit number <input id="fcid" type="number" min="1" placeholder="13" style="width:120px"></label></div>
        <textarea id="frt" rows="7" class="mono" hidden placeholder="name: …" spellcheck="false" style="min-height:140px"></textarea>
        <div class="row"><button class="btn" id="fgo" type="button">Check against the chain</button></div><div id="fout" aria-live="polite"></div></div>
      <p class="small mute">Processor: <code>${CFG.processor}</code></p>`;
    $("#frs").onchange = () => { $("#frt").hidden = $("#frs").value !== "custom"; };
    $("#fgo").onclick = async () => {
      const out = $("#fout"), id = Number($("#fcid").value); if (!id) { out.innerHTML = `<p class="err">Enter a circuit number.</p>`; return; }
      const key = $("#frs").value, parsed = TB.parse(key === "custom" ? $("#frt").value : TB.TEMPLATES[key]);
      if (parsed.errors.length) { out.innerHTML = `<p class="err">${esc(parsed.errors.slice(0, 3).map(e => (e.line ? "Line " + e.line + ": " : "") + e.message).join(" "))}</p>`; return; }
      out.innerHTML = `<p class="mute">Reading the circuit from X Layer…</p>`;
      try { showFormal(out, parsed.policy, await formalOnChain(parsed.policy, id)); } catch (e) { out.innerHTML = `<p class="err">Could not read that circuit: ${esc(e.message)}</p>`; }
    };
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

  function forBusiness() {
    main.innerHTML = `<h1>For businesses</h1><p class="lede">Publish clear rules, invite your customers, and settle disagreements fairly. Pick what you need.</p>
    ${window.TB_GFX.paths([
      ["publish", "Start from a template", "Second-hand sale, freelance work, rental deposit, bug bounty or warranty: try one in a minute.", "#templates", "See the templates"],
      ["publish", "Publish your rules", "Turn your policy into a claim check your customers can use.", "#build", "Open the builder"],
      ["invite", "Invite a customer with no wallet", "They approve with their fingerprint or face. You send it in and pay the tiny fee.", "#pk/agree", "Invite by fingerprint"],
      ["wallet", "Invite a customer with a wallet", "Propose an agreement that fixes the rules, the neutral person and the time limits.", "#agree", "Make an agreement"],
      ["cases", "Handle a case", "Open a dispute, answer the questions, or look one up by number.", "#case", "Go to cases"],
      ["records", "Inbox", "Fingerprint customers send you their signed answers here. You review and submit them with one click.", "#inbox", "Open my inbox"],
      ["dev", "Skip the inbox (optional)", "Run a small script of your own that sends a notice to Slack, Discord or Zapier and can submit for you.", "https://github.com/samuel025/Lgtie/tree/main/bridge", "See the bridge"],
      ["cases", "Cases with fingerprint customers", "See the agreements and cases you opened with customers who use a passkey, and answer them.", "#pk/cases", "See passkey cases"],
      ["embed", "Put it on your website", "Add the claim check or the fingerprint sign-up with one line of code.", "embed-demo.html", "See a demo page"],
      ["records", "Reviewer records", "See who decided cases, and who did not decide in time.", "#reviewer", "See the records"],
      ["dev", "For developers", "Re-run any published rules on the public network, or read a case's decision from another contract.", "#verify", "Verify a circuit"]
    ])}`;
  }
  function about() {
    const G = window.TB_GFX, steps = [
      ["Publish the rules", "A business writes its policy as yes or no questions. It becomes a small circuit on X Layer that nobody can quietly change.", ""],
      ["Agree before anything goes wrong", "Both sides accept the rules, a neutral reviewer and the time limits. After that, none of it can be swapped.", ""],
      ["Both sides answer the same questions", "Where the answers match, it is settled. Nobody needs to argue about what they already agree on.", ""],
      ["Only the differences go to a person", "The reviewer both sides accepted decides just the questions they disagree on. Nothing else.", ""],
      ["The circuit decides, and anyone can re-run it", "The final answers go through the published rules. One free read on X Layer gives the same result, with the reason.", ""],
      ["Customers without a wallet", "A fingerprint or face scan replaces the wallet. The customer approves on their own device, and the business submits it and pays the tiny fee. Live on X Layer, unaudited, and recovery for a lost device is still being built.", `<p class="mute"><a href="#join">Create a passkey</a> · <a href="embed-demo.html">Try the fictional support page</a></p>`]
    ];
    main.innerHTML = `<h1>How it works</h1><p class="lede">One idea: settle only what the two sides disagree on.</p>
    ${G.flow()}
    ${steps.map((s, k) => `<section class="how${k % 2 ? " flip" : ""}"><div class="howtxt"><span class="hn">${k + 1}</span><h2>${s[0]}</h2><p>${s[1]}</p>${s[2]}</div><div class="ill">${G.ill[k + 1]}</div></section>`).join("")}
    <details class="card" id="risks"><summary>What it does not do, and what can go wrong</summary>
    <h2>What it does not do</h2>
    <div class="note">It does not check that the answers are true. If someone gives a false answer, the result will follow the false answer. The reviewer decides disputed facts, and a reviewer can be wrong. The circuit shows the rules were applied consistently, nothing more.</div>
    <div class="note">A person is not a wallet. Where an operator submits answers for someone without a wallet, that is recorded, and you are trusting the operator to pass them on unchanged.</div>
    <h2>What can go wrong, and what happens</h2>
    <div class="card"><table style="width:100%;border-collapse:collapse;font-size:15px"><thead><tr style="text-align:left"><th>If this happens</th><th>What LGtie does</th><th>What it can't do</th></tr></thead><tbody>
      <tr><td>A party gives a false answer</td><td>The result follows it. If the other side answers differently, the question goes to the reviewer.</td><td>Know the truth. If both sides agree on the same false answer, nobody checks.</td></tr>
      <tr><td>The reviewer is biased or wrong</td><td>Both sides had to accept them first, and their record is public.</td><td>Make them right. There is no appeal, jury or penalty.</td></tr>
      <tr><td>Nobody answers or decides in time</td><td>Anyone can close the case. It ends as "no decision"; nobody wins by default.</td><td>Force an outcome. The sides must open a new case.</td></tr>
      <tr><td>A side tries to stall by naming another reviewer</td><td>The other side must accept the new one, or the case ends as "no decision". The newer V4 contracts refuse a new reviewer under an agreement. The site hides the option for V3 cases.</td><td>Change the older V3 contract: a direct call to it still allows this (known limitation F1, fixed in V4).</td></tr>
      <tr><td>Someone is named reviewer without knowing</td><td>The record says "no decision in time" and notes that the reviewer's consent is not recorded.</td><td>Prove a reviewer agreed in the older V3 contract (known limitation F2). V4 records whether the reviewer ever took part. Ask them first.</td></tr>
      <tr><td>A file or note is leaked</td><td>Files are never uploaded. Only a fingerprint and a short note go on-chain.</td><td>Delete what is on-chain. Keep names and personal details out of notes.</td></tr>
      <tr><td>A business registers a passkey account under a customer's identifier with its own key</td><td>The customer's page checks on-chain that her passkey controls the account and warns her not to use it if it does not.</td><td>Stop the registration itself. Ask the business to add your claim code again.</td></tr>
      <tr><td>A customer loses every device with their passkey</td><td>A second passkey or a synced passkey (Apple, Google) can still act.</td><td>Recover access if none is left. Assisted recovery is not built yet.</td></tr>
      <tr><td>A photo or file is faked</td><td>A fingerprint shows the file is unchanged since it was recorded.</td><td>Show the file is genuine.</td></tr>
      <tr><td>A rule set points at a fake processor</td><td>The site only shows rule sets it knows and checks custom ones against the official processor.</td><td>Protect someone calling the older V3 contract directly (known limitation F4). V4 accepts only the official processor.</td></tr>
    </tbody></table></div>
    <p class="small mute">The full list, with tests, is in <a href="https://github.com/samuel025/Lgtie/blob/main/docs/SECURITY.md" target="_blank" rel="noopener">docs/SECURITY.md</a>. The contracts are unaudited, hold no funds, and cannot be changed once deployed.</p>
    </details>
    <h2>Status</h2><p>Prototype built for the X Layer TapeOut Accelerate hackathon. The contracts are unaudited and hold no funds. This page currently computes checkers in your browser and confirms against the chain once a checker has been published.</p>`;
  }

  // ---------- motion: frosted header on scroll, scroll reveal, page entrance (all transform and opacity) ----------
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches, hdr = document.querySelector("header");
  const onScroll = () => hdr.classList.toggle("scrolled", window.scrollY > 8); window.addEventListener("scroll", onScroll, {passive: true}); onScroll();
  const io = "IntersectionObserver" in window ? new IntersectionObserver(es => { let k = 0; es.forEach(e => { if (e.isIntersecting) { e.target.style.setProperty("--d", Math.min(k++, 4) * 0.05 + "s"); e.target.classList.add("in"); io.unobserve(e.target); } }); }, {threshold: 0, rootMargin: "0px 0px 18% 0px"}) : null;   // start just before an element scrolls into view; stagger only items that appear together
  const REVEAL = ".flow,.ill,.howtxt,.nocard,.path,.hcopy>*,.stage,.realcase,.stat,.quote,.sechead,.row2,.s3,.snippet,.make,.trio>div,.faq,.finish";
  let armed = false, armTimer = 0;
  function scan() {
    if (!armed || !io) return;
    main.querySelectorAll(REVEAL).forEach((el, i) => { if (el.dataset.r || el.parentElement === main) return; el.dataset.r = "1"; el.classList.add("rv"); io.observe(el); });
  }
  if (!reduce) new MutationObserver(scan).observe(main, {childList: true, subtree: true});
  function armReveal(embed) { armed = !embed && !reduce; clearTimeout(armTimer); armTimer = setTimeout(() => { armed = false; }, 2500); scan(); }

  // ---------- router ----------
  // Inside a host page's frame: tell the host how tall the page is so the frame can resize.
  let embedWatching = false;
  function embedHeight() {
    if (embedWatching || window.parent === window || !window.ResizeObserver) return; embedWatching = true;
    new ResizeObserver(() => window.parent.postMessage({lgtie: "height", h: Math.ceil(document.body.getBoundingClientRect().height + 16)}, "*")).observe(document.body);
  }
  function route() {
    window.TB_HERO.stop();
    const h = location.hash.replace(/^#/, ""), [view, key, ...rest] = h.split("/");
    document.body.classList.toggle("embed", view === "embed");
    main.classList.toggle("home", !view); main.classList.toggle("builder", view === "build"); main.classList.toggle("about", view === "about"); main.classList.toggle("hub", view === "for-business"); main.classList.toggle("tplpage", view === "templates"); if (view !== "build") main.removeAttribute("data-step"); main.classList.remove("enter");
    if (view !== "embed" && view && !reduce) { void main.offsetWidth; main.classList.add("enter"); setTimeout(() => main.classList.remove("enter"), 700); }
    armReveal(view === "embed");
    document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.k === view)); closeMore(); const mo = document.querySelector(".more summary"); if (mo) mo.classList.toggle("on", !!document.querySelector(".more .menu a.on"));
    window.scrollTo(0, 0);
    if (!view) return home();
    if (view === "check") return check(key || "warranty", rest.join("/"));
    if (view === "embed" && (key === "join" || key === "mine")) { embedHeight(); return key === "join" ? window.TB_PASSKEYS.join() : window.TB_PASSKEYS.mine(); }
    if (view === "embed") return check(key || "warranty", rest.join("/"), true);
    if (view === "agree") return window.TB_CASES.agreements();
    if (view === "agreement") return key ? window.TB_CASES.agreement(key) : window.TB_CASES.agreements();
    if (view === "business") return key ? window.TB_CASES.business(key) : window.TB_CASES.list();
    if (view === "rules") return window.TB_CASES.rules(key);
    if (view === "pricing") return window.TB_BILLING.page();
    if (view === "deal") return window.TB_DEAL.create(key);
    if (view === "d") return window.TB_DEAL.deal([key, ...rest].join("/"));
    if (view === "auto") return window.TB_AUTOPREVIEW.page(key);   // unlisted preview, see docs/AUTO-QUESTIONS.md
    if (view === "reviewer") return key ? window.TB_CASES.reviewer(key) : window.TB_CASES.reviewers();
    if (view === "receipt") return key ? window.TB_CASES.receipt(key) : window.TB_CASES.list();
    if (view === "for-business") return forBusiness();
    if (view === "join") return window.TB_PASSKEYS.join();
    if (view === "mine") return window.TB_PASSKEYS.mine();
    if (view === "relay") return window.TB_PASSKEYS.relay(key || "");
    if (view === "inbox") return window.TB_PASSKEYS.inbox();
    if (view === "pk") return key === "agree" ? window.TB_PASSKEYS.agree(rest[0] || "") : key === "agreement" ? window.TB_PASSKEYS.agreement(rest[0] || 1) : key === "cases" ? window.TB_PASSKEYS.all() : key === "v4case" || key === "v5case" ? window.TB_PASSKEYS.legacyCase(rest[0] || 1, key === "v5case" ? "v5" : "v4") : key === "case" ? window.TB_PASSKEYS.case(rest[0] || 1, rest[1] === "decide") : window.TB_PASSKEYS.agree();
    if (view === "case") return key ? window.TB_CASES.view(key) : window.TB_CASES.list();
    if (view === "build") return window.TB_BUILD.build(key);
    if (view === "templates") return window.TB_TEMPLATES.page();
    if (view === "verify") return verify();
    if (view === "about") return about();
    home();
  }
  // the "More" menu: closes when you pick something, click elsewhere or press Escape
  const closeMore = () => document.querySelectorAll(".more[open]").forEach(d => d.removeAttribute("open"));
  document.addEventListener("click", e => document.querySelectorAll(".more[open]").forEach(d => { if (!d.contains(e.target) || e.target.closest(".menu a")) d.removeAttribute("open"); }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMore(); });
  window.addEventListener("hashchange", route);
  route();
})();
