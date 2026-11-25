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
  function build({caseId, reviewer, decisions, oneLine, full, date, evidence}) {
    const lines = ["LGTIE REVIEWER STATEMENT", "Case: #" + caseId, "Reviewer: " + String(reviewer).toLowerCase(), "Written: " + date, "", "Decisions on the disputed questions:"];
    decisions.forEach(d => lines.push(" " + d.n + ". " + d.text + " -> " + (d.yes ? "Yes" : "No")));
    if (evidence) lines.push("", ...evidenceSection(evidence.entries, evidence.digest, evidence.labelOf).slice(0, -1));
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
    return `<div class="rvfields"><div id="rv-idnote"></div><p class="small mute" id="rv-evnote"></p><h4>Your reasons (required)</h4>
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


  // ----- the evidence the reviewer examined -----
  // A reviewer's statement can list the evidence entries recorded on the case when it was written, with a digest anyone can recompute from X Layer. So it is
  // on the record which evidence the reviewer had, and evidence added (or replaced) afterwards is visible as not examined. This is not a promise that the reviewer
  // read it, or that it is genuine: it shows which entries existed and were fingerprinted before the decision.
  // An entry is {by, passkey, question, at, hash, note}. The digest is SHA-256 of the lines "number|submitter|passkey account|question|time|fingerprint|note", joined by newlines.
  const entryLine = (e, i) => [i + 1, String(e.by).toLowerCase(), String(e.passkey || 0), e.question, e.at, String(e.hash).toLowerCase(), e.note || ""].join("|");
  const evidenceDigest = entries => sha256Hex((entries || []).map(entryLine).join("\n"));
  const utc = sec => new Date(Number(sec) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const aboutQ = q => Number(q) === 255 ? "the whole case" : "question " + (Number(q) + 1);
  // lines for the statement. labelOf(e) -> "Side A" | "Side B" | "Reviewer" | ...
  function evidenceSection(entries, digest, labelOf) {
    const n = (entries || []).length; if (!n) return ["Evidence examined: none recorded when this statement was written.", ""];
    return ["Evidence examined: " + n + " entr" + (n === 1 ? "y" : "ies") + " recorded on this case when this statement was written (entries 1 to " + n + ", in on-chain order):"]
      .concat(entries.map((e, i) => " " + (i + 1) + ". " + (labelOf ? labelOf(e) : "Someone") + " · about " + aboutQ(e.question) + " · fingerprint " + e.hash + " · " + utc(e.at) + (e.note ? " · note \"" + e.note + "\"" : "")))
      .concat(["Evidence digest: " + digest, "(To check it: SHA-256 of the lines \"number|submitter|passkey account|question|time|fingerprint|note\", one per entry, joined by newlines, read from the case's evidence list on X Layer. Entries added after this statement was written were not examined.)", ""]);
  }
  // Check the evidence list a statement claims against the evidence the chain has now. entries: the case's evidence list now; statementHash: the statement's own fingerprint.
  // The statement's own entry marks the moment it was recorded: everything before it should be in its list, everything after it was not examined.
  // -> {status: "ok" | "mismatch" | "none" | "toomany", n (entries it lists), missed (entries recorded before it but not listed), later (entries added after it)}
  async function checkStatement(text, entries, statementHash) {
    const t = String(text || ""), list = entries || [], sh = String(statementHash || "").toLowerCase(), isOwn = e => String(e.hash).toLowerCase() === sh;
    const none = /^Evidence examined: none recorded/m.test(t), m = /^Evidence examined: (\d+) entr/m.exec(t), d = /^Evidence digest: (0x[0-9a-f]{64})/m.exec(t);
    if (!none && (!m || !d)) return {status: "none"};
    const n = none ? 0 : Number(m[1]), own = list.findIndex(isOwn);
    if (n > list.length || (own >= 0 && n > own)) return {status: "toomany", n, found: d ? d[1] : null};      // it cannot have examined entries that did not exist yet
    const expected = n ? await evidenceDigest(list.slice(0, n)) : null;
    if (n && expected !== d[1]) return {status: "mismatch", n, expected, found: d[1]};
    return {status: "ok", n, expected, missed: own >= 0 ? own - n : 0, later: list.slice(own >= 0 ? own + 1 : n).filter(e => !isOwn(e))};
  }
  // The note on the decision form: what the statement will cover.
  function evidenceNote(el, entries) {
    if (!el) return; const n = (entries || []).length;
    el.textContent = n ? `Your statement will list the ${n} evidence entr${n === 1 ? "y" : "ies"} recorded so far, with a digest anyone can check against X Layer. Anything added after you record your reasons is not covered.` : "No evidence has been recorded yet. Your statement will say so.";
  }

  const api = {entryLine, evidenceDigest, evidenceSection, checkStatement, evidenceNote, DECLARATION, LIMITS, validate, build, sha256Hex, sideOf, isReviewer, reasonsOf, bytesOf, key, save, saved, downloadLink, fields, bind, read};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else window.TB_REVIEW = api;
})();
