// Deal links: agree the rules before money moves, from inside a chat.
//   #deal/<template>   the person who starts a deal fills in a few details and gets a message and a link to send (WhatsApp, Telegram, email, copy).
//   #d/<details>       the page the other person opens: the deal, the yes/no questions, how to agree with a passkey. Details live after the # in the link,
//                      so they are never sent to a server by the page; anyone who has the link can read them.
// The shared link is <site>/deal/<template>.html#<details>. That static page carries the preview card (title, text, picture) that chat apps show, and
// then opens the app with the details. Static: no server.
(function () {
  "use strict";
  const TB = window.TB, CFG = window.TB_CONFIG, main = document.querySelector("#main"), $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const lang = () => (window.TB_I18N && window.TB_I18N.lang) || "en";
  const LIM = {a: 40, b: 40, w: 120, p: 40};
  const keys = () => TB.LIBRARY.map(t => t.key);
  const b64e = s => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));
  const info = k => TB.templateInfo(k), nQ = k => TB.parse(TB.templateText(k, true)).policy.questions.length;
  /// Only known fields, plain text, bounded lengths; a deal from a link is never trusted as it comes.
  function clean(o) {
    if (!o || typeof o !== "object" || !keys().includes(String(o.t || ""))) return null;
    const s = k => String(o[k] == null ? "" : o[k]).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, LIM[k]);
    return {t: String(o.t), a: s("a"), b: s("b"), w: s("w"), p: s("p"), d: /^\d{4}-\d{2}-\d{2}$/.test(String(o.d || "")) ? o.d : "", r: Number.isInteger(o.r) && o.r > 0 && o.r < 1e9 ? o.r : 0};
  }
  const encodeDeal = o => { const c = clean(o), out = {}; Object.keys(c).forEach(k => { if (c[k]) out[k] = c[k]; }); return b64e(JSON.stringify(out)); };
  const parseDeal = str => { try { const d = clean(JSON.parse(b64d(str))); return d ? {deal: d} : {error: "This link is for rules this page does not have."}; } catch { return {error: "This link is not valid. Ask the person who sent it to send it again."}; } };
  /// The exact text both people can check: it is what a written agreement would fingerprint.
  const termsText = d => ["LGtie deal", "Rules: " + info(d.t).title + (d.r ? " (rule set #" + d.r + ")" : ""), d.a && "From: " + d.a, d.b && "With: " + d.b, d.w && "About: " + d.w, d.p && "Price: " + d.p, d.d && "Date: " + d.d].filter(Boolean).join("\n");
  const siteBase = () => location.href.split("#")[0].replace(/[^/]*$/, "");
  const shareLink = d => siteBase() + "deal/" + d.t + ".html#" + encodeDeal(d);
  const ruleOf = d => d.r || (CFG.published && CFG.published[d.t] ? CFG.published[d.t].ruleSetId : 0);
  /// The chat message. It names the sender, the thing, the questions, and says only the disagreements go to someone neutral.
  function message(d, link) {
    const n = nQ(d.t), extra = [d.p && (lang() === "zh" ? "价格：" : "Price: ") + d.p, d.d && (lang() === "zh" ? "日期：" : "By: ") + d.d].filter(Boolean).join(" · ");
    if (lang() === "zh") return [`${d.a ? d.a + " 邀请你" : "我想和你"}在付款之前先约定好：万一出问题，怎么处理${d.w ? "（" + d.w + "）" : ""}。`, extra, `点开看 ${n} 个是非题。如果我们有分歧，只有答案不一致的问题才会交给我们双方事先同意的中立第三方。你不需要钱包，用通行密钥（passkey）确认即可。`, link].filter(Boolean).join("\n");
    return [`${d.a ? d.a + " invited you to agree" : "I'd like us to agree"} what happens if something goes wrong${d.w ? " with " + d.w : ""}, before any money moves.`, extra,
      `Tap to read the ${n} yes/no questions. If we disagree, only the questions we answer differently go to a neutral person we both accept first. No wallet needed: you approve with a passkey.`, link].filter(Boolean).join("\n");
  }
  const copy = async (t, btn) => { try { await navigator.clipboard.writeText(t); const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => btn.textContent = o, 1400); } catch { prompt("Copy this:", t); } };

  // ---------- the creator: #deal/<template> ----------
  function create(key) {
    const k = keys().includes(key) ? key : "secondhand", i = info(k), n = nQ(k);
    main.innerHTML = `<h1>Create a deal link</h1><p class="lede">Send this to the other person in WhatsApp, Telegram or email <b>before</b> any money moves. They read the ${n} yes/no questions and see who decides if you disagree. Nothing is uploaded and nobody needs a wallet to read it.</p>
      <div class="card formcard">
        <label class="field"><span>Situation</span><select id="dl-t">${TB.LIBRARY.map(t => `<option value="${esc(t.key)}"${t.key === k ? " selected" : ""}>${esc(info(t.key).title)}</option>`).join("")}</select></label>
        <div class="fgrid2"><label class="field"><span>Your name (optional)</span><input id="dl-a" type="text" maxlength="${LIM.a}" autocomplete="off" placeholder="e.g. Samuel"></label>
          <label class="field"><span>Their name (optional)</span><input id="dl-b" type="text" maxlength="${LIM.b}" autocomplete="off" placeholder="e.g. Amina"></label></div>
        <label class="field"><span>What is the deal about? (optional)</span><input id="dl-w" type="text" maxlength="${LIM.w}" autocomplete="off" placeholder="e.g. iPhone 12, 128GB, blue"></label>
        <div class="fgrid2"><label class="field"><span>Price (optional)</span><input id="dl-p" type="text" maxlength="${LIM.p}" autocomplete="off" placeholder="e.g. ₦250,000"></label>
          <label class="field"><span>Date (optional)</span><input id="dl-d" type="date"></label></div>
        <label class="field"><span>Rule set number, if you have published these rules on X Layer (optional)</span><input id="dl-r" type="number" min="1" step="1" placeholder="${CFG.published && CFG.published[k] ? "default: " + CFG.published[k].ruleSetId : "leave empty"}"></label></div>
      <div class="card" id="dl-out"></div>`;
    const val = id => $(id).value, build = () => ({t: val("#dl-t"), a: val("#dl-a"), b: val("#dl-b"), w: val("#dl-w"), p: val("#dl-p"), d: val("#dl-d"), r: Number(val("#dl-r")) || 0});
    let edited = false;
    function render() {
      const d = clean(build()), link = shareLink(d), text = edited && $("#dl-msg") ? $("#dl-msg").value : message(d, link), enc = encodeURIComponent, tg = text.replace(link, "").trim();
      $("#dl-out").innerHTML = `<h3>Your message</h3><p class="small mute">Edit it if you like. The link at the end is the deal.</p>
        <textarea id="dl-msg" rows="7" aria-label="Message to send">${esc(text)}</textarea>
        <div class="row">
          <a class="btn" id="dl-wa" target="_blank" rel="noopener" href="https://wa.me/?text=${enc(text)}">Send on WhatsApp</a>
          <a class="btn" id="dl-tg" target="_blank" rel="noopener" href="https://t.me/share/url?url=${enc(link)}&text=${enc(tg)}">Send on Telegram</a>
          <a class="btn ghost" id="dl-em" href="mailto:?subject=${enc("Let's agree the rules first")}&body=${enc(text)}">Email</a>
          ${navigator.share ? `<button class="btn ghost" id="dl-sh" type="button">More…</button>` : ""}
          <button class="btn ghost" id="dl-cm" type="button">Copy message</button><button class="btn ghost" id="dl-cl" type="button">Copy link</button></div>
        <h3>How it will look in the chat</h3>
        <div class="dealcard"><div class="dc-img" aria-hidden="true"><b>LGtie</b><span>${esc(info(d.t).title)}</span></div><div class="dc-txt"><b>${esc(info(d.t).title)}: agree the rules before any money moves</b><span>${esc(info(d.t).blurb)} ${nQ(d.t)} yes/no questions. Tap to read them.</span><em>${esc(location.host || "lgtie")}</em></div></div>
        <p class="small mute">The details (names, price, date) are inside the link after the <code>#</code>, so this page sends them nowhere. Anyone who gets the link can read them, so share it only with the person you mean. The picture and title chat apps show come from the rules, not from your details.</p>
        <p class="small"><a href="${esc(link.replace(/^.*?#/, "#d/"))}">Open it as the other person will see it</a></p>`;
      const fit = () => { const m = $("#dl-msg"); m.style.height = "auto"; m.style.height = Math.max(150, m.scrollHeight + 4) + "px"; }; fit();
      $("#dl-msg").oninput = () => { edited = true; fit(); const t = $("#dl-msg").value; $("#dl-wa").href = "https://wa.me/?text=" + enc(t); $("#dl-tg").href = "https://t.me/share/url?url=" + enc(link) + "&text=" + enc(t.replace(link, "").trim()); $("#dl-em").href = "mailto:?subject=" + enc("Let's agree the rules first") + "&body=" + enc(t); };
      $("#dl-cm").onclick = e => copy($("#dl-msg").value, e.target); $("#dl-cl").onclick = e => copy(link, e.target);
      if ($("#dl-sh")) $("#dl-sh").onclick = () => navigator.share({text: $("#dl-msg").value}).catch(() => {});
    }
    ["#dl-a", "#dl-b", "#dl-w", "#dl-p", "#dl-d", "#dl-r"].forEach(s => { $(s).oninput = () => { edited = false; render(); }; });
    $("#dl-t").onchange = () => { location.hash = "#deal/" + val("#dl-t"); };
    render();
  }

  // ---------- the other person (and the creator): #d/<details> ----------
  async function deal(str) {
    const r = parseDeal(str);
    if (r.error) { main.innerHTML = `<h1>Deal</h1><p class="err">${esc(r.error)}</p><p><a class="btn" href="#templates">See the templates</a></p>`; return; }
    const d = r.deal, i = info(d.t), qs = TB.parse(TB.templateText(d.t, true)).policy.questions, terms = termsText(d), rule = ruleOf(d);
    const fp = "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(terms)))].map(b => b.toString(16).padStart(2, "0")).join("");
    const row = (l, v) => v ? `<tr><td>${l}</td><td>${esc(v)}</td></tr>` : "";
    main.innerHTML = `<h1>${d.a ? esc(d.a) + " wants to agree the rules first" : "Agree the rules first"}</h1>
      <p class="lede">${d.w ? `For <b>${esc(d.w)}</b>. ` : ""}Before any money moves, you both see the same ${qs.length} yes/no questions. If something goes wrong, you each answer them. Where you agree, that settles it. Only the questions you answer differently go to a neutral person you both accept first.</p>
      <div class="card"><h3>The deal</h3><table class="small vt"><tbody>${row("From", d.a)}${row("With", d.b)}${row("About", d.w)}${row("Price", d.p)}${row("Date", d.d)}<tr><td>Rules</td><td>${esc(i.title)}${d.r ? ` (rule set #${d.r})` : ""}</td></tr></tbody></table>
        <p class="small mute">Fingerprint of these terms: <code>${fp.slice(0, 18)}…</code> · <button class="btn small ghost" id="dd-ct" type="button">Copy the terms</button></p></div>
      <div class="card"><h3>The ${qs.length} questions</h3><ol class="small">${qs.map(q => `<li>${esc(q.text)}</li>`).join("")}</ol>
        <div class="row"><a class="btn" href="#check/${esc(d.t)}">Try the checker (free, no wallet)</a></div></div>
      <div class="card" id="dd-agree"><h3>To agree, with no wallet</h3>
        <ol class="small"><li>On your phone, open <a href="#join">Create your passkey</a>. It is the same thing that unlocks your phone. You get a claim code that holds nothing secret.</li>
          <li>Send that code back in the chat${d.a ? " to " + esc(d.a) : ""}. They register it and propose the agreement.</li>
          <li>You accept on your own device with your passkey. No wallet and no OKB needed.</li></ol>
        <p class="small mute">Not binding by itself: until it is accepted on X Layer this is only the rules you both read. It is not a court, an arbitration or legal advice.</p></div>
      <div class="card" id="dd-mine"><h3>If you made this link</h3>
        ${rule ? `<p class="small">Wait for their claim code, then invite them. The rules (rule set #${rule}) and these terms are filled in for you.</p><div class="row"><button class="btn ghost" id="dd-inv" type="button">Invite them by passkey</button></div>`
          : `<p class="small">These rules are not published on X Layer yet, so an agreement cannot use them. Publish them in the <a href="#build/${esc(d.t)}">builder</a> (a small fee), then make the link again with the rule set number. The free checker works already.</p>`}</div>`;
    $("#dd-ct").onclick = e => copy(terms, e.target);
    if ($("#dd-inv")) $("#dd-inv").onclick = () => { try { sessionStorage.setItem("lgtie.dealTerms", terms); sessionStorage.setItem("lgtie.dealRule", String(rule)); } catch (e) {} location.hash = "#pk/agree"; };
  }
  window.TB_DEAL = {create, deal, encodeDeal, parseDeal, clean, termsText, message, shareLink};
})();
