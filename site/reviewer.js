// Reviewer accountability, shared by the wallet case page and the passkey case page. No contract change is needed:
//  - A reviewer must write reasons and tick a conflict-of-interest declaration. The page builds one written statement (decisions, declaration,
//    a one-line public reason, the full reasons), records its SHA-256 fingerprint as the reviewer's evidence (with the one-line reason as the
//    public note), and only then submits the decision. The reviewer keeps the statement file; anyone can check a copy against the fingerprint.
//  - While the connected wallet is the reviewer, the page shows "Side A / Side B" instead of addresses (blind review, to reduce bias).
// Pure functions where possible so they can be tested in Node (module.exports) as well as used in the browser (window.TB_REVIEW).
(function () {
  "use strict";
  const DECLARATION = "I have no financial, personal or professional relationship with either side that could affect this decision, and neither side has contacted me privately about it. I relied only on the evidence shared in this case.";
  const LIMITS = {oneMin: 8, oneMaxBytes: 60, fullMin: 40, fullMax: 4000};
  const bytesOf = s => new TextEncoder().encode(s).length;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));

  // Check what the reviewer typed. Returns {ok, error, oneLine, full}.
  function validate({oneLine, full, coi}) {
    oneLine = String(oneLine || "").replace(/\s+/g, " ").trim(); full = String(full || "").replace(/\r\n/g, "\n").trim();
    if (oneLine.length < LIMITS.oneMin) return {ok: false, error: "Write a one-line reason (at least " + LIMITS.oneMin + " characters). It is shown publicly."};
    if (bytesOf(oneLine) > LIMITS.oneMaxBytes) return {ok: false, error: "The one-line reason is too long: " + LIMITS.oneMaxBytes + " bytes at most (accented letters count double)."};
    if (full.length < LIMITS.fullMin) return {ok: false, error: "Explain your reasons in a few sentences (at least " + LIMITS.fullMin + " characters): which evidence you relied on and what you could not verify."};
    if (full.length > LIMITS.fullMax) return {ok: false, error: "Keep the full reasons under " + LIMITS.fullMax + " characters."};
    if (!coi) return {ok: false, error: "Tick the declaration that you have no conflict of interest, or do not decide this case."};
    return {ok: true, oneLine, full};
  }

  // The statement the reviewer keeps. Deterministic: the same inputs always give the same text, so its fingerprint is reproducible.
  // decisions: [{n: question number, text: question text, yes: boolean}]
  function build({caseId, reviewer, decisions, oneLine, full, date}) {
    const lines = ["LGTIE REVIEWER STATEMENT", "Case: #" + caseId, "Reviewer: " + String(reviewer).toLowerCase(), "Written: " + date, "", "Decisions on the disputed questions:"];
    decisions.forEach(d => lines.push(" " + d.n + ". " + d.text + " -> " + (d.yes ? "Yes" : "No")));
    lines.push("", "Conflict-of-interest declaration:", " " + DECLARATION, "", "One-line reason (public): " + oneLine, "", "Full reasons:", full, "");
    return lines.join("\n");
  }
  const sha256Hex = async text => "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, "0")).join("");

  // Blind review: what to call each address on the page for a viewer who is the reviewer.
  function sideOf(addr, c) {
    const a = String(addr || "").toLowerCase(), eq = x => x && a === String(x).toLowerCase();
    if (eq(c.reviewer)) return "Reviewer";
    if (eq(c.filer) || eq(c.filerOp)) return "Side A";
    if (eq(c.decider) || eq(c.deciderOp)) return "Side B";
    return "Someone else";
  }
  const isReviewer = (me, c) => !!(me && c && c.reviewer && String(me).toLowerCase() === String(c.reviewer).toLowerCase());

  // Evidence entries written by the reviewer, in order: [{note, hash}]. `by` may be a wallet address.
  const reasonsOf = (ev, c) => (ev || []).filter(e => e.by && String(e.by).toLowerCase() === String(c.reviewer).toLowerCase()).map(e => ({note: e.note, hash: e.hash}));

  // ----- browser-only helpers -----
  const key = (chainId, contract, caseId) => "lgtie.stmt." + chainId + "." + String(contract).toLowerCase() + "." + caseId;
  function save(chainId, contract, caseId, text) { try { localStorage.setItem(key(chainId, contract, caseId), text); } catch (e) {} }
  function saved(chainId, contract, caseId) { try { return localStorage.getItem(key(chainId, contract, caseId)); } catch (e) { return null; } }
  const downloadLink = (text, caseId, label) => `<a class="btn small ghost" id="stmtdl" download="lgtie-case-${caseId}-reviewer-statement.txt" href="data:text/plain;charset=utf-8,${encodeURIComponent(text)}">${esc(label || "Download your statement")}</a>`;

  // The extra fields on the reviewer's decision form.
  function fields() {
    return `<div class="rvfields"><h4>Your reasons (required)</h4>
      <p class="small mute">Both sides and anyone who reads this case can see that you gave reasons. Explain which evidence you relied on and what you could not verify. Do not name people.</p>
      <div class="wide"><label><span>One-line reason (public)</span><input id="rv-one" type="text" maxlength="60" placeholder="For example: report shows impact damage" autocomplete="off"></label></div><p class="small mute" id="rv-count"></p>
      <label class="small">Full reasons (kept in a file you download; only its fingerprint is recorded)</label><textarea id="rv-full" rows="5" placeholder="Which evidence did you rely on, and how did it answer each disputed question? What could you not verify?"></textarea>
      <label class="rvcoi"><input id="rv-coi" type="checkbox"> <span class="small">${esc(DECLARATION)}</span></label></div>`;
  }
  function bind(root) {
    const one = root.querySelector("#rv-one"), out = root.querySelector("#rv-count"); if (!one || !out) return;
    const upd = () => { out.textContent = bytesOf(one.value) + " of " + LIMITS.oneMaxBytes + " bytes"; }; one.addEventListener("input", upd); upd();
  }
  function read(root) { const v = id => (root.querySelector(id) || {}); return validate({oneLine: v("#rv-one").value, full: v("#rv-full").value, coi: !!v("#rv-coi").checked}); }

  const api = {DECLARATION, LIMITS, validate, build, sha256Hex, sideOf, isReviewer, reasonsOf, bytesOf, key, save, saved, downloadLink, fields, bind, read};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else window.TB_REVIEW = api;
})();
