// Two languages: Chinese (the default) and English. The app's logic, rule text and on-chain data stay in English; this layer translates what is shown.
//  - The language is remembered on this device (localStorage "lgtie.lang"); `?lang=en` or `?lang=zh` in the address sets it.
//  - In Chinese, every piece of text that appears on the page (and every placeholder, title and aria-label) is looked up in zh.js: first as a whole
//    string, then as a pattern with numbers and names filled in, then phrase by phrase inside longer text (so dates, numbers and addresses survive).
//    A MutationObserver translates pages as they are drawn, so no page needs to know about languages. Text with no entry stays in English.
//  - In English nothing is changed or observed.
(function () {
  "use strict";
  const KEY = "lgtie.lang";
  let lang = null; try { lang = localStorage.getItem(KEY); } catch (e) {}
  const q = /[?&]lang=(en|zh)\b/.exec(location.search); if (q) { lang = q[1]; try { localStorage.setItem(KEY, lang); } catch (e) {} }
  if (lang !== "en" && lang !== "zh") lang = "zh";                       // Chinese is the default
  const root = document.documentElement; root.lang = lang === "zh" ? "zh-CN" : "en";
  const set = l => { try { localStorage.setItem(KEY, l); } catch (e) {} location.reload(); };
  window.TB_I18N = {lang, set};

  // the language switch in the header
  const nav = document.getElementById("nav");
  if (nav) {
    const w = document.createElement("span"); w.className = "langsw"; w.setAttribute("role", "group"); w.setAttribute("aria-label", "Language");
    [["zh", "中文"], ["en", "EN"]].forEach(([l, t]) => { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.lang = l; b.dataset.notr = "1"; b.setAttribute("aria-pressed", l === lang ? "true" : "false"); if (l === lang) b.className = "on"; b.onclick = () => l !== lang && set(l); w.appendChild(b); });
    nav.appendChild(w);
  }
  if (lang === "en") return;

  const Z = window.TB_ZH || {dict: {}, patterns: []}, dict = Z.dict, patterns = Z.patterns;
  const gloss = Object.keys(dict).filter(k => k.length >= 12 || (k.length >= 6 && k.includes(" "))).sort((a, b) => b.length - a.length);   // phrases only: single short words would corrupt longer text
  const cache = new Map(), HAS = /[A-Za-z]/;
  const norm = s => s.replace(/\s+/g, " ");
  const fill = (tpl, g) => tpl.replace(/\{(\d)\}/g, (m, i) => { const c = g[i - 1]; return c !== undefined && dict[c] ? dict[c] : c; });
  // 1) the whole string, 2) a pattern with numbers and names, 3) sentence by sentence, 4) known phrases inside the text
  function exact(c) { let out = dict[c]; if (out !== undefined) return out; for (const [re, rep] of patterns) { const m = re.exec(c); if (m) return typeof rep === "function" ? rep(...m) : fill(rep, m.slice(1)); } }
  const phrases = c => { let s = c; for (const k of gloss) if (s.includes(k)) s = s.split(k).join(dict[k]); return s; };
  function tr(core) {
    if (cache.has(core)) return cache.get(core);
    let out = exact(core);
    if (out === undefined) {
      const parts = core.split(/(?<=[.!?])\s+/);
      if (parts.length > 1) { const t = parts.map(x => { const e = exact(x); return e !== undefined ? e : phrases(x); }); out = t.reduce((a, x, i) => a + (i && (/[\u4e00-\u9fff。！？”）]$/.test(a) || /^[\u4e00-\u9fff]/.test(x)) ? "" : (i ? " " : "")) + x, ""); }
      else out = phrases(core);
    }
    if (cache.size > 5000) cache.clear(); cache.set(core, out); return out;
  }
  const trim = s => { const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s); const core = norm(m[2]); if (!core || !HAS.test(core)) return s; const t = tr(core); return t === core ? s : m[1] + t + m[3]; };

  // dates in the user's language (the app asks for "the browser's language")
  const tls = Date.prototype.toLocaleString; Date.prototype.toLocaleString = function (loc, o) { return tls.call(this, loc === undefined || (Array.isArray(loc) && !loc.length) ? "zh-CN" : loc, o); };

  const SKIP = /^(SCRIPT|STYLE|CODE|PRE|NOSCRIPT)$/i, ATTRS = ["placeholder", "title", "aria-label", "alt", "data-l"];
  const done = new WeakMap(), adone = new WeakMap();
  const skipNode = n => { for (let e = n; e && e.nodeType === 1; e = e.parentNode) if (e.dataset && e.dataset.notr) return true; return false; };
  function text(n) { const p = n.parentNode; if (!p || SKIP.test(p.nodeName) || skipNode(p)) return; const s = n.data; if (done.get(n) === s) return; const t = trim(s); if (t !== s) { done.set(n, t); n.data = t; } }
  function attr(e, a) { const v = e.getAttribute(a); if (!v || /\bQ\d=/.test(v)) return;   // rule-syntax examples stay as written
    const rec = adone.get(e) || {}; if (rec[a] === v) return; const t = trim(v); if (t !== v) { rec[a] = t; adone.set(e, rec); e.setAttribute(a, t); } }
  function walk(n) {
    if (n.nodeType === 3) return text(n); if (n.nodeType !== 1) return;
    if (/^(SCRIPT|STYLE|NOSCRIPT)$/i.test(n.nodeName) || skipNode(n)) return;
    for (const a of ATTRS) if (n.hasAttribute(a)) attr(n, a);
    if (/^(CODE|PRE)$/i.test(n.nodeName)) return;
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  }
  new MutationObserver(muts => { for (const m of muts) { if (m.type === "childList") m.addedNodes.forEach(walk); else if (m.type === "characterData") text(m.target); else if (m.type === "attributes") attr(m.target, m.attributeName); } })
    .observe(root, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS});
  walk(root);
})();
