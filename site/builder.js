// Visual rule builder: edit questions, results and rules in forms (or paste from a spreadsheet, or as text); everything is re-compiled
// and re-verified in the browser. Static: no server calls.
(function () {
  "use strict";
  const TB = window.TB, main = document.querySelector("#main"), $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const b64e = s => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const copy = async (t, btn) => { try { await navigator.clipboard.writeText(t); const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => btn.textContent = o, 1400); } catch { prompt("Copy this:", t); } };
  const sha256 = async t => "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("");

  // ----- state <-> text -----
  const fromPolicy = P => ({name: P.name, about: P.about || "", questions: P.questions.map(q => ({text: q.text, hint: q.hint || ""})), results: [...P.results],
    rules: P.rules.map(r => ({conds: r.conds.map(c => ({q: c.q, yes: c.yes})), result: r.result, why: r.why || ""})), def: {result: P.def.result, why: P.def.why || ""}});
  const clean = s => String(s || "").replace(/\s*\|\s*/g, " / ").replace(/\s->\s/g, " to ").replace(/\s:\s/g, " - ").replace(/[\r\n]+/g, " ").trim();
  const toText = S => {
    const rn = i => clean(S.results[i] || ""), cond = c => `Q${c.q + 1}=${c.yes ? "yes" : "no"}`;
    return [`name: ${clean(S.name)}`, S.about.trim() ? `about: ${clean(S.about)}` : null,
      ...S.questions.map(q => `question: ${clean(q.text)}${q.hint.trim() ? " | " + clean(q.hint) : ""}`), ...S.results.map(r => `result: ${clean(r)}`),
      ...S.rules.filter(r => r.conds.length).map(r => `rule: ${r.conds.map(cond).join(" & ")} -> ${rn(r.result)}${r.why.trim() ? " : " + clean(r.why) : ""}`),
      `default: ${rn(S.def.result)}${S.def.why.trim() ? " : " + clean(S.def.why) : ""}`].filter(x => x !== null).join("\n") + "\n";
  };
  const blank = () => ({name: "My checker", about: "", questions: [{text: "", hint: ""}], results: ["Yes", "No"], rules: [], def: {result: 0, why: ""}});

  const PROMPT = `I want to turn a policy into a "LGtie" checker. Read my policy at the bottom and reply with ONLY the rules text (no commentary), in exactly this format:

name: Short name of the checker
about: One line telling the customer what this checks
question: A yes/no question, worded so that "yes" is the good answer | Evidence the customer or staff should show (optional)
result: First possible result
result: Second possible result
rule: Q1=no -> Second possible result : Plain-words reason shown to the customer
rule: Q2=no & Q3=yes -> Second possible result : Join several conditions with &
default: First possible result : Reason shown when no rule matched

How it works: rules are checked from top to bottom and the first one that matches decides. Q1 is the first question, Q2 the second, and so on. Use at most 12 questions. Only use conditions the policy actually states; if something is unclear, add a question for it rather than guessing. Put the most disqualifying rules first.

MY POLICY:
[paste your policy text here]`;

  function build(startKey) {
    const tpl = k => TB.parse(TB.templateText ? TB.templateText(k) : TB.TEMPLATES[k]).policy;
    let tryAns = [], S = fromPolicy(tpl(startKey && TB.TEMPLATES[startKey] ? startKey : "warranty")), mode = "visual", timer = 0, pasteOpen = false, publishing = false, done = null, lastErr = "";
    main.innerHTML = `<h1>Publish your policy as a checker</h1><p class="lede">Turn your policy into a claim check your customers can use. Four short steps: questions, rules, test, publish.</p>
      <ol class="stepper" id="stepper">${["Questions", "Rules", "Test", "Publish"].map((t, i) => `<li><button type="button" data-step-btn="${i + 1}"><span class="sn">${i + 1}</span><span class="st">${t}</span></button></li>`).join("")}</ol>
      <div class="row" data-s="1"><span class="mute small">Start from:</span>${(TB.LIBRARY || []).map(t => `<button class="btn small ghost" data-t="${t.key}" type="button">${esc(TB.templateInfo(t.key).chip)}</button>`).join("")}<button class="btn small ghost" data-t="blank" type="button">Blank</button></div>
      <details class="card" id="ai" data-s="1"><summary>Have your policy as a document? Let an AI assistant draft the rules</summary>
        <p class="small">Copy this request, paste it into any AI assistant (with your policy at the bottom), then paste its reply below. Always read the result: assistants can make mistakes.</p>
        <pre id="prompt">${esc(PROMPT)}</pre><div class="row"><button class="btn small ghost" id="cpprompt" type="button">Copy the request</button></div>
        <textarea id="aiin" rows="6" class="mono" style="min-height:120px" placeholder="Paste the assistant's reply here" spellcheck="false"></textarea>
        <div class="row"><button class="btn small" id="aiuse" type="button">Use this reply</button><span id="aimsg" class="small"></span></div></details>
      <div class="row" role="tablist" data-s="1"><button class="btn small" id="tabv" type="button" aria-pressed="true">Forms</button><button class="btn small ghost" id="tabt" type="button" aria-pressed="false">Text</button></div>
      <div id="editor"></div><div id="out"></div>
      <div class="stepnav" id="stepnav"><button class="btn ghost" id="sback" type="button">← Back</button><button class="btn" id="snext" type="button">Next →</button></div>`;
    const ed = $("#editor");
    let step = 1;
    const NAMES = ["Questions", "Rules", "Test", "Publish"];
    const applyStep = (scroll) => { main.dataset.step = mode === "text" ? "all" : String(step);
      $$("[data-step-btn]").forEach(b => { const n = Number(b.dataset.stepBtn); b.classList.toggle("on", n === step); b.classList.toggle("done", n < step); b.setAttribute("aria-current", n === step ? "step" : "false"); });
      $("#stepper").classList.toggle("off", mode === "text"); $("#sback").hidden = step === 1; $("#snext").hidden = step === 4; $("#snext").textContent = "Next: " + NAMES[step] + " →"; $("#sback").textContent = "← " + NAMES[step - 2 < 0 ? 0 : step - 2];
      $("#stepnav").hidden = mode === "text"; if (scroll) window.scrollTo({top: 0, behavior: "smooth"}); };
    const goStep = n => { step = Math.max(1, Math.min(4, n)); applyStep(true); };
    $$("[data-step-btn]").forEach(b => b.onclick = () => goStep(Number(b.dataset.stepBtn)));
    $("#sback").onclick = () => goStep(step - 1); $("#snext").onclick = () => goStep(step + 1);
    const setMode = m => { mode = m; $("#tabv").classList.toggle("ghost", m !== "visual"); $("#tabt").classList.toggle("ghost", m !== "text"); $("#tabv").setAttribute("aria-pressed", m === "visual"); $("#tabt").setAttribute("aria-pressed", m === "text"); applyStep(false); drawEditor(); };
    $("#tabv").onclick = () => { if (mode === "text") { const r = TB.parse($("#src").value); if (r.errors.length) { $("#out").innerHTML = errBox(r.errors, "Fix the text before switching to forms"); return; } S = fromPolicy(r.policy); } setMode("visual"); };
    $("#tabt").onclick = () => setMode("text");
    $$("[data-t]").forEach(b => b.onclick = () => { S = b.dataset.t === "blank" ? blank() : fromPolicy(tpl(b.dataset.t)); setMode(mode); });
    $("#cpprompt").onclick = e => copy(PROMPT, e.target);
    $("#aiuse").onclick = () => { const r = TB.parse($("#aiin").value), m = $("#aimsg"); if (r.errors.length) { m.className = "small err"; m.textContent = r.errors.slice(0, 3).map(e => (e.line ? "Line " + e.line + ": " : "") + e.message).join(" ") + " Ask the assistant to fix it."; return; } S = fromPolicy(r.policy); m.className = "small ok"; m.textContent = "Loaded. Review every question and rule below."; setMode("visual"); };

    const errBox = (errs, title) => `<div class="card"><b>${title || "Fix these first"}</b>${errs.map(e => `<div class="err">${e.line ? "Line " + e.line + ": " : ""}${esc(e.message)}</div>`).join("")}</div>`;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(renderOutput, 250); };
    const qopts = sel => S.questions.map((q, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${i + 1}. ${esc(q.text.slice(0, 48) || "(empty question)")}</option>`).join("");
    const ropts = sel => S.results.map((r, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${esc(r || "(unnamed result)")}</option>`).join("");
    const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; };

    function drawEditor() {
      if (mode === "text") {
        ed.innerHTML = `<textarea id="src" class="mono" spellcheck="false" aria-label="Your policy rules"></textarea>
          <details><summary>How to write the rules</summary><pre>${esc(PROMPT.split("How it works")[0].split("format:")[1].trim())}</pre></details>`;
        const src = $("#src"); src.value = toText(S); src.oninput = () => schedule(); renderOutput(); return;
      }
      ed.innerHTML = `<div class="sthead" data-s="1"><h2>What does a customer need to answer?</h2><p class="lede">Write yes or no questions. Word each one so that "yes" is the good answer if you can, and say what evidence to show.</p></div>
        <div class="card" data-s="1"><h3>About this checker</h3>
        <div class="wide"><label><span>Name</span><input id="f-name" type="text" value="${esc(S.name)}"></label></div>
        <div class="wide"><label><span>One line for the customer</span><input id="f-about" type="text" value="${esc(S.about)}"></label></div></div>
        <div class="card" data-s="1"><h3>Questions</h3>
          ${S.questions.map((q, i) => `<div class="qrow" data-qi="${i}"><b>${i + 1}.</b><input type="text" data-f="qt" value="${esc(q.text)}" placeholder="Question" aria-label="Question ${i + 1}"><input type="text" data-f="qh" value="${esc(q.hint)}" placeholder="Evidence (optional)" aria-label="Evidence for question ${i + 1}"><span class="acts"><button class="btn small ghost" data-a="qup" type="button" aria-label="Move up">↑</button><button class="btn small ghost" data-a="qdn" type="button" aria-label="Move down">↓</button><button class="btn small ghost" data-a="qdel" type="button" aria-label="Remove">✕</button></span></div>`).join("")}
          <div class="row"><button class="btn small ghost" data-a="qadd" type="button">+ Add a question</button></div></div>
        <div class="sthead" data-s="2"><h2>When does each result apply?</h2><p class="lede">Name the possible results, then build the rules. Rules are checked top to bottom and the first match decides.</p></div>
        <div class="card" data-s="2"><h3>Possible results</h3>
          <div class="chips">${S.results.map((r, i) => `<span class="chipin" data-ri="${i}"><b>${i + 1}</b><input type="text" data-f="rn" value="${esc(r)}" placeholder="Result name" aria-label="Result ${i + 1}"><button class="x" data-a="rdel" type="button" aria-label="Delete result ${i + 1}">×</button></span>`).join("")}<button class="btn small ghost" data-a="radd" type="button">+ Add a result</button></div></div>
        <div class="card" data-s="2"><h3>Rules</h3><p class="small mute">One row per rule, checked from top to bottom: the first row that matches decides. Click a cell to cycle <b>any</b>, <b>Yes</b> and <b>No</b>. The row that fires lights up in the preview below. “Any” means that question does not matter for that rule.</p>
          <div class="qleg">${S.questions.map((q, i) => `<div><b>Q${i + 1}</b> <span class="qt">${esc(q.text || "(empty)")}</span></div>`).join("")}</div>
          <div class="gridwrap"><table class="rgrid"><thead><tr><th></th>${S.questions.map((q, i) => `<th title="${esc(q.text)}"><span class="qn">Q${i + 1}</span><span class="qs">${esc(q.text || "(empty)")}</span></th>`).join("")}<th class="l">Then the result is</th><th class="l">Because (shown to the customer)</th><th></th></tr></thead><tbody>
          ${S.rules.map((r, i) => `<tr class="rrow${r.conds.length ? "" : " noc"}" data-ui="${i}"><td class="rn">${i + 1}</td>${S.questions.map((q, k) => { const c = r.conds.find(c => c.q === k), v = c ? (c.yes ? "y" : "n") : "a"; return `<td><button type="button" class="cell ${v}" data-a="cell" data-q="${k}" aria-label="Rule ${i + 1}, question ${k + 1}: ${v === "y" ? "yes" : v === "n" ? "no" : "any"}">${v === "y" ? "Yes" : v === "n" ? "No" : "any"}</button></td>`; }).join("")}
            <td class="res"><select data-f="rr" aria-label="Result of rule ${i + 1}">${ropts(r.result)}</select></td><td class="why"><input type="text" data-f="rw" value="${esc(r.why)}" placeholder="${r.conds.length ? "Reason shown to the customer" : "Pick at least one Yes or No"}" aria-label="Reason for rule ${i + 1}"></td>
            <td class="acts"><button class="btn small ghost" data-a="rup" type="button" aria-label="Move rule up">↑</button> <button class="btn small ghost" data-a="rdn" type="button" aria-label="Move rule down">↓</button> <button class="btn small ghost" data-a="rdelrule" type="button" aria-label="Delete rule">×</button></td></tr>${r.conds.length ? `<tr class="rsum"><td></td><td colspan="${S.questions.length + 3}"><span>Matches when</span> ${[...r.conds].sort((a, b) => a.q - b.q).map(c => `<b>Q${c.q + 1}</b> <span>is</span> <b class="${c.yes ? "yy" : "nn"}">${c.yes ? "Yes" : "No"}</b>`).join(" <span>and</span> ")}</td></tr>` : ""}`).join("")}
          <tr class="rrow def" data-def="1"><td class="rn">else</td><td colspan="${S.questions.length}" class="small mute">no rule above matched</td><td class="res"><select id="f-dr" aria-label="Default result">${ropts(S.def.result)}</select></td><td class="why"><input id="f-dw" type="text" value="${esc(S.def.why)}" placeholder="Reason shown to the customer"></td><td></td></tr>
          </tbody></table></div>
          <div class="row"><button class="btn small ghost" data-a="ruleadd" type="button">+ Add a rule</button></div></div>
        <details class="card" data-s="2"${pasteOpen ? " open" : ""}><summary>Paste from a spreadsheet</summary>
          <p class="small">Copy cells from Excel or Google Sheets and paste. <b>Questions:</b> two columns, question then evidence. <b>Rules:</b> three columns: conditions (for example <code>Q2=no</code> or <code>Q1=yes &amp; Q3=no</code>), result name, reason.</p>
          <textarea id="pq" rows="4" class="mono" style="min-height:90px" placeholder="Question&#9;Evidence" spellcheck="false"></textarea><div class="row"><button class="btn small ghost" data-a="pasteq" type="button">Add these questions</button></div>
          <textarea id="pr" rows="4" class="mono" style="min-height:90px" placeholder="Q1=no&#9;Not covered&#9;The reason" spellcheck="false"></textarea><div class="row"><button class="btn small ghost" data-a="paster" type="button">Add these rules</button><span id="pmsg" class="small"></span></div></details>`;
      bind(); renderOutput();
    }

    function bind() {
      const idx = (el, attr) => Number(el.closest("[" + attr + "]").getAttribute(attr));
      $("#f-name").oninput = e => { S.name = e.target.value; schedule(); }; $("#f-about").oninput = e => { S.about = e.target.value; schedule(); };
      $("#f-dr").onchange = e => { S.def.result = Number(e.target.value); schedule(); }; $("#f-dw").oninput = e => { S.def.why = e.target.value; schedule(); };
      $$("[data-f]").forEach(el => {
        const f = el.dataset.f, on = el.tagName === "SELECT" ? "onchange" : "oninput";
        el[on] = () => {
          if (f === "qt") S.questions[idx(el, "data-qi")].text = el.value; else if (f === "qh") S.questions[idx(el, "data-qi")].hint = el.value;
          else if (f === "rn") S.results[idx(el, "data-ri")] = el.value;
          else if (f === "cq") S.rules[idx(el, "data-ui")].conds[idx(el, "data-ck")].q = Number(el.value);
          else if (f === "cy") S.rules[idx(el, "data-ui")].conds[idx(el, "data-ck")].yes = el.value === "1";
          else if (f === "rr") S.rules[idx(el, "data-ui")].result = Number(el.value);
          else if (f === "rw") S.rules[idx(el, "data-ui")].why = el.value;
          schedule();
        };
      });
      $$("[data-a]").forEach(b => b.onclick = () => act(b.dataset.a, b));
    }

    function act(a, b) {
      const gi = attr => Number(b.closest("[" + attr + "]").getAttribute(attr));
      if (a === "qadd") S.questions.push({text: "", hint: ""});
      else if (a === "qdel") { const i = gi("data-qi"); S.questions.splice(i, 1); S.rules.forEach(r => { r.conds = r.conds.filter(c => c.q !== i).map(c => ({...c, q: c.q > i ? c.q - 1 : c.q})); }); S.rules = S.rules.filter(r => r.conds.length); }
      else if (a === "qup" || a === "qdn") { const i = gi("data-qi"), j = i + (a === "qup" ? -1 : 1); if (j >= 0 && j < S.questions.length) { [S.questions[i], S.questions[j]] = [S.questions[j], S.questions[i]]; S.rules.forEach(r => r.conds.forEach(c => { if (c.q === i) c.q = j; else if (c.q === j) c.q = i; })); } }
      else if (a === "radd") S.results.push("");
      else if (a === "rdel") { const i = gi("data-ri"); if (S.results.length <= 2) return; S.results.splice(i, 1); const fix = x => x === i ? 0 : x > i ? x - 1 : x; S.rules.forEach(r => r.result = fix(r.result)); S.def.result = fix(S.def.result); }
      else if (a === "ruleadd") S.rules.push({conds: [], result: 0, why: ""});
      else if (a === "cell") { const r = S.rules[gi("data-ui")], q = Number(b.dataset.q), i = r.conds.findIndex(c => c.q === q); if (i < 0) r.conds.push({q, yes: true}); else if (r.conds[i].yes) r.conds[i].yes = false; else r.conds.splice(i, 1); r.conds.sort((x, y) => x.q - y.q); }
      else if (a === "rdelrule") S.rules.splice(gi("data-ui"), 1);
      else if (a === "rup" || a === "rdn") move(S.rules, gi("data-ui"), a === "rup" ? -1 : 1);
      else if (a === "cadd") S.rules[gi("data-ui")].conds.push({q: 0, yes: true});
      else if (a === "cdel") { const r = S.rules[gi("data-ui")]; if (r.conds.length > 1) r.conds.splice(gi("data-ck"), 1); }
      else if (a === "pasteq") { pasteOpen = true; const rows = $("#pq").value.split(/\r?\n/).map(l => l.split("\t")).filter(c => c[0] && c[0].trim()); rows.forEach(c => S.questions.push({text: c[0].trim(), hint: (c[1] || "").trim()})); $("#pmsg").textContent = ""; }
      else if (a === "paster") { pasteOpen = true;
        const rows = $("#pr").value.split(/\r?\n/).map(l => l.split("\t")).filter(c => c[0] && c[0].trim()), bad = [];
        rows.forEach((c, n) => {
          const conds = c[0].split("&").map(s => /^\s*Q(\d+)\s*=\s*(yes|no)\s*$/i.exec(s)); if (conds.some(x => !x) || conds.some(x => Number(x[1]) < 1 || Number(x[1]) > S.questions.length)) { bad.push(n + 1); return; }
          let ri = S.results.findIndex(r => r.toLowerCase() === (c[1] || "").trim().toLowerCase()); if (ri < 0 && (c[1] || "").trim()) { S.results.push(c[1].trim()); ri = S.results.length - 1; }
          if (ri < 0) { bad.push(n + 1); return; }
          S.rules.push({conds: conds.map(x => ({q: Number(x[1]) - 1, yes: x[2].toLowerCase() === "yes"})), result: ri, why: (c[2] || "").trim()});
        });
        drawEditor(); if (bad.length) $("#pmsg").innerHTML = `<span class="err">Skipped row${bad.length > 1 ? "s" : ""} ${bad.join(", ")}: use conditions like Q1=no and an existing question number.</span>`; return;
      }
      drawEditor();
    }

    const ex = tx => `<a href="${window.TB_CONFIG.explorer}/tx/${tx}" target="_blank" rel="noopener">${tx.slice(0, 10)}…</a>`;
    function pubBox(h, C) {
      if (done && done.hash === h) return `<div class="note ok-note"><b>✓ Published on X Layer.</b> Circuit #${done.circuitId}, rule set #${done.ruleSetId}. ${Object.entries(done.txs).map(([k, v]) => k + " " + ex(v)).join(" · ")}<div class="row"><a class="btn" href="${done.link}">Open your published checker</a><button class="btn ghost" id="cppub" type="button">Copy the link to share</button></div><p class="small">Anyone who opens that link sees whether the rules match what you published, and the result is confirmed by the processor.</p></div>`;
      const extra = C.gates.length > 40 ? ` This checker needs ${C.gates.length} NAND, more than the 40 free ones, so you'll also buy a few (about 0.00066 OKB).` : "";
      return `<div class="row"><label>This replaces an earlier version? Rule set number <input id="prevId" type="number" min="1" style="width:90px" placeholder="optional"></label></div>
        <p class="small">Your wallet will be asked to confirm up to four transactions: claim free NAND (once), buy more if short, record the circuit (0.0013 OKB), and register the rules. It spends your own OKB, and a published circuit can't be changed or removed.${extra}</p>
        <div class="row"><button class="btn" id="pubgo" type="button">Publish on X Layer with my wallet</button></div>
        <div id="pubmsg" class="small${lastErr ? " err" : " mute"}">${esc(lastErr)}</div>`;
    }
    function bindPub(P, canon, h, C) {
      const cp = $("#cppub"); if (cp) cp.onclick = e => copy(done.link, e.target);
      const go = $("#pubgo"); if (!go) return;
      go.onclick = async () => {
        const prev = Number($("#prevId").value) || 0; lastErr = ""; publishing = true; go.disabled = true; const msg = $("#pubmsg"); msg.className = "small mute"; msg.textContent = "Connecting your wallet…";
        try {
          const res = await window.TB_PUBLISH.run({policy: P, canon, hash: h, C, previousId: prev, say: t => { msg.textContent = t; }});
          done = {hash: h, ...res, link: location.href.split("#")[0] + "#check/c=" + b64e(canon) + "/rs=" + res.ruleSetId};
        } catch (e) { lastErr = (e && e.message) || String(e); if (/user rejected|denied/i.test(lastErr)) lastErr = "You cancelled in the wallet. Nothing more was sent."; }
        publishing = false; renderOutput();
      };
    }
    async function renderOutput() {
      if (publishing) return;
      const out = $("#out"), text = mode === "text" && $("#src") ? $("#src").value : toText(S), r = TB.parse(text);
      if (r.errors.length) { out.innerHTML = errBox(r.errors); return; }
      const P = r.policy, C = TB.compile(P), v = TB.verify(P, C), canon = TB.canonical(P), h = await sha256(canon), nQ = P.questions.length;
      if (mode === "text") S = fromPolicy(P);
      const link = location.href.split("#")[0] + "#check/c=" + b64e(canon);
      // formal proof that the compiled circuit equals the rules for every answer combination (see verify.js)
      const FV = window.TB_VERIFY, fres = FV ? FV.check(P, C.hex) : null, fdesc = fres ? FV.describe(fres, P, window.TB_I18N ? window.TB_I18N.lang : "en") : null;
      // the rule check: warnings only, never a block (see lint.js)
      const LT = window.TB_LINT, found = LT ? LT.lint(P, {lang: window.TB_I18N ? window.TB_I18N.lang : "en"}) : [], sum = LT ? LT.summary(found) : {fix: 0, consider: 0};
      const lfItem = f => `<li class="lf ${f.level}"><span class="lvl">${f.level === "warn" ? "Fix" : "Consider"}</span><span class="lmsg">${f.q !== undefined ? `<b>Q${f.q + 1}</b> ` : f.rule !== undefined ? `<b>Rule ${f.rule + 1}</b> ` : ""}${esc(f.msg)}</span><span class="lact">${f.q !== undefined ? `<button class="btn small ghost" type="button" data-lshow="${f.q}">Show</button>` : f.rule !== undefined ? `<button class="btn small ghost" type="button" data-lrule="${f.rule}">Show</button>` : ""}${f.fix ? `<button class="btn small" type="button" data-lfix="${f.q}" data-val="${esc(f.fix.hint)}">Use this evidence</button>` : ""}</span></li>`;
      const lfBadges = items => { const s = LT.summary(items); return items.length ? `${s.fix ? `<span class="badge warn">${s.fix} to fix</span>` : ""}${s.consider ? `<span class="badge">${s.consider} to consider</span>` : ""}` : `<span class="badge ok">No problems found</span>`; };
      const lfCard = (items, step) => LT ? `<div class="card lint" data-s="${step}"><h3>Rule check ${lfBadges(items)}</h3><p class="small mute intro">A plain check, done in your browser: nothing is sent anywhere. It only warns and never stops you publishing. Published rules are permanent, so a few minutes here saves arguments later.</p>${items.length ? `<ul>${items.slice().sort((a, b) => (a.level === b.level ? 0 : a.level === "warn" ? -1 : 1) || (((a.q !== undefined ? a.q : a.rule !== undefined ? a.rule : -1)) - ((b.q !== undefined ? b.q : b.rule !== undefined ? b.rule : -1)))).map(lfItem).join("")}</ul>` : ""}</div>` : "";
      out.innerHTML = `${lfCard(found.filter(f => f.where !== "r"), 1)}${lfCard(found.filter(f => f.where === "r"), 2)}<div class="sthead" data-s="3"><h2>Does it behave the way you mean?</h2><p class="lede">Answer as a customer would. The circuit lights up, the result appears, and the rule that fired is named.</p></div>
        <div class="card" data-s="3"><h3>${esc(P.name)}</h3>
        <div class="stats"><span>${nQ} questions</span><span>${P.results.length} results</span><span>${P.rules.length} rules</span><span>${C.gates.length} logic steps</span></div>
        <p class="${v.ok ? "ok" : "err"}"><b>${v.ok ? "✓ The finished checker gives the same answer as your rules" : "✗ The finished checker does not match your rules"}</b> on ${v.exhaustive ? "all " + v.checked : v.checked + " sampled"} answer combinations.</p>
        ${fdesc ? `<div class="fproof"><p class="${fdesc.level === "ok" ? "ok" : fdesc.level === "err" ? "err" : "mute"}"><b>${esc(fdesc.headline)}</b></p><p class="small">${esc(fdesc.detail)}</p><div class="row"><button class="btn small ghost" id="dlrep" type="button">Download the verification report</button></div></div>` : ""}
        <div class="row"><a class="btn" href="${link}">Try your checker</a><button class="btn ghost" id="cplink" type="button">Copy shareable link</button></div></div>
        <div class="card" data-s="3"><h3>Try it</h3>
          <div class="tryit"><div class="qs" id="tq">${P.questions.map((q, i) => `<div class="qa"><span>${i + 1}. ${esc(q.text)}</span><span class="tg" data-i="${i}"><button type="button" data-v="1">Yes</button><button type="button" data-v="0">No</button></span></div>`).join("")}</div>
            <div class="out"><div class="vsvg" id="tcirc"></div><div class="vres"><div class="vlab">Result</div><div class="big" id="tr"></div><div class="vwhy small" id="tw"></div></div><p class="small mute" id="tf"></p></div></div></div>
        <div class="sthead" data-s="4"><h2>Put it on X Layer</h2><p class="lede">Publishing records the circuit permanently, so anyone can re-run it. A change later means publishing a new version.</p></div>
        <div class="card" data-s="4"><h3>Publishing it on X Layer</h3>
          ${LT ? `<p class="small"><b>Rule check:</b> ${found.length ? `${sum.fix ? `<span class="badge warn">${sum.fix} to fix</span> ` : ""}${sum.consider ? `<span class="badge">${sum.consider} to consider</span> ` : ""}<button class="btn small ghost" type="button" data-lgo="1">Review them</button>` : `<span class="badge ok">No problems found</span>`}</p>` : ""}
          <p class="small">Publishing saves your rules permanently on the public network, so they can't be changed afterwards. A change means publishing a new version. It needs <b>${C.gates.length} NAND tokens</b> (a free starter token: the faucet gives 40 once per wallet) and a 0.0013 OKB fee, a fraction of a cent to a few cents.</p>
          <p class="small"><b>Rules fingerprint</b> (a short code that changes if the rules text changes): <code>${h}</code></p>
          <details><summary>Technical detail: the checker program (${nQ} inputs, ${C.nOut} outputs)</summary><pre>${C.hex}</pre><div class="row"><button class="btn small ghost" id="cphex" type="button">Copy netlist</button><button class="btn small ghost" id="dl" type="button">Download rules and circuit</button></div></details>
          ${pubBox(h, C)}</div>`;
      bindPub(P, canon, h, C);
      $$("[data-lshow]").forEach(b => b.onclick = () => { goStep(1); const inp = $(`[data-qi="${b.dataset.lshow}"] [data-f="qt"]`); if (inp) { inp.scrollIntoView({block: "center"}); inp.focus(); } });
      $$("[data-lrule]").forEach(b => b.onclick = () => { goStep(2); const row = $(`.rrow[data-ui="${b.dataset.lrule}"]`); if (row) { row.scrollIntoView({block: "center"}); row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 1600); } });
      $$("[data-lfix]").forEach(b => b.onclick = () => { const i = Number(b.dataset.lfix); if (S.questions[i]) { S.questions[i].hint = b.dataset.val; drawEditor(); } });
      $$("[data-lgo]").forEach(b => b.onclick = () => goStep(1));
      const ans = tryAns.length === nQ ? tryAns : (tryAns = P.questions.map(() => true));
      const circ = window.TB_HERO ? window.TB_HERO.circuit($("#tcirc"), C, {w: 520, h: 250, label: "Live circuit for your rules"}) : null;
      const paintTry = () => { $$("#tq .tg").forEach(g => { const i = Number(g.dataset.i); $$("button", g).forEach(bt => bt.setAttribute("aria-pressed", String((bt.dataset.v === "1") === ans[i]))); });
        if (circ) circ.update(ans); const run = TB.run(P, ans); $("#tr").textContent = P.results[run.result] || ""; $("#tw").textContent = run.why || ""; $("#tf").textContent = run.ruleIndex >= 0 ? "Rule " + (run.ruleIndex + 1) + " decided this." : "No rule matched, so the default applies.";
        $$(".rrow").forEach(tr => tr.classList.remove("hit")); const hit = run.ruleIndex >= 0 ? $(`.rrow[data-ui="${run.ruleIndex}"]`) : $(".rrow.def"); if (hit) hit.classList.add("hit"); };
      $$("#tq .tg button").forEach(bt => bt.onclick = () => { ans[Number(bt.closest(".tg").dataset.i)] = bt.dataset.v === "1"; paintTry(); }); paintTry();
      if (fres && $("#dlrep")) $("#dlrep").onclick = async () => { const rep = FV.report(P, fres, {compiler: TB.COMPILER_VERSION, policyHash: h, netlistHash: await FV.netlistFingerprint(C.hex), source: "built in this browser by the LGtie compiler", simulated: v.exhaustive ? {combinations: v.checked, allMatch: v.ok} : null}); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(rep, null, 2)], {type: "application/json"})); a.download = "lgtie-verification-report.json"; document.body.appendChild(a); a.click(); a.remove(); };
      $("#cplink").onclick = e => copy(link, e.target); $("#cphex").onclick = e => copy(C.hex, e.target);
      $("#dl").onclick = () => { const blob = new Blob([JSON.stringify({rules: canon, definitionsHashSha256: h, nQuestions: nQ, nResultBits: C.nOut, netlist: C.hex, gates: C.gates.length}, null, 2)], {type: "application/json"}); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = (P.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "rules") + ".json"; a.click(); };
    }
    setMode("visual");
  }
  window.TB_BUILD = {build};
})();
