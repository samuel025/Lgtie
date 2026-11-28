// #auto: a PREVIEW of automatic questions (docs/AUTO-QUESTIONS.md). Nothing here is enforced or published: the contracts that would enforce it do not exist yet.
// It runs the reference code in autoq.js so a rule author can see which questions the chain would answer and which would still go to a reviewer.
(function () {
  "use strict";
  const main = document.querySelector("#main"), A = window.TB_AUTOQ, TB = window.TB, DAY = 86400;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));

  function page(key) {
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
  window.TB_AUTOPREVIEW = {page};
})();
